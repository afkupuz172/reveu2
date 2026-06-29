// Pure computation: RawClientData -> ClientSummary.
// Sum-all billing: every selected Stripe + QuickBooks resource is already unioned
// into raw.stripe / raw.qbo, and here their values are summed into the totals and
// charts. Stripe<->QuickBooks invoice disagreements are still surfaced as conflicts.

import type {
  ClientSummary,
  Conflict,
  DataSource,
  HealthBand,
  HealthFactor,
  MergedInvoice,
  MonthPoint,
  RawClientData,
} from "../shared/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
const digits = (s: string) => s.replace(/\D/g, "");

// Same invoice number in both Stripe and QBO but a different status = a conflict.
function detectConflicts(stripeInv: MergedInvoice[], qboInv: MergedInvoice[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const q of qboInv) {
    const qd = digits(q.number);
    if (!qd) continue;
    const match = stripeInv.find((s) => digits(s.number) === qd);
    if (match && match.status !== q.status) {
      conflicts.push({
        field: `Invoice ${match.number} status`,
        stripe: match.status,
        quickbooks: q.status,
        note: `Stripe shows "${match.status}", QuickBooks shows "${q.status}" for the same ${money(q.amount)} invoice.`,
      });
    }
  }
  return conflicts;
}

function buildHealth(
  raw: RawClientData,
  invoices: MergedInvoice[],
  hasBilling: boolean,
): { score: number; band: HealthBand; factors: HealthFactor[] } {
  const subs = raw.stripe?.subscriptions ?? [];
  const hasActive = subs.some((s) => s.status === "active");
  const overdue = invoices.filter((i) => i.status === "overdue").length;
  const open = invoices.filter((i) => i.status === "open").length;
  const nextRenewalDays = subs
    .filter((s) => s.status === "active" || s.status === "past_due")
    .map((s) => daysUntil(s.currentPeriodEnd))
    .sort((a, b) => a - b)[0];
  const openDealValue = raw.deals.filter((d) => !d.stage.startsWith("closed")).reduce((s, d) => s + d.amount, 0);

  let payment = 40 - overdue * 20 - open * 8;
  if (!hasBilling) payment = 10;
  payment = Math.max(0, Math.min(40, payment));

  const d = raw.lastActivityDays;
  const engagement = d <= 14 ? 30 : d <= 30 ? 20 : d <= 60 ? 10 : 0;

  let renewal: number;
  if (!hasActive) renewal = 0;
  else if (nextRenewalDays !== undefined && nextRenewalDays <= 30) renewal = subs.some((s) => s.autoRenew) ? 14 : 6;
  else renewal = subs.some((s) => s.autoRenew) ? 20 : 12;

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

  let lead: string;
  if (billing.source === "none") {
    lead = `${raw.company.name} has no connected billing in Stripe or QuickBooks yet — link an account to see spending.`;
  } else if (overdue.length > 0) {
    const total = overdue.reduce((s, i) => s + i.amount, 0);
    lead = `${overdue.length} overdue invoice${overdue.length > 1 ? "s" : ""} totaling ${money(total)} — please settle to keep the account in good standing.`;
  } else if (viaQbo) {
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
  const stripe = raw.stripe;
  const qbo = raw.qbo;

  // Tagged invoice union (no dedup — sum-all).
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
  const invoices = [...stripeInvoices, ...qboInvoices].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // Sum-all totals: Stripe + QuickBooks both count.
  const stripeSpend =
    (stripe?.charges ?? []).reduce((s, c) => s + c.amount, 0) ||
    stripeInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0);
  const lifetimeSpend = stripeSpend + (qbo?.totalIncome ?? 0);
  const mrr = subs.filter((s) => s.status === "active").reduce((s, x) => s + x.mrr, 0);
  const stripeOutstanding = stripeInvoices.filter((i) => i.status !== "paid").reduce((s, i) => s + i.amount, 0);
  const outstandingBalance = stripeOutstanding + (qbo?.balance ?? 0);
  const nextRenewal =
    subs
      .filter((s) => s.status === "active" || s.status === "past_due")
      .map((s) => s.currentPeriodEnd)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;

  // Charts: every selected resource's payments + invoices, last 6 months.
  const payments = [...(stripe?.charges ?? []), ...(qbo?.payments ?? [])];
  const window = lastNMonths(6);
  const revenueOverTime: MonthPoint[] = window.map(({ key, label }) => ({
    month: label,
    revenue: payments.filter((c) => monthKey(c.date) === key).reduce((s, c) => s + c.amount, 0),
  }));
  const invoiceChart: MonthPoint[] = window.map(({ key, label }) => {
    const inWindow = invoices.filter((i) => monthKey(i.date) === key);
    return {
      month: label,
      paid: inWindow.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0),
      outstanding: inWindow.filter((i) => i.status !== "paid").reduce((s, i) => s + i.amount, 0),
    };
  });

  const kpis = { lifetimeSpend, mrr, arr: mrr * 12, outstandingBalance, nextRenewal };

  const source: DataSource | "none" = stripe ? "stripe" : qbo ? "quickbooks" : "none";
  const billing: ClientSummary["billing"] = {
    source,
    qboLinked: Boolean(qbo),
    qboBalance: qbo?.balance ?? null,
    qboTerms: qbo?.terms ?? null,
    arAging: qbo?.arAging ?? null,
    conflicts: detectConflicts(stripeInvoices, qboInvoices),
  };

  // Reconciliation: closed-won CRM value vs. annualized Stripe reality.
  const closedWonValue = raw.deals
    .filter((d) => d.stage.startsWith("closed") && d.stage.includes("won"))
    .reduce((s, d) => s + d.amount, 0);
  const stripeArr = mrr * 12;
  const mismatch = closedWonValue - stripeArr;
  const flagged = closedWonValue > 0 && Math.abs(mismatch) > Math.max(1000, closedWonValue * 0.1);
  const note = !stripe
    ? "No Stripe data to reconcile against."
    : flagged
      ? `CRM closed-won (${money(closedWonValue)}) differs from annualized Stripe revenue (${money(stripeArr)}) by ${money(Math.abs(mismatch))}.`
      : "CRM and Stripe revenue are consistent.";

  const contributions = raw.contributions ?? [];

  return {
    company: raw.company,
    link: raw.link,
    summary: buildSummary(raw, kpis, billing, invoices),
    health: buildHealth(raw, invoices, source !== "none"),
    kpis,
    charts: { revenueOverTime, invoices: invoiceChart },
    subscriptions: subs,
    deals: raw.deals,
    tickets: raw.tickets,
    invoices,
    reconciliation: { closedWonValue, stripeArr, mismatch, flagged, note },
    billing,
    selected: {
      stripeIds: raw.selectedStripeIds ?? contributions.filter((c) => c.source === "stripe").map((c) => c.id),
      quickbooksIds: raw.selectedQuickbooksIds ?? contributions.filter((c) => c.source === "quickbooks").map((c) => c.id),
    },
    contributions,
    mock: false,
  };
}
