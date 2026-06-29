// Live data path: build RawClientData from HubSpot + Stripe.
// SDKs are imported lazily so the app still boots (in mock mode) even if the
// packages aren't installed yet. Only reached when both env keys are present.

import type { Contact, CompanyResolution, RawClientData, ResourceCandidate } from "../shared/types";
import { rankCandidates, type ResourceRecord } from "./match";
import { combineResources, type SelQbo, type SelStripe } from "./combine";
import { fetchQbo, fetchQboById, hasQbo, searchQboCandidates } from "./qbo";

const STRIPE_ID_PROP = process.env.HUBSPOT_STRIPE_ID_PROPERTY || "stripe_customer_id";
const QBO_ID_PROP = process.env.HUBSPOT_QBO_ID_PROPERTY || "quickbooks_customer_id";

// HubSpot CRM reads (companies/deals/tickets) authenticate with an access token:
// HUBSPOT_PA_KEY (personal-access / private-app token) is the primary. The
// developer key, if present, is attached for developer-scoped endpoints.
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_PA_KEY;
const HUBSPOT_DEVELOPER_KEY = process.env.HUBSPOT_DEV_KEY;
const STRIPE_KEY = process.env.STRIPE_KEY;

// HubSpot is the anchor (drives the company list), so live mode only needs it.
// Stripe + QuickBooks are optional billing sources that degrade gracefully.
function hasLiveKeys(): boolean {
  return Boolean(HUBSPOT_ACCESS_TOKEN);
}
function hasStripe(): boolean {
  return Boolean(STRIPE_KEY);
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

/* eslint-disable @typescript-eslint/no-explicit-any */

// Request the company with the optional QBO-id property, falling back if that
// custom property doesn't exist in this portal (HubSpot 400s on unknown props).
async function getCompany(hs: any, id: string) {
  const base = ["name", "domain", "hubspot_owner_id", "lifecyclestage", "notes_last_updated", "hs_lastmodifieddate", STRIPE_ID_PROP];
  try {
    return await hs.crm.companies.basicApi.getById(id, [...base, QBO_ID_PROP]);
  } catch {
    return await hs.crm.companies.basicApi.getById(id, base);
  }
}

function companyFields(id: string, p: any) {
  return {
    company: {
      id,
      name: (p.name as string) || "(unnamed)",
      domain: (p.domain as string) || "",
      owner: (p.hubspot_owner_id as string) || "—",
      lifecycle: (p.lifecyclestage as string) || "—",
    },
    lastActivityDays: Math.min(daysSince(p.notes_last_updated as string), daysSince(p.hs_lastmodifieddate as string)),
    stripeRef: (p[STRIPE_ID_PROP] as string) || null,
    qboRef: (p[QBO_ID_PROP] as string) || null,
  };
}

async function associatedIds(hs: any, id: string, toObjectType: string): Promise<string[]> {
  const res = await hs.crm.associations.v4.basicApi
    .getPage("companies", id, toObjectType)
    .catch(() => ({ results: [] as { toObjectId: string }[] }));
  return (res.results ?? []).map((a: { toObjectId: string }) => a.toObjectId).slice(0, 25);
}

async function fetchDeals(hs: any, id: string) {
  return Promise.all(
    (await associatedIds(hs, id, "deals")).map(async (dealId) => {
      const d = await hs.crm.deals.basicApi.getById(dealId, ["dealname", "dealstage", "amount", "closedate"]);
      return {
        name: (d.properties.dealname as string) || "Deal",
        stage: ((d.properties.dealstage as string) || "").toLowerCase(),
        amount: Number(d.properties.amount) || 0,
        closeDate: (d.properties.closedate as string) || new Date().toISOString(),
      };
    }),
  );
}

async function fetchTickets(hs: any, id: string) {
  return Promise.all(
    (await associatedIds(hs, id, "tickets")).map(async (ticketId) => {
      const t = await hs.crm.tickets.basicApi.getById(ticketId, ["subject", "hs_pipeline_stage", "createdate"]);
      return {
        subject: (t.properties.subject as string) || "Ticket",
        status: (t.properties.hs_pipeline_stage as string) || "open",
        createdAt: (t.properties.createdate as string) || new Date().toISOString(),
      };
    }),
  );
}

async function fetchContacts(hs: any, id: string): Promise<Contact[]> {
  return Promise.all(
    (await associatedIds(hs, id, "contacts")).map(async (cid) => {
      const c = await hs.crm.contacts.basicApi.getById(cid, ["firstname", "lastname", "email", "jobtitle"]);
      const name = `${c.properties.firstname ?? ""} ${c.properties.lastname ?? ""}`.trim();
      return {
        name: name || (c.properties.email as string) || "(no name)",
        email: (c.properties.email as string) || null,
        title: (c.properties.jobtitle as string) || null,
      };
    }),
  );
}

async function fetchStripeData(sc: any, stripeId: string): Promise<RawClientData["stripe"]> {
  const [subsRes, invRes, chRes] = await Promise.all([
    sc.subscriptions.list({ customer: stripeId, status: "all", limit: 100 }),
    sc.invoices.list({ customer: stripeId, limit: 100 }),
    sc.charges.list({ customer: stripeId, limit: 100 }),
  ]);
  const subscriptions = subsRes.data.map((s: any) => {
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
  const invoices = invRes.data.map((i: any) => {
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
    .filter((c: any) => c.paid && !c.refunded)
    .map((c: any) => ({ amount: c.amount / 100, date: new Date(c.created * 1000).toISOString() }));
  return { subscriptions, invoices, charges };
}

async function searchStripeCandidates(
  sc: any,
  name: string,
  domain: string,
  storedId: string | null,
): Promise<ResourceRecord[]> {
  const map = new Map<string, ResourceRecord>();
  const add = (c: any) => {
    if (c && c.id && !c.deleted) {
      map.set(c.id, { id: c.id, label: (c.name as string) || (c.email as string) || c.id, email: c.email ?? null, sublabel: null });
    }
  };
  if (storedId) {
    try {
      add(await sc.customers.retrieve(storedId));
    } catch {
      /* ignore */
    }
  }
  if (domain) {
    try {
      (await sc.customers.search({ query: `email~"${domain.replace(/"/g, "")}"`, limit: 10 })).data.forEach(add);
    } catch {
      /* ignore */
    }
  }
  try {
    (await sc.customers.search({ query: `name~"${name.replace(/"/g, "")}"`, limit: 10 })).data.forEach(add);
  } catch {
    /* ignore */
  }
  if (map.size === 0 && domain) {
    try {
      (await sc.customers.list({ limit: 100 })).data
        .filter((c: any) => (c.email ?? "").toLowerCase().endsWith(domain.toLowerCase()))
        .forEach(add);
    } catch {
      /* ignore */
    }
  }
  return [...map.values()];
}

// Build RawClientData for a company using explicitly selected resources.
//   stripeId/qboId: undefined → default (stored ref / auto-match); null → off; string → that resource.
// Build RawClientData for a company from chosen resource id lists (sum-all).
//   stripeIds/qboIds: undefined → default (stored ref / auto-match); [] → none; [...] → those.
export async function liveClientRaw(
  id: string,
  stripeIds?: string[],
  qboIds?: string[],
): Promise<RawClientData> {
  const hs = await hubspotClient();
  const company = await getCompany(hs, id);
  const f = companyFields(id, company.properties);
  const [deals, tickets] = await Promise.all([fetchDeals(hs, id), fetchTickets(hs, id)]);

  // Stripe resources (skipped entirely when no STRIPE_KEY is configured).
  const sIds = stripeIds ?? (f.stripeRef ? [f.stripeRef] : []);
  const stripes: SelStripe[] = [];
  if (sIds.length && hasStripe()) {
    const sc = await stripeClient();
    for (const sid of sIds) {
      try {
        const [data, cust] = await Promise.all([fetchStripeData(sc, sid), sc.customers.retrieve(sid).catch(() => null)]);
        const label = cust && !cust.deleted ? cust.name || cust.email || sid : sid;
        if (data) stripes.push({ id: sid, label, data });
      } catch (e) {
        console.warn(`[ReVue2] Stripe fetch failed for ${f.company.name} (${sid}): ${String(e)}`);
      }
    }
  }

  // QuickBooks resources.
  const qbos: SelQbo[] = [];
  if (hasQbo()) {
    let qIds: string[];
    if (qboIds === undefined) {
      if (f.qboRef) {
        qIds = [f.qboRef];
      } else {
        const auto = await fetchQbo(f.company.name, f.company.domain).catch(() => null);
        if (auto) qbos.push({ id: auto.customerId, label: auto.displayName, data: auto });
        qIds = [];
      }
    } else {
      qIds = qboIds;
    }
    for (const qid of qIds) {
      try {
        const data = await fetchQboById(qid);
        if (data) qbos.push({ id: qid, label: data.displayName, data });
      } catch (e) {
        console.warn(`[ReVue2] QBO fetch failed for ${f.company.name} (${qid}): ${String(e)}`);
      }
    }
  }

  const { stripe, qbo, contributions } = combineResources(stripes, qbos);

  return {
    company: f.company,
    link: { status: stripes.length ? "linked" : "unlinked", stripeCustomerId: stripes[0]?.id ?? null },
    lastActivityDays: f.lastActivityDays,
    deals,
    tickets,
    stripe,
    qbo,
    contributions,
    selectedStripeIds: stripes.map((s) => s.id),
    selectedQuickbooksIds: qbos.map((q) => q.id),
  };
}

// Resolve a company → contacts, reference ids, and ranked candidate resources.
export async function liveResolve(id: string): Promise<CompanyResolution> {
  const hs = await hubspotClient();
  const company = await getCompany(hs, id);
  const f = companyFields(id, company.properties);
  const contacts = await fetchContacts(hs, id);

  let stripeCands: ResourceCandidate[] = [];
  if (hasStripe()) {
    try {
      const records = await searchStripeCandidates(await stripeClient(), f.company.name, f.company.domain, f.stripeRef);
      stripeCands = rankCandidates("stripe", records, {
        companyName: f.company.name,
        domain: f.company.domain,
        storedId: f.stripeRef,
      });
    } catch (e) {
      console.warn(`[ReVue2] Stripe candidate search failed: ${String(e)}`);
    }
  }

  let qboCands: ResourceCandidate[] = [];
  if (hasQbo()) {
    try {
      const records = await searchQboCandidates(f.company.name, f.company.domain);
      qboCands = rankCandidates("quickbooks", records, {
        companyName: f.company.name,
        domain: f.company.domain,
        storedId: f.qboRef,
      });
    } catch (e) {
      console.warn(`[ReVue2] QBO candidate search failed: ${String(e)}`);
    }
  }

  return {
    company: f.company,
    contacts,
    references: { stripeCustomerId: f.stripeRef, quickbooksCustomerId: f.qboRef },
    candidates: { stripe: stripeCands, quickbooks: qboCands },
    defaults: {
      stripeId: stripeCands[0]?.id ?? f.stripeRef ?? null,
      quickbooksId: qboCands[0]?.id ?? f.qboRef ?? null,
    },
    mock: false,
  };
}

export { hasLiveKeys, hasStripe };
