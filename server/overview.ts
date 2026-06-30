// Build the portfolio Overview from each company's raw billing: per-company NRR
// / billing status / Stripe<->QBO alignment, a this-year-vs-last-year revenue
// overlay, and the distribution of NRR health across the portfolio.

import type { Deal, Overview, OverviewRow, RawClientData, ScopeOption } from "../shared/types";
import { assembleSummary } from "./assemble";

// Does a deal fall within the overview's scope? null scope = everything.
function inScope(d: Deal, scope: ScopeOption | null): boolean {
  if (!scope) return true;
  return scope.kind === "product" ? d.products.some((p) => p.name === scope.value) : d.dealType === scope.value;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface OverviewRowResult {
  row: OverviewRow;
  currentYear: number[]; // 12 months
  lastYear: number[];
}

// One company's overview row + its this-year/last-year revenue buckets. When a scope
// is given, the row (NRR, invoices, ratification, open/won deals) is scoped to ONLY
// the matching deals — billing still comes from the company's selected sources.
export function buildOverviewRow(raw: RawClientData, scope?: ScopeOption | null): OverviewRowResult {
  const scoped = scope ? { ...raw, deals: raw.deals.filter((d) => inScope(d, scope)) } : raw;
  const s = assembleSummary(scoped);
  const openDeals = s.deals.filter((d) => !d.isClosed);
  const wonDeals = s.deals.filter((d) => d.isWon);
  // Invoice numbers matched to the scoped won deals; warn when any has none.
  const invoiceNumbers = wonDeals.map((d) => d.invoiceNumber).filter((n): n is string => Boolean(n));
  const missingInvoice = wonDeals.some((d) => !d.invoiceNumber);
  const row: OverviewRow = {
    id: s.company.id,
    name: s.company.name,
    nrr: s.nrr.value,
    billingSource: s.billing.source,
    band: s.health.band,
    mrr: s.kpis.mrr,
    outstanding: s.kpis.outstandingBalance,
    lifetimeSpend: s.kpis.lifetimeSpend,
    conflicts: s.billing.conflicts.length,
    aligned: s.billing.conflicts.length === 0,
    openDealCount: openDeals.length,
    openDealValue: openDeals.reduce((a, d) => a + d.amount, 0),
    paymentsDue: s.deals.filter((d) => d.paymentStatus === "Pending" || d.paymentStatus === "Overdue").length,
    wonValue: wonDeals.reduce((a, d) => a + d.amount, 0),
    invoiceNumbers,
    missingInvoice,
  };

  const now = new Date();
  const cy = now.getFullYear();
  const currentYear = Array<number>(12).fill(0);
  const lastYear = Array<number>(12).fill(0);
  const payments = [...(raw.stripe?.charges ?? []), ...(raw.qbo?.payments ?? [])];
  for (const p of payments) {
    const d = new Date(p.date);
    const y = d.getFullYear();
    const m = d.getMonth();
    if (y === cy) currentYear[m] += p.amount;
    else if (y === cy - 1) lastYear[m] += p.amount;
  }
  return { row, currentYear, lastYear };
}

export function buildOverview(raws: RawClientData[], mock: boolean, scope: ScopeOption | null = null): Overview {
  const currentYear = Array<number>(12).fill(0);
  const lastYear = Array<number>(12).fill(0);
  const companies: OverviewRow[] = [];
  let expanding = 0;
  let flat = 0;
  let contracting = 0;
  let noData = 0;
  const nrrVals: number[] = [];

  for (const raw of raws) {
    const { row, currentYear: cyr, lastYear: lyr } = buildOverviewRow(raw, scope);
    companies.push(row);
    if (row.nrr == null) noData++;
    else {
      nrrVals.push(row.nrr);
      if (row.nrr > 100) expanding++;
      else if (row.nrr === 100) flat++;
      else contracting++;
    }
    cyr.forEach((v, m) => (currentYear[m] += v));
    lyr.forEach((v, m) => (lastYear[m] += v));
  }

  const average = nrrVals.length ? Math.round(nrrVals.reduce((a, b) => a + b, 0) / nrrVals.length) : null;
  return {
    companies,
    scope,
    revenue: { months: MONTHS, currentYear, lastYear },
    nrrHealth: { expanding, flat, contracting, noData, average },
    mock,
  };
}
