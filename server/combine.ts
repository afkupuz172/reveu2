// Combine multiple selected Stripe + QuickBooks resources into a single
// RawClientData billing view (sum-all semantics): every selected resource's
// data is unioned, and each resource's standalone contribution is recorded so
// the UI can break down how each total is composed.

import type { ArAging, RawClientData, ResourceContribution } from "../shared/types";

type StripeData = NonNullable<RawClientData["stripe"]>;
type QboData = NonNullable<RawClientData["qbo"]>;

export interface SelStripe {
  id: string;
  label: string;
  data: StripeData;
}
export interface SelQbo {
  id: string;
  label: string;
  data: QboData;
}

function stripeContribution(s: SelStripe): ResourceContribution {
  const lifetimeSpend =
    s.data.charges.reduce((a, c) => a + c.amount, 0) ||
    s.data.invoices.filter((i) => i.status === "paid").reduce((a, i) => a + i.amount, 0);
  const mrr = s.data.subscriptions.filter((x) => x.status === "active").reduce((a, x) => a + x.mrr, 0);
  const outstanding = s.data.invoices.filter((i) => i.status !== "paid").reduce((a, i) => a + i.amount, 0);
  return { id: s.id, source: "stripe", label: s.label, lifetimeSpend, mrr, arr: mrr * 12, outstanding };
}

function qboContribution(q: SelQbo): ResourceContribution {
  return {
    id: q.id,
    source: "quickbooks",
    label: q.data.displayName || q.label,
    lifetimeSpend: q.data.totalIncome,
    mrr: 0,
    arr: 0,
    outstanding: q.data.balance,
  };
}

const zeroAging = (): ArAging => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });

export function combineResources(
  stripes: SelStripe[],
  qbos: SelQbo[],
): { stripe: RawClientData["stripe"]; qbo: RawClientData["qbo"]; contributions: ResourceContribution[] } {
  const stripe: RawClientData["stripe"] = stripes.length
    ? {
        subscriptions: stripes.flatMap((s) => s.data.subscriptions),
        invoices: stripes.flatMap((s) => s.data.invoices),
        charges: stripes.flatMap((s) => s.data.charges),
      }
    : null;

  const qbo: RawClientData["qbo"] = qbos.length
    ? {
        customerId: qbos.map((q) => q.id).join(","),
        displayName: qbos.length === 1 ? qbos[0].data.displayName : `${qbos.length} QuickBooks customers`,
        balance: qbos.reduce((a, q) => a + q.data.balance, 0),
        totalIncome: qbos.reduce((a, q) => a + q.data.totalIncome, 0),
        terms: qbos[0].data.terms,
        invoices: qbos.flatMap((q) => q.data.invoices),
        payments: qbos.flatMap((q) => q.data.payments),
        arAging: qbos.reduce((a, q) => {
          const x = q.data.arAging;
          return {
            current: a.current + x.current,
            d1_30: a.d1_30 + x.d1_30,
            d31_60: a.d31_60 + x.d31_60,
            d61_90: a.d61_90 + x.d61_90,
            d90plus: a.d90plus + x.d90plus,
          };
        }, zeroAging()),
      }
    : null;

  const contributions = [...stripes.map(stripeContribution), ...qbos.map(qboContribution)];
  return { stripe, qbo, contributions };
}
