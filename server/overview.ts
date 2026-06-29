// Build the portfolio Overview from each company's raw billing: per-company NRR
// / billing status / Stripe<->QBO alignment, a this-year-vs-last-year revenue
// overlay, and the distribution of NRR health across the portfolio.

import type { Overview, OverviewRow, RawClientData } from "../shared/types";
import { assembleSummary } from "./assemble";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function buildOverview(raws: RawClientData[], mock: boolean): Overview {
  const now = new Date();
  const cy = now.getFullYear();
  const currentYear = Array<number>(12).fill(0);
  const lastYear = Array<number>(12).fill(0);

  const companies: OverviewRow[] = [];
  let expanding = 0;
  let flat = 0;
  let contracting = 0;
  let noData = 0;
  const nrrVals: number[] = [];

  for (const raw of raws) {
    const s = assembleSummary(raw);
    companies.push({
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
    });

    if (s.nrr.value == null) {
      noData++;
    } else {
      nrrVals.push(s.nrr.value);
      if (s.nrr.value > 100) expanding++;
      else if (s.nrr.value === 100) flat++;
      else contracting++;
    }

    // Revenue overlay: all selected resources' payments bucketed by calendar month/year.
    const payments = [...(raw.stripe?.charges ?? []), ...(raw.qbo?.payments ?? [])];
    for (const p of payments) {
      const d = new Date(p.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      if (y === cy) currentYear[m] += p.amount;
      else if (y === cy - 1) lastYear[m] += p.amount;
    }
  }

  const average = nrrVals.length ? Math.round(nrrVals.reduce((a, b) => a + b, 0) / nrrVals.length) : null;

  return {
    companies,
    revenue: { months: MONTHS, currentYear, lastYear },
    nrrHealth: { expanding, flat, contracting, noData, average },
    mock,
  };
}
