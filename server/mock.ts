// Realistic mock data so the app runs end-to-end with zero credentials.
// Three companies exercise the interesting states — including how QuickBooks
// layers onto Stripe (fallback / enrich / conflict):
//   acme   — healthy, paying; QBO matches Stripe cleanly (no conflict)
//   nimbus — at risk: overdue invoice; QBO disagrees with Stripe (conflicts)
//   orbit  — no Stripe; billing falls back to QuickBooks entirely

import type { RawClientData } from "../shared/types";

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
  return Array.from({ length: months }, (_, i) => ({
    amount,
    date: isoMonthsAgo(months - 1 - i),
  }));
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

export const MOCK: Record<string, RawClientData> = {
  acme: {
    company: {
      id: "acme",
      name: "Acme Robotics",
      domain: "acmerobotics.com",
      owner: "Dana Lee",
      lifecycle: "customer",
    },
    link: { status: "linked", stripeCustomerId: "cus_ACME0001" },
    lastActivityDays: 6,
    deals: [
      { name: "Pro renewal 2026", stage: "closedwon", amount: 14400, closeDate: isoMonthsAgo(11) },
      { name: "Add-on seats", stage: "presentationscheduled", amount: 3600, closeDate: isoDaysFromNow(20) },
    ],
    tickets: [{ subject: "API rate limit question", status: "closed", createdAt: isoMonthsAgo(1) }],
    stripe: {
      subscriptions: [
        {
          plan: "Pro",
          status: "active",
          mrr: 1200,
          start: isoMonthsAgo(11),
          currentPeriodEnd: isoDaysFromNow(24),
          autoRenew: true,
        },
      ],
      invoices: monthlyPaidInvoices(1200, 6),
      charges: monthlyCharges(1200, 12),
    },
    // QBO agrees with Stripe — clean match, plus A/R aging enrichment.
    qbo: {
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

  nimbus: {
    company: {
      id: "nimbus",
      name: "Nimbus Analytics",
      domain: "nimbus.io",
      owner: "Sam Carter",
      lifecycle: "customer",
    },
    link: { status: "linked", stripeCustomerId: "cus_NIMB0002" },
    lastActivityDays: 47,
    deals: [
      { name: "Growth plan", stage: "closedwon", amount: 9000, closeDate: isoMonthsAgo(8) },
      { name: "Enterprise upgrade", stage: "decisionmakerboughtin", amount: 24000, closeDate: isoDaysFromNow(40) },
    ],
    tickets: [
      { subject: "Billing discrepancy", status: "open", createdAt: isoDaysFromNow(-9) },
      { subject: "Failed payment retry", status: "open", createdAt: isoDaysFromNow(-3) },
    ],
    stripe: {
      subscriptions: [
        {
          plan: "Growth",
          status: "past_due",
          mrr: 750,
          start: isoMonthsAgo(8),
          currentPeriodEnd: isoDaysFromNow(12),
          autoRenew: true,
        },
      ],
      invoices: [
        ...monthlyPaidInvoices(750, 5),
        { number: "INV-2050", amount: 750, status: "overdue", date: isoDaysFromNow(-20), pdfUrl: "https://invoice.stripe.com/example.pdf" },
        { number: "INV-2051", amount: 750, status: "open", date: isoDaysFromNow(-2), pdfUrl: "https://invoice.stripe.com/example.pdf" },
      ],
      charges: monthlyCharges(750, 8),
    },
    // QBO conflicts with Stripe: it marks the disputed $750 invoice "paid"
    // (Stripe says overdue) and reports a lower A/R balance.
    qbo: {
      customerId: "qb_nimbus",
      displayName: "Nimbus Analytics",
      balance: 750,
      totalIncome: 6000,
      terms: "Net 15",
      invoices: [
        { docNumber: "2050", amount: 750, status: "paid", date: isoDaysFromNow(-20), dueDate: isoDaysFromNow(-13) },
      ],
      payments: monthlyCharges(750, 8),
      arAging: { current: 0, d1_30: 750, d31_60: 0, d61_90: 0, d90plus: 0 },
    },
  },

  orbit: {
    company: {
      id: "orbit",
      name: "Orbit Logistics",
      domain: "orbitlogistics.com",
      owner: "Dana Lee",
      lifecycle: "opportunity",
    },
    link: { status: "unlinked", stripeCustomerId: null },
    lastActivityDays: 14,
    deals: [{ name: "New business", stage: "qualifiedtobuy", amount: 18000, closeDate: isoDaysFromNow(55) }],
    tickets: [],
    stripe: null,
    // No Stripe at all → billing view falls back to QuickBooks entirely.
    qbo: {
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
};

export function mockList(): string[] {
  return Object.keys(MOCK);
}
