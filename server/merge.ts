// Stripe-first billing merge with QuickBooks as fallback + enrichment.
//
// Rules (per the product directive):
//   1. Stripe is primary. Use its invoices/balances when present.
//   2. Fallback — if Stripe has no data for a client, use QuickBooks instead.
//   3. Enrich — always surface QBO-only signals (A/R aging, balance, terms).
//   4. Conflict — when both describe the same invoice/balance but disagree,
//      record it so the UI can highlight it.

import type {
  ClientSummary,
  Conflict,
  DataSource,
  MergedInvoice,
  RawClientData,
} from "../shared/types";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const monthKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}`;
};
const digits = (s: string) => s.replace(/\D/g, "");
// Find the Stripe invoice that corresponds to a QBO one. Invoice number (the
// real join key) wins across the whole list before any amount+month fallback —
// otherwise a same-amount invoice in the same month can shadow the true match.
function matchStripe(q: MergedInvoice, stripeInvoices: MergedInvoice[]): MergedInvoice | undefined {
  const qd = digits(q.number);
  const byNumber = qd ? stripeInvoices.find((s) => digits(s.number) === qd) : undefined;
  if (byNumber) return byNumber;
  return stripeInvoices.find((s) => Math.abs(s.amount - q.amount) <= 1 && monthKey(s.date) === monthKey(q.date));
}

export interface MergedBilling {
  invoices: MergedInvoice[];
  outstandingBalance: number;
  lifetimeSpend: number;
  /** Unified payment stream for the revenue chart (Stripe charges, else QBO payments). */
  payments: { amount: number; date: string }[];
  billing: ClientSummary["billing"];
}

export function mergeBilling(raw: RawClientData): MergedBilling {
  const stripe = raw.stripe;
  const qbo = raw.qbo;
  const conflicts: Conflict[] = [];

  const source: DataSource | "none" = stripe ? "stripe" : qbo ? "quickbooks" : "none";

  const stripeInvoices: MergedInvoice[] = (stripe?.invoices ?? []).map((i) => ({
    number: i.number,
    amount: i.amount,
    status: i.status,
    date: i.date,
    pdfUrl: i.pdfUrl,
    source: "stripe",
  }));
  const qboInvoices: MergedInvoice[] = (qbo?.invoices ?? []).map((i) => ({
    number: i.docNumber,
    amount: i.amount,
    status: i.status,
    date: i.date,
    pdfUrl: null,
    source: "quickbooks",
  }));

  let invoices: MergedInvoice[];
  if (stripe) {
    // Stripe is the spine; fold in QBO invoices that Stripe doesn't have, and
    // flag status disagreements on the ones it does.
    invoices = [...stripeInvoices];
    for (const q of qboInvoices) {
      const match = matchStripe(q, stripeInvoices);
      if (match) {
        if (match.status !== q.status) {
          conflicts.push({
            field: `Invoice ${match.number} status`,
            stripe: match.status,
            quickbooks: q.status,
            note: `Stripe shows "${match.status}", QuickBooks shows "${q.status}" for the same ${money(q.amount)} invoice.`,
          });
        }
      } else {
        invoices.push(q); // QBO-only invoice → fallback fills the gap
      }
    }
  } else {
    invoices = qboInvoices; // no Stripe at all → QBO is the billing view
  }
  invoices.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Outstanding balance: Stripe-first, QBO fallback; flag a meaningful gap.
  const stripeOutstanding = stripeInvoices
    .filter((i) => i.status !== "paid")
    .reduce((s, i) => s + i.amount, 0);
  let outstandingBalance: number;
  if (stripe) {
    outstandingBalance = stripeOutstanding;
    if (qbo && Math.abs(qbo.balance - stripeOutstanding) > 1) {
      conflicts.push({
        field: "Outstanding balance",
        stripe: money(stripeOutstanding),
        quickbooks: money(qbo.balance),
        note: `Stripe open balance ${money(stripeOutstanding)} vs. QuickBooks A/R ${money(qbo.balance)}.`,
      });
    }
  } else {
    outstandingBalance = qbo?.balance ?? 0;
  }

  // Lifetime spend: Stripe charges, else QBO income; flag a large divergence.
  const stripeSpend =
    (stripe?.charges ?? []).reduce((s, c) => s + c.amount, 0) ||
    stripeInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0);
  let lifetimeSpend: number;
  if (stripe) {
    lifetimeSpend = stripeSpend;
    if (qbo && Math.abs(qbo.totalIncome - stripeSpend) > Math.max(100, stripeSpend * 0.1)) {
      conflicts.push({
        field: "Lifetime revenue",
        stripe: money(stripeSpend),
        quickbooks: money(qbo.totalIncome),
        note: `Stripe collected ${money(stripeSpend)} vs. QuickBooks recognized ${money(qbo.totalIncome)}.`,
      });
    }
  } else {
    lifetimeSpend = qbo?.totalIncome ?? 0;
  }

  const payments = stripe?.charges ?? qbo?.payments ?? [];

  return {
    invoices,
    outstandingBalance,
    lifetimeSpend,
    payments,
    billing: {
      source,
      qboLinked: Boolean(qbo),
      qboBalance: qbo?.balance ?? null,
      qboTerms: qbo?.terms ?? null,
      arAging: qbo?.arAging ?? null,
      conflicts,
    },
  };
}
