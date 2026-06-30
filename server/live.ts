// Live data path: build RawClientData from HubSpot + Stripe.
// SDKs are imported lazily so the app still boots (in mock mode) even if the
// packages aren't installed yet. Only reached when both env keys are present.

import type { Contact, CompanyResolution, Deal, DealProduct, PaymentStatus, RawClientData, ResourceCandidate, ScopeOption } from "../shared/types";
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

// Scope options the portfolio can be filtered by — reflecting what's ACTUALLY on
// real HubSpot deals: the distinct deal types in use (labelled from the `dealtype`
// property) plus the distinct products in use (line-item names). Not the full
// property option list / product library — only values present on real records.
export async function liveOverviewOptions(): Promise<ScopeOption[]> {
  const hs = await hubspotClient();

  // dealtype value → display label (for nicer labels on the in-use values).
  const labelMap = new Map<string, string>();
  try {
    const prop = await hs.crm.properties.coreApi.getByName("deals", "dealtype");
    for (const o of prop.options ?? []) labelMap.set(o.value as string, (o.label as string) || (o.value as string));
  } catch {
    /* labels are best-effort */
  }

  // Distinct deal types actually present on deals.
  const dealTypes = new Set<string>();
  let after: string | undefined;
  do {
    const res: any = await hs.crm.deals.searchApi.doSearch({ filterGroups: [], properties: ["dealtype"], limit: 100, after } as any);
    for (const d of res.results ?? []) {
      const v = d.properties?.dealtype as string;
      if (v) dealTypes.add(v);
    }
    after = res.paging?.next?.after;
  } while (after);

  // Distinct products actually used (line-item names).
  const products = new Set<string>();
  after = undefined;
  do {
    const res: any = await hs.crm.lineItems.searchApi.doSearch({ filterGroups: [], properties: ["name"], limit: 100, after } as any);
    for (const li of res.results ?? []) {
      const n = li.properties?.name as string;
      if (n) products.add(n);
    }
    after = res.paging?.next?.after;
  } while (after);

  return [
    ...[...dealTypes].map((v) => ({ kind: "dealType" as const, value: v, label: labelMap.get(v) ?? v })),
    ...[...products].map((n) => ({ kind: "product" as const, value: n, label: n })),
  ];
}

async function batchCompanyNames(hs: any, ids: Set<string>): Promise<{ id: string; name: string }[]> {
  if (!ids.size) return [];
  const inputs = [...ids].map((id) => ({ id }));
  const read: any = await hs.crm.companies.batchApi.read({ inputs, properties: ["name"], propertiesWithHistory: [] } as any);
  return (read.results ?? []).map((c: any) => ({ id: c.id, name: (c.properties?.name as string) || "(unnamed)" }));
}

// Optimized portfolio scan: collect only the companies that have a deal matching the
// scope (a deal of a given `dealtype`, or a deal carrying a given product), rather
// than listing every company. Names resolved via batch read.
export async function liveCompaniesForScope(kind: string, value: string): Promise<{ id: string; name: string }[]> {
  const hs = await hubspotClient();
  const companyIds = new Set<string>();
  let after: string | undefined;

  if (kind === "product") {
    // Products live on line items → walk line item → deal → company.
    do {
      const res: any = await hs.crm.lineItems.searchApi.doSearch({
        filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value }] }],
        properties: ["name"],
        limit: 100,
        after,
      } as any);
      for (const li of res.results ?? []) {
        for (const dealId of await assoc(hs, "line_items", li.id, "deals")) {
          (await assoc(hs, "deals", dealId, "companies")).forEach((cid) => companyIds.add(cid));
        }
      }
      after = res.paging?.next?.after;
    } while (after);
  } else {
    // Deal type → deal search by dealtype → companies.
    do {
      const res: any = await hs.crm.deals.searchApi.doSearch({
        filterGroups: [{ filters: [{ propertyName: "dealtype", operator: "EQ", value }] }],
        properties: ["dealname"],
        limit: 100,
        after,
      } as any);
      for (const d of res.results ?? []) {
        (await assoc(hs, "deals", d.id, "companies")).forEach((cid) => companyIds.add(cid));
      }
      after = res.paging?.next?.after;
    } while (after);
  }

  return batchCompanyNames(hs, companyIds);
}

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

async function assoc(hs: any, fromType: string, fromId: string, toType: string): Promise<string[]> {
  const res = await hs.crm.associations.v4.basicApi
    .getPage(fromType, fromId, toType)
    .catch(() => ({ results: [] as { toObjectId: string }[] }));
  return (res.results ?? []).map((a: { toObjectId: string }) => a.toObjectId).slice(0, 50);
}
// Company-anchored association (deals/tickets/contacts hang off the company).
async function associatedIds(hs: any, id: string, toObjectType: string): Promise<string[]> {
  return assoc(hs, "companies", id, toObjectType);
}

const DEAL_PAYMENT_PROP = process.env.HUBSPOT_DEAL_PAYMENT_PROPERTY || "payment_status";

interface StageMeta {
  label: string;
  prob: number;
  closed: boolean;
  won: boolean;
  pipeline: string;
}
let stageMapCache: Map<string, StageMeta> | null = null;

// Map each deal-stage id → its human label / probability / pipeline (cached
// per process; pipeline definitions rarely change).
async function getStageMap(hs: any): Promise<Map<string, StageMeta>> {
  if (stageMapCache) return stageMapCache;
  const map = new Map<string, StageMeta>();
  try {
    const res = await hs.crm.pipelines.pipelinesApi.getAll("deals");
    for (const p of res.results ?? []) {
      for (const st of p.stages ?? []) {
        const prob = Math.round(Number(st.metadata?.probability ?? 0) * 100);
        const closed = String(st.metadata?.isClosed) === "true";
        map.set(st.id, { label: st.label, prob, closed, won: closed && prob >= 100, pipeline: p.label });
      }
    }
  } catch (e) {
    console.warn(`[ReVue2] Pipeline fetch failed: ${String(e)}`);
  }
  stageMapCache = map;
  return map;
}

async function fetchLineItems(hs: any, dealId: string): Promise<DealProduct[]> {
  try {
    const liIds = await assoc(hs, "deals", dealId, "line_items");
    return await Promise.all(
      liIds.map(async (liId) => {
        const li = await hs.crm.lineItems.basicApi.getById(liId, ["name", "quantity", "amount", "price", "hs_product_name"]);
        const lp = li.properties;
        const qty = Number(lp.quantity) || 1;
        return {
          name: (lp.name as string) || (lp.hs_product_name as string) || "Item",
          quantity: qty,
          amount: Number(lp.amount) || (Number(lp.price) || 0) * qty,
        };
      }),
    );
  } catch {
    return [];
  }
}

async function fetchDeals(hs: any, id: string): Promise<Deal[]> {
  const stageMap = await getStageMap(hs);
  const dealIds = await associatedIds(hs, id, "deals");
  return Promise.all(
    dealIds.map(async (dealId) => {
      const base = ["dealname", "dealstage", "amount", "closedate", "pipeline", "dealtype"];
      let d;
      try {
        d = await hs.crm.deals.basicApi.getById(dealId, [...base, DEAL_PAYMENT_PROP]);
      } catch {
        d = await hs.crm.deals.basicApi.getById(dealId, base);
      }
      const p = d.properties;
      const stageId = (p.dealstage as string) || "";
      const meta = stageMap.get(stageId);
      const products = await fetchLineItems(hs, dealId);
      return {
        name: (p.dealname as string) || "Deal",
        stage: stageId.toLowerCase(),
        stageLabel: meta?.label ?? stageId,
        pipeline: meta?.pipeline ?? "Pipeline",
        probability: meta?.prob ?? 0,
        isClosed: meta?.closed ?? stageId.toLowerCase().startsWith("closed"),
        isWon: meta?.won ?? stageId.toLowerCase().includes("won"),
        amount: Number(p.amount) || 0,
        closeDate: (p.closedate as string) || new Date().toISOString(),
        paymentStatus: ((p[DEAL_PAYMENT_PROP] as PaymentStatus) || "Not invoiced") as PaymentStatus,
        products,
        dealType: (p.dealtype as string) || "",
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
