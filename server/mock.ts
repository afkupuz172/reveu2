// Mock data as separate resource pools — HubSpot companies, a Stripe customer
// pool, and a QBO customer pool — so the resolve/pick workflow has real
// candidates (including ambiguous ones) to choose from with zero credentials.
//   nimbus — TWO Stripe candidates (same domain): pick changes the graphs
//   orbit  — no Stripe; TWO QBO candidates (name vs name+domain)
//   acme   — stored Stripe reference id + a clean QBO match

import type { CompanyResolution, Contact, RawClientData } from "../shared/types";
import { rankCandidates, type ResourceRecord } from "./match";
import { combineResources } from "./combine";

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
      { name: "Pro renewal 2026", stage: "closedwon", amount: 14400, closeDate: isoMonthsAgo(11) },
      { name: "Add-on seats", stage: "presentationscheduled", amount: 3600, closeDate: isoDaysFromNow(20) },
    ],
    tickets: [{ subject: "API rate limit question", status: "closed", createdAt: isoMonthsAgo(1) }],
  },
  nimbus: {
    company: { id: "nimbus", name: "Nimbus Analytics", domain: "nimbus.io", owner: "Sam Carter", lifecycle: "customer" },
    contacts: [{ name: "Sam Carter", email: "sam@nimbus.io", title: "Finance" }],
    references: { stripeCustomerId: null, quickbooksCustomerId: null },
    lastActivityDays: 9,
    deals: [
      { name: "Growth plan", stage: "closedwon", amount: 12000, closeDate: isoMonthsAgo(8) },
      { name: "Enterprise upgrade", stage: "decisionmakerboughtin", amount: 24000, closeDate: isoDaysFromNow(40) },
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
    deals: [{ name: "New business", stage: "qualifiedtobuy", amount: 18000, closeDate: isoDaysFromNow(55) }],
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
      charges: monthlyCharges(1200, 12),
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
