// Live data path: build RawClientData from HubSpot + Stripe.
// SDKs are imported lazily so the app still boots (in mock mode) even if the
// packages aren't installed yet. Only reached when both env keys are present.

import type { LinkStatus, RawClientData } from "../shared/types";
import { fetchQbo, hasQbo } from "./qbo";

const STRIPE_ID_PROP = process.env.HUBSPOT_STRIPE_ID_PROPERTY || "stripe_customer_id";

// HubSpot CRM reads (companies/deals/tickets) authenticate with an access token:
// HUBSPOT_PA_KEY (personal-access / private-app token) is the primary. The
// developer key, if present, is attached for developer-scoped endpoints.
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_PA_KEY;
const HUBSPOT_DEVELOPER_KEY = process.env.HUBSPOT_DEV_KEY;
const STRIPE_KEY = process.env.STRIPE_KEY;

function hasLiveKeys(): boolean {
  return Boolean(HUBSPOT_ACCESS_TOKEN && STRIPE_KEY);
}

async function hubspotClient() {
  const { Client } = await import("@hubspot/api-client");
  const opts: { accessToken?: string; developerApiKey?: string } = {};
  if (HUBSPOT_ACCESS_TOKEN) opts.accessToken = HUBSPOT_ACCESS_TOKEN;
  if (HUBSPOT_DEVELOPER_KEY) opts.developerApiKey = HUBSPOT_DEVELOPER_KEY;
  return new Client(opts);
}
async function stripeClient() {
  const Stripe = (await import("stripe")).default;
  return new Stripe(STRIPE_KEY as string);
}

function daysSince(iso?: string): number {
  if (!iso) return 999;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export async function liveList(): Promise<{ id: string; name: string; domain: string; stripeId: string | null }[]> {
  const hs = await hubspotClient();
  const res = await hs.crm.companies.basicApi.getPage(
    50,
    undefined,
    ["name", "domain", STRIPE_ID_PROP],
    undefined,
    undefined,
    false,
  );
  return res.results.map((c) => ({
    id: c.id,
    name: (c.properties.name as string) || "(unnamed)",
    domain: (c.properties.domain as string) || "",
    stripeId: (c.properties[STRIPE_ID_PROP] as string) || null,
  }));
}

export async function liveClient(id: string): Promise<RawClientData> {
  const hs = await hubspotClient();
  const company = await hs.crm.companies.basicApi.getById(id, [
    "name",
    "domain",
    "hubspot_owner_id",
    "lifecyclestage",
    "notes_last_updated",
    "hs_lastmodifieddate",
    STRIPE_ID_PROP,
  ]);
  const p = company.properties;
  const stripeId = (p[STRIPE_ID_PROP] as string) || null;

  // Engagement signal: most recent of logged-activity vs. record modification,
  // so a company with no notes yet still reflects recent CRM touches.
  const lastActivityDays = Math.min(
    daysSince(p.notes_last_updated as string),
    daysSince(p.hs_lastmodifieddate as string),
  );

  // Deals + tickets associated with the company (v4 associations API).
  const associatedIds = async (toObjectType: string): Promise<string[]> => {
    const res = await hs.crm.associations.v4.basicApi
      .getPage("companies", id, toObjectType)
      .catch(() => ({ results: [] as { toObjectId: string }[] }));
    return (res.results ?? []).map((a: { toObjectId: string }) => a.toObjectId).slice(0, 25);
  };

  const deals = await Promise.all(
    (await associatedIds("deals")).map(async (dealId) => {
      const d = await hs.crm.deals.basicApi.getById(dealId, ["dealname", "dealstage", "amount", "closedate"]);
      return {
        name: (d.properties.dealname as string) || "Deal",
        stage: ((d.properties.dealstage as string) || "").toLowerCase(),
        amount: Number(d.properties.amount) || 0,
        closeDate: (d.properties.closedate as string) || new Date().toISOString(),
      };
    }),
  );
  const tickets = await Promise.all(
    (await associatedIds("tickets")).map(async (ticketId) => {
      const t = await hs.crm.tickets.basicApi.getById(ticketId, ["subject", "hs_pipeline_stage", "createdate"]);
      return {
        subject: (t.properties.subject as string) || "Ticket",
        status: (t.properties.hs_pipeline_stage as string) || "open",
        createdAt: (t.properties.createdate as string) || new Date().toISOString(),
      };
    }),
  );

  const linkStatus: LinkStatus = stripeId ? "linked" : "unlinked";
  let stripe: RawClientData["stripe"] = null;

  if (stripeId) {
    const sc = await stripeClient();
    const [subsRes, invRes, chRes] = await Promise.all([
      sc.subscriptions.list({ customer: stripeId, status: "all", limit: 100 }),
      sc.invoices.list({ customer: stripeId, limit: 100 }),
      sc.charges.list({ customer: stripeId, limit: 100 }),
    ]);

    const subscriptions = subsRes.data.map((s) => {
      const item = s.items.data[0];
      const price = item?.price;
      const unit = (price?.unit_amount ?? 0) / 100;
      const qty = item?.quantity ?? 1;
      const perMonth = price?.recurring?.interval === "year" ? (unit * qty) / 12 : unit * qty;
      return {
        plan: (price?.nickname as string) || (typeof price?.product === "string" ? price.product : "Subscription"),
        status: s.status,
        mrr: perMonth,
        start: new Date(s.start_date * 1000).toISOString(),
        currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString(),
        autoRenew: !s.cancel_at_period_end,
      };
    });

    const invoices = invRes.data.map((i) => {
      let status: "paid" | "open" | "overdue" = "open";
      if (i.status === "paid") status = "paid";
      else if (i.due_date && i.due_date * 1000 < Date.now()) status = "overdue";
      return {
        number: i.number || i.id,
        amount: (i.amount_due ?? 0) / 100,
        status,
        date: new Date((i.created ?? 0) * 1000).toISOString(),
        pdfUrl: i.invoice_pdf ?? null,
      };
    });

    const charges = chRes.data
      .filter((c) => c.paid && !c.refunded)
      .map((c) => ({ amount: c.amount / 100, date: new Date(c.created * 1000).toISOString() }));

    stripe = { subscriptions, invoices, charges };
  }

  // QuickBooks (optional): enriches the billing view and provides a fallback
  // when there's no Stripe customer. Matched by company name / email domain.
  const companyName = (p.name as string) || "(unnamed)";
  const companyDomain = (p.domain as string) || "";
  let qbo: RawClientData["qbo"] = null;
  if (hasQbo()) {
    try {
      qbo = await fetchQbo(companyName, companyDomain);
    } catch (e) {
      console.warn(`[ReVue2] QBO fetch failed for ${companyName}: ${String(e)}`);
    }
  }

  return {
    company: {
      id,
      name: companyName,
      domain: companyDomain,
      owner: (p.hubspot_owner_id as string) || "—",
      lifecycle: (p.lifecyclestage as string) || "—",
    },
    link: { status: linkStatus, stripeCustomerId: stripeId },
    lastActivityDays,
    deals,
    tickets,
    stripe,
    qbo,
  };
}

export { hasLiveKeys };
