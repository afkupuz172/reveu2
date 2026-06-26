// Pure computation: RawClientData -> ClientSummary.
// All KPIs, charts, the rule-based narrative, the health score, and the
// CRM<->Stripe reconciliation are derived here. No I/O, so it's trivially
// testable and identical for mock and live data.

import type {
  ClientSummary,
  HealthBand,
  HealthFactor,
  MergedInvoice,
  MonthPoint,
  RawClientData,
} from "../shared/types";
import { mergeBilling } from "./merge";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(iso: string): string {
  return MONTHS[new Date(iso).getMonth()];
}
function lastNMonths(n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${m.getFullYear()}-${m.getMonth()}`, label: MONTHS[m.getMonth()] });
  }
  return out;
}
function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}`;
}
function daysUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function buildHealth(
  raw: RawClientData,
  mergedInvoices: MergedInvoice[],
  hasBilling: boolean,
): { score: number; band: HealthBand; factors: HealthFactor[] } {
  const subs = raw.stripe?.subscriptions ?? [];
  // Payment health reflects the merged Stripe+QBO invoice picture, so a QBO-only
  // (fallback) overdue still drags the score down.
  const invoices = mergedInvoices;
  const hasActive = subs.some((s) => s.status === "active");
  const overdue = invoices.filter((i) => i.status === "overdue").length;
  const open = invoices.filter((i) => i.status === "open").length;
  const nextRenewalDays = subs
    .filter((s) => s.status === "active" || s.status === "past_due")
    .map((s) => daysUntil(s.currentPeriodEnd))
    .sort((a, b) => a - b)[0];
  const openDealValue = raw.deals
    .filter((d) => !d.stage.startsWith("closed"))
    .reduce((s, d) => s + d.amount, 0);

  // payment (40): clean if no overdue/open; penalize each
  let payment = 40 - overdue * 20 - open * 8;
  if (!hasBilling) payment = 10; // no billing connected in Stripe or QBO
  payment = Math.max(0, Math.min(40, payment));

  // engagement (30): recency of CRM activity
  const d = raw.lastActivityDays;
  const engagement = d <= 14 ? 30 : d <= 30 ? 20 : d <= 60 ? 10 : 0;

  // renewal (20): auto-renew on and not imminent is best
  let renewal: number;
  if (!hasActive) renewal = 0;
  else if (nextRenewalDays !== undefined && nextRenewalDays <= 30) renewal = subs.some((s) => s.autoRenew) ? 14 : 6;
  else renewal = subs.some((s) => s.autoRenew) ? 20 : 12;

  // momentum (10): open upsell pipeline
  const momentum = openDealValue > 0 ? 10 : 5;

  const score = payment + engagement + renewal + momentum;
  const band: HealthBand = score >= 80 ? "Good" : score >= 55 ? "Action needed" : "At risk";

  return {
    score,
    band,
    factors: [
      { key: "payment", label: "Payment", score: payment, max: 40 },
      { key: "engagement", label: "Engagement", score: engagement, max: 30 },
      { key: "renewal", label: "Renewal", score: renewal, max: 20 },
      { key: "momentum", label: "Momentum", score: momentum, max: 10 },
    ],
  };
}

function buildSummary(
  raw: RawClientData,
  kpis: ClientSummary["kpis"],
  billing: ClientSummary["billing"],
  invoices: MergedInvoice[],
): string {
  const subs = raw.stripe?.subscriptions ?? [];
  const overdue = invoices.filter((i) => i.status === "overdue");
  const active = subs.find((s) => s.status === "active");
  const plan = subs[0]?.plan;
  const viaQbo = billing.source === "quickbooks";

  // Lead with the worst-status clause so the headline always leads with what matters.
  let lead: string;
  if (billing.source === "none") {
    lead = `${raw.company.name} has no connected billing in Stripe or QuickBooks yet — link an account to see spending.`;
  } else if (overdue.length > 0) {
    const total = overdue.reduce((s, i) => s + i.amount, 0);
    const where = viaQbo ? " (per QuickBooks)" : "";
    lead = `${overdue.length} overdue invoice${overdue.length > 1 ? "s" : ""} totaling ${money(total)}${where} — please settle to keep the account in good standing.`;
  } else if (viaQbo) {
    // Fallback: no Stripe billing, reporting from QuickBooks.
    lead = `No Stripe billing on file; reporting from QuickBooks — A/R balance ${money(kpis.outstandingBalance)} across ${invoices.length} invoice${invoices.length === 1 ? "" : "s"}.`;
  } else if (!active) {
    lead = `No active subscription right now${plan ? ` (last plan: ${plan})` : ""} — at risk of churn.`;
  } else if (kpis.nextRenewal && daysUntil(kpis.nextRenewal) <= 30) {
    lead = `On the ${active.plan} plan (${money(active.mrr)}/mo), renews in ${daysUntil(kpis.nextRenewal)} days.`;
  } else {
    lead = `On the ${active.plan} plan (${money(active.mrr)}/mo); all invoices paid and account in good standing.`;
  }

  const tail =
    billing.source !== "none" && kpis.lifetimeSpend > 0
      ? ` Lifetime spend ${money(kpis.lifetimeSpend)} across ${invoices.length} invoices. Owner: ${raw.company.owner}.`
      : ` Owner: ${raw.company.owner}.`;

  const conflictNote =
    billing.conflicts.length > 0
      ? ` ⚠ ${billing.conflicts.length} data conflict${billing.conflicts.length > 1 ? "s" : ""} between Stripe and QuickBooks — see details.`
      : "";

  return lead + tail + conflictNote;
}

export function assembleSummary(raw: RawClientData): ClientSummary {
  const subs = raw.stripe?.subscriptions ?? [];

  // Stripe-first billing with QuickBooks fallback + enrichment + conflict flags.
  const merged = mergeBilling(raw);
  const invoices = merged.invoices;

  const mrr = subs.filter((s) => s.status === "active").reduce((s, x) => s + x.mrr, 0);
  const lifetimeSpend = merged.lifetimeSpend;
  const outstandingBalance = merged.outstandingBalance;
  const nextRenewal =
    subs
      .filter((s) => s.status === "active" || s.status === "past_due")
      .map((s) => s.currentPeriodEnd)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;

  // Charts: bucket into the last 6 months. Revenue uses the unified payment
  // stream (Stripe charges, else QBO payments); invoices use the merged list.
  const window = lastNMonths(6);
  const revenueOverTime: MonthPoint[] = window.map(({ key, label }) => {
    const revenue = merged.payments
      .filter((c) => monthKey(c.date) === key)
      .reduce((s, c) => s + c.amount, 0);
    return { month: label, revenue };
  });
  const invoiceChart: MonthPoint[] = window.map(({ key, label }) => {
    const inWindow = invoices.filter((i) => monthKey(i.date) === key);
    return {
      month: label,
      paid: inWindow.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0),
      outstanding: inWindow.filter((i) => i.status !== "paid").reduce((s, i) => s + i.amount, 0),
    };
  });

  const kpis = { lifetimeSpend, mrr, arr: mrr * 12, outstandingBalance, nextRenewal };

  // Reconciliation: closed-won CRM value vs. annualized Stripe reality.
  const closedWonValue = raw.deals
    .filter((d) => d.stage.startsWith("closed") && d.stage.includes("won"))
    .reduce((s, d) => s + d.amount, 0);
  const stripeArr = kpis.arr;
  const mismatch = closedWonValue - stripeArr;
  const flagged = closedWonValue > 0 && Math.abs(mismatch) > Math.max(1000, closedWonValue * 0.1);
  const note = !raw.stripe
    ? "No Stripe data to reconcile against."
    : flagged
      ? `CRM closed-won (${money(closedWonValue)}) differs from annualized Stripe revenue (${money(stripeArr)}) by ${money(Math.abs(mismatch))}.`
      : "CRM and Stripe revenue are consistent.";

  return {
    company: raw.company,
    link: raw.link,
    summary: buildSummary(raw, kpis, merged.billing, invoices),
    health: buildHealth(raw, invoices, merged.billing.source !== "none"),
    kpis,
    charts: { revenueOverTime, invoices: invoiceChart },
    subscriptions: subs,
    deals: raw.deals,
    tickets: raw.tickets,
    invoices,
    reconciliation: { closedWonValue, stripeArr, mismatch, flagged, note },
    billing: merged.billing,
    mock: false,
  };
}
