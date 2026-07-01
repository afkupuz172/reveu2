// Mock data as separate resource pools — HubSpot companies, a Stripe customer
// pool, and a QBO customer pool — so the resolve/pick workflow has real
// candidates (including ambiguous ones) to choose from with zero credentials.
//   nimbus — TWO Stripe candidates (same domain): pick changes the graphs
//   orbit  — no Stripe; TWO QBO candidates (name vs name+domain)
//   acme   — stored Stripe reference id + a clean QBO match

import type { CompanyResolution, Contact, Deal, DealProduct, Overview4, PaymentStatus, RawClientData, ScopeOption } from "../shared/types";
import { rankCandidates, type ResourceRecord } from "./match";
import { combineResources } from "./combine";
import { buildOverview4, type O4Deal } from "./overview4";

const STAGE_META: Record<string, { label: string; prob: number; closed: boolean; won: boolean }> = {
  appointmentscheduled: { label: "Appointment scheduled", prob: 20, closed: false, won: false },
  qualifiedtobuy: { label: "Qualified to buy", prob: 20, closed: false, won: false },
  presentationscheduled: { label: "Presentation scheduled", prob: 60, closed: false, won: false },
  decisionmakerboughtin: { label: "Decision maker bought-in", prob: 80, closed: false, won: false },
  contractsent: { label: "Contract sent", prob: 90, closed: false, won: false },
  closedwon: { label: "Closed won", prob: 100, closed: true, won: true },
  closedlost: { label: "Closed lost", prob: 0, closed: true, won: false },
};

function mkDeal(
  name: string,
  stage: string,
  amount: number,
  closeDate: string,
  paymentStatus: PaymentStatus,
  products: DealProduct[],
  invoiceNumber: string | null = null,
  dealType: string = "newbusiness",
  id?: string,
  associatedDealIds?: string[],
): Deal {
  const m = STAGE_META[stage] ?? { label: stage, prob: 50, closed: false, won: false };
  return {
    name,
    stage,
    stageLabel: m.label,
    pipeline: "Sales Pipeline",
    probability: m.prob,
    isClosed: m.closed,
    isWon: m.won,
    amount,
    closeDate,
    paymentStatus,
    products,
    invoiceNumber,
    dealType,
    id,
    associatedDealIds,
  };
}

function isoMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
}
function isoDaysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}
function monthlyCharges(amount: number, months: number) {
  return Array.from({ length: months }, (_, i) => ({ amount, date: isoMonthsAgo(months - 1 - i) }));
}
function monthlyPaidInvoices(amount: number, months: number) {
  return Array.from({ length: months }, (_, i) => ({
    number: `INV-${1000 + i}`,
    amount,
    status: "paid" as const,
    date: isoMonthsAgo(months - 1 - i),
    pdfUrl: "https://invoice.stripe.com/example.pdf",
  }));
}

type StripeData = NonNullable<RawClientData["stripe"]>;
type QboData = NonNullable<RawClientData["qbo"]>;

interface MockCompany {
  company: RawClientData["company"];
  contacts: Contact[];
  references: { stripeCustomerId: string | null; quickbooksCustomerId: string | null };
  lastActivityDays: number;
  deals: RawClientData["deals"];
  tickets: RawClientData["tickets"];
}

interface Resource<T> {
  label: string;
  email: string | null;
  sublabel: string | null;
  data: T;
}

// --- HubSpot companies (the anchor) ---
const COMPANIES: Record<string, MockCompany> = {
  acme: {
    company: { id: "acme", name: "Acme Robotics", domain: "acmerobotics.com", owner: "Dana Lee", lifecycle: "customer" },
    contacts: [
      { name: "Dana Lee", email: "dana@acmerobotics.com", title: "Ops Lead" },
      { name: "Priya Shah", email: "priya@acmerobotics.com", title: "Billing" },
    ],
    references: { stripeCustomerId: "cus_acme", quickbooksCustomerId: null },
    lastActivityDays: 6,
    deals: [
      // Expansion: $12k a year ago → $14.4k renewal, both ratified by billing → NRR 120%.
      mkDeal(
        "Pro subscription 2025",
        "closedwon",
        12000,
        isoMonthsAgo(14),
        "Paid",
        [{ name: "Pro Plan (annual)", quantity: 1, amount: 12000 }],
        "INV-1066",
        "existingbusiness",
      ),
      mkDeal(
        "Pro renewal 2026",
        "closedwon",
        14400,
        isoMonthsAgo(2),
        "Paid",
        [{ name: "Pro Plan (annual)", quantity: 1, amount: 14400 }],
        "INV-1071",
        "existingbusiness",
      ),
      mkDeal(
        "Add-on seats",
        "presentationscheduled",
        3600,
        isoDaysFromNow(20),
        "Not invoiced",
        [{ name: "Additional seats", quantity: 6, amount: 3600 }],
        null,
        "existingbusiness",
      ),
    ],
    tickets: [{ subject: "API rate limit question", status: "closed", createdAt: isoMonthsAgo(1) }],
  },
  nimbus: {
    company: { id: "nimbus", name: "Nimbus Analytics", domain: "nimbus.io", owner: "Sam Carter", lifecycle: "customer" },
    contacts: [{ name: "Sam Carter", email: "sam@nimbus.io", title: "Finance" }],
    references: { stripeCustomerId: null, quickbooksCustomerId: null },
    lastActivityDays: 9,
    deals: [
      // Contraction: $12k a year ago → $9k renewal, both ratified → NRR 75%.
      mkDeal(
        "Growth plan 2025",
        "closedwon",
        12000,
        isoMonthsAgo(13),
        "Paid",
        [{ name: "Growth Plan (annual)", quantity: 1, amount: 12000 }],
        "INV-2041",
        "existingbusiness",
      ),
      mkDeal(
        "Growth renewal",
        "closedwon",
        9000,
        isoMonthsAgo(1),
        "Overdue",
        [{ name: "Growth Plan (annual)", quantity: 1, amount: 9000 }],
        "INV-2052",
        "existingbusiness",
      ),
      // Deal-to-deal pair: 2025 Enterprise closed-won, with an associated 2026
      // Enterprise T2 upgrade (still open) → Overview2 NRR = 30000/20000 = 150%.
      mkDeal(
        "Enterprise 2025",
        "closedwon",
        20000,
        isoMonthsAgo(9),
        "Paid",
        [{ name: "Enterprise license", quantity: 1, amount: 20000 }],
        "INV-2090",
        "existingbusiness",
        "nimbus-ent-2025",
        ["nimbus-ent-2026"],
      ),
      mkDeal(
        "Enterprise T2 upgrade",
        "appointmentscheduled",
        30000,
        isoDaysFromNow(60),
        "Not invoiced",
        [{ name: "Enterprise license T2", quantity: 1, amount: 30000 }],
        null,
        "existingbusiness",
        "nimbus-ent-2026",
        ["nimbus-ent-2025"],
      ),
    ],
    tickets: [
      { subject: "Billing discrepancy", status: "open", createdAt: isoDaysFromNow(-9) },
      { subject: "Failed payment retry", status: "open", createdAt: isoDaysFromNow(-3) },
    ],
  },
  orbit: {
    company: { id: "orbit", name: "Orbit Logistics", domain: "orbitlogistics.com", owner: "Dana Lee", lifecycle: "opportunity" },
    contacts: [{ name: "Pat Gomez", email: "pat@orbitlogistics.com", title: "Owner" }],
    references: { stripeCustomerId: null, quickbooksCustomerId: null },
    lastActivityDays: 14,
    deals: [
      // Won in the CRM, but QuickBooks only collected $5.6k of the $18k → NOT ratified
      // (no Stripe, insufficient QBO payments), so it's excluded from NRR and flagged.
      mkDeal("Logistics annual", "closedwon", 18000, isoMonthsAgo(1), "Pending", [
        { name: "Logistics Pro (annual)", quantity: 1, amount: 18000 },
      ]),
      mkDeal("New business", "qualifiedtobuy", 18000, isoDaysFromNow(55), "Not invoiced", [
        { name: "Logistics Pro (annual)", quantity: 1, amount: 18000 },
      ]),
      // Churn pair: 2025 closed-won baseline, 2026 closed-LOST renewal → NRR 0% (the
      // pair still appears; the lost renewal retains $0).
      mkDeal(
        "Freight 2025",
        "closedwon",
        15000,
        isoMonthsAgo(10),
        "Paid",
        [{ name: "Freight plan (annual)", quantity: 1, amount: 15000 }],
        "INV-7777",
        "existingbusiness",
        "orbit-freight-2025",
        ["orbit-freight-2026"],
      ),
      mkDeal(
        "Freight 2026 renewal",
        "closedlost",
        15000,
        isoDaysFromNow(30),
        "Not invoiced",
        [{ name: "Freight plan (annual)", quantity: 1, amount: 15000 }],
        null,
        "existingbusiness",
        "orbit-freight-2026",
        ["orbit-freight-2025"],
      ),
    ],
    tickets: [],
  },
};

// --- Stripe customer pool ---
const STRIPE: Record<string, Resource<StripeData>> = {
  cus_acme: {
    label: "Acme Robotics",
    email: "billing@acmerobotics.com",
    sublabel: "Pro · $1,200/mo",
    data: {
      subscriptions: [
        { plan: "Pro", status: "active", mrr: 1200, start: isoMonthsAgo(11), currentPeriodEnd: isoDaysFromNow(24), autoRenew: true },
      ],
      invoices: monthlyPaidInvoices(1200, 6),
      // Upsell history: started at $900/mo, now $1,200/mo → NRR expansion.
      charges: [
        ...Array.from({ length: 6 }, (_, i) => ({ amount: 900, date: isoMonthsAgo(11 - i) })),
        ...Array.from({ length: 6 }, (_, i) => ({ amount: 1200, date: isoMonthsAgo(5 - i) })),
      ],
    },
  },
  cus_nimbus: {
    label: "Nimbus Analytics",
    email: "billing@nimbus.io",
    sublabel: "Growth · $750/mo · past due",
    data: {
      subscriptions: [
        { plan: "Growth", status: "past_due", mrr: 750, start: isoMonthsAgo(8), currentPeriodEnd: isoDaysFromNow(12), autoRenew: true },
      ],
      invoices: [
        ...monthlyPaidInvoices(750, 5),
        { number: "INV-2050", amount: 750, status: "overdue", date: isoDaysFromNow(-20), pdfUrl: "https://invoice.stripe.com/example.pdf" },
        { number: "INV-2051", amount: 750, status: "open", date: isoDaysFromNow(-2), pdfUrl: "https://invoice.stripe.com/example.pdf" },
      ],
      charges: monthlyCharges(750, 8),
    },
  },
  // Ambiguous second Nimbus candidate (same domain, different/old account).
  cus_nimbus_trial: {
    label: "Nimbus (Trial)",
    email: "ops@nimbus.io",
    sublabel: "Starter · canceled",
    data: {
      subscriptions: [
        { plan: "Starter", status: "canceled", mrr: 0, start: isoMonthsAgo(14), currentPeriodEnd: isoMonthsAgo(11), autoRenew: false },
      ],
      invoices: [{ number: "INV-0900", amount: 99, status: "paid", date: isoMonthsAgo(13), pdfUrl: null }],
      charges: [{ amount: 99, date: isoMonthsAgo(13) }],
    },
  },
};

// --- QuickBooks customer pool ---
const QBO: Record<string, Resource<QboData>> = {
  qb_acme: {
    label: "Acme Robotics",
    email: "ar@acmerobotics.com",
    sublabel: "Balance $0 · Net 30",
    data: {
      customerId: "qb_acme",
      displayName: "Acme Robotics",
      balance: 0,
      totalIncome: 14400,
      terms: "Net 30",
      invoices: [
        { docNumber: "1071", amount: 1200, status: "paid", date: isoMonthsAgo(1), dueDate: isoMonthsAgo(0) },
        { docNumber: "1066", amount: 1200, status: "paid", date: isoMonthsAgo(2), dueDate: isoMonthsAgo(1) },
      ],
      payments: monthlyCharges(1200, 6),
      arAging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 },
    },
  },
  qb_nimbus: {
    label: "Nimbus Analytics",
    email: "ar@nimbus.io",
    sublabel: "Balance $750 · Net 15",
    data: {
      customerId: "qb_nimbus",
      displayName: "Nimbus Analytics",
      balance: 750,
      totalIncome: 6000,
      terms: "Net 15",
      invoices: [{ docNumber: "2050", amount: 750, status: "paid", date: isoDaysFromNow(-20), dueDate: isoDaysFromNow(-13) }],
      payments: monthlyCharges(750, 8),
      arAging: { current: 0, d1_30: 750, d31_60: 0, d61_90: 0, d90plus: 0 },
    },
  },
  qb_orbit: {
    label: "Orbit Logistics",
    email: "ar@orbitlogistics.com",
    sublabel: "Balance $4,200 · Net 30",
    data: {
      customerId: "qb_orbit",
      displayName: "Orbit Logistics",
      balance: 4200,
      totalIncome: 9800,
      terms: "Net 30",
      invoices: [
        { docNumber: "1098", amount: 5600, status: "paid", date: isoMonthsAgo(2), dueDate: isoMonthsAgo(1) },
        { docNumber: "1102", amount: 4200, status: "overdue", date: isoDaysFromNow(-40), dueDate: isoDaysFromNow(-10) },
      ],
      payments: [{ amount: 5600, date: isoMonthsAgo(2) }],
      arAging: { current: 0, d1_30: 0, d31_60: 4200, d61_90: 0, d90plus: 0 },
    },
  },
  // Ambiguous second Orbit candidate (name match only, different domain).
  qb_orbit_llc: {
    label: "Orbit Logistics LLC",
    email: "billing@orbit-logistics.com",
    sublabel: "Balance $0 · paid in full",
    data: {
      customerId: "qb_orbit_llc",
      displayName: "Orbit Logistics LLC",
      balance: 0,
      totalIncome: 3000,
      terms: "Due on receipt",
      invoices: [
        { docNumber: "7001", amount: 1500, status: "paid", date: isoMonthsAgo(1), dueDate: isoMonthsAgo(0) },
        { docNumber: "7002", amount: 1500, status: "paid", date: isoMonthsAgo(2), dueDate: isoMonthsAgo(1) },
      ],
      payments: [
        { amount: 1500, date: isoMonthsAgo(1) },
        { amount: 1500, date: isoMonthsAgo(2) },
      ],
      arAging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 },
    },
  },
};

const stripeRecords = (): ResourceRecord[] =>
  Object.entries(STRIPE).map(([id, r]) => ({ id, label: r.label, email: r.email, sublabel: r.sublabel }));
const qboRecords = (): ResourceRecord[] =>
  Object.entries(QBO).map(([id, r]) => ({ id, label: r.label, email: r.email, sublabel: r.sublabel }));

export function mockList(): string[] {
  return Object.keys(COMPANIES);
}

const DEAL_TYPE_LABELS: Record<string, string> = {
  newbusiness: "New Business",
  existingbusiness: "Existing Business",
};

// Scope options reflecting what's actually present on the mock deals: distinct deal
// types + distinct products in use.
export function mockOverviewOptions(): ScopeOption[] {
  const dealTypes = new Set<string>();
  const products = new Set<string>();
  for (const c of Object.values(COMPANIES)) {
    for (const d of c.deals) {
      if (d.dealType) dealTypes.add(d.dealType);
      for (const p of d.products) products.add(p.name);
    }
  }
  return [
    ...[...dealTypes].map((v) => ({ kind: "dealType" as const, value: v, label: DEAL_TYPE_LABELS[v] ?? v })),
    ...[...products].map((n) => ({ kind: "product" as const, value: n, label: n })),
  ];
}

// Companies with at least one deal matching the scope (deal type, or product).
export function mockCompaniesForScope(kind: string, value: string): { id: string; name: string }[] {
  const matches = (d: Deal) => (kind === "product" ? d.products.some((p) => p.name === value) : d.dealType === value);
  return Object.entries(COMPANIES)
    .filter(([, c]) => c.deals.some(matches))
    .map(([id, c]) => ({ id, name: c.company.name }));
}

// All products available across the mock deals (stands in for the HubSpot products library).
export function mockProducts(): string[] {
  const names = new Set<string>();
  for (const c of Object.values(COMPANIES)) for (const d of c.deals) for (const p of d.products) names.add(p.name);
  return [...names];
}

// Companies that have a deal carrying any of the selected products (Overview2 scan).
export function mockCompaniesForProducts(products: string[]): { id: string; name: string }[] {
  const wanted = new Set(products);
  return Object.entries(COMPANIES)
    .filter(([, c]) => c.deals.some((d) => d.products.some((p) => wanted.has(p.name))))
    .map(([id, c]) => ({ id, name: c.company.name }));
}

// Companies with a deal priced in [min,max] closing in `year` (Overview3 scan).
export function mockCompaniesForPriceYear(minPrice: number, maxPrice: number, year: number): { id: string; name: string }[] {
  return Object.entries(COMPANIES)
    .filter(([, c]) =>
      c.deals.some((d) => d.amount >= minPrice && d.amount <= maxPrice && new Date(d.closeDate).getUTCFullYear() === year),
    )
    .map(([id, c]) => ({ id, name: c.company.name }));
}

// Overview4 (deal-only): build the normalized deals + pair map from mock companies.
// Mock stands in ARR = deal amount, MRR = amount/12, company = company id.
export function mockOverview4(minPrice: number, maxPrice: number, year: number): Overview4 {
  const byId = new Map<string, O4Deal>();
  const pairMap = new Map<string, string[]>();
  const seedIds = new Set<string>();
  for (const [cid, c] of Object.entries(COMPANIES)) {
    for (const d of c.deals) {
      if (!d.id) continue; // only associated (paired) deals carry ids in mock
      byId.set(d.id, {
        id: d.id,
        name: d.name,
        amount: d.amount,
        arr: d.amount,
        mrr: Math.round(d.amount / 12),
        lineItems: d.products.length,
        companyId: cid,
        closeDate: d.closeDate,
        isWon: d.isWon,
        isClosed: d.isClosed,
        probability: d.probability,
        stageLabel: d.stageLabel,
        dealType: d.dealType,
      });
      if (d.associatedDealIds?.length) pairMap.set(d.id, d.associatedDealIds);
      if (d.amount >= minPrice && d.amount <= maxPrice && new Date(d.closeDate).getUTCFullYear() === year) seedIds.add(d.id);
    }
  }
  return buildOverview4(byId, pairMap, seedIds, minPrice, maxPrice, year);
}

export function mockResolve(companyId: string): CompanyResolution {
  const c = COMPANIES[companyId];
  if (!c) throw new Error(`Unknown company ${companyId}`);
  const stripe = rankCandidates("stripe", stripeRecords(), {
    companyName: c.company.name,
    domain: c.company.domain,
    storedId: c.references.stripeCustomerId,
  });
  const quickbooks = rankCandidates("quickbooks", qboRecords(), {
    companyName: c.company.name,
    domain: c.company.domain,
    storedId: c.references.quickbooksCustomerId,
  });
  return {
    company: c.company,
    contacts: c.contacts,
    references: c.references,
    candidates: { stripe, quickbooks },
    defaults: { stripeId: stripe[0]?.id ?? null, quickbooksId: quickbooks[0]?.id ?? null },
    mock: true,
  };
}

// Build RawClientData from a company + chosen resource id lists (or defaults).
// undefined → default to the single best candidate; [] → none; [...] → those.
export function mockClientRaw(
  companyId: string,
  stripeIds?: string[],
  qboIds?: string[],
): RawClientData {
  const c = COMPANIES[companyId];
  if (!c) throw new Error(`Unknown company ${companyId}`);
  const resolution = mockResolve(companyId);
  const sIds = stripeIds ?? (resolution.defaults.stripeId ? [resolution.defaults.stripeId] : []);
  const qIds = qboIds ?? (resolution.defaults.quickbooksId ? [resolution.defaults.quickbooksId] : []);

  const stripes = sIds.filter((id) => STRIPE[id]).map((id) => ({ id, label: STRIPE[id].label, data: STRIPE[id].data }));
  const qbos = qIds.filter((id) => QBO[id]).map((id) => ({ id, label: QBO[id].label, data: QBO[id].data }));
  const { stripe, qbo, contributions } = combineResources(stripes, qbos);

  return {
    company: c.company,
    link: { status: stripes.length ? "linked" : "unlinked", stripeCustomerId: stripes[0]?.id ?? null },
    lastActivityDays: c.lastActivityDays,
    deals: c.deals,
    tickets: c.tickets,
    stripe,
    qbo,
    contributions,
    selectedStripeIds: stripes.map((s) => s.id),
    selectedQuickbooksIds: qbos.map((q) => q.id),
  };
}
