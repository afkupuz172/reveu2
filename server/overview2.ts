// Overview2: pick product(s) + a closed year. Each MUTUAL deal-to-deal reference pair
// (a closed-won baseline + its associated renewal/upgrade) carrying a selected product
// and touching that year is ONE row, with NRR = renewal ÷ baseline. Pairs without a
// closed-won baseline (e.g. a closed-lost deal — new business, no NRR) are excluded.
// The trend graph draws a cumulative line per year, realized vs expected, over Jan–Dec.

import type { Deal, Overview2, Overview2Month, Overview2Row, Overview2Series, PaymentStatus, RawClientData } from "../shared/types";
import { assembleSummary } from "./assemble";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const closeYear = (iso: string) => new Date(iso).getUTCFullYear();
const closeMonth = (iso: string) => new Date(iso).getUTCMonth(); // 0–11
const time = (iso: string) => new Date(iso).getTime();

interface BuiltPair {
  companyId: string;
  companyName: string;
  baseline: Deal; // older (earlier-closing) deal — must be closed-won (realized)
  renewal: Deal; // the newer associated deal (open/expected, won, or lost)
  renewalAmount: number; // retained amount: renewal.amount, or 0 if the renewal was lost
  invoiceNumber: string | null;
  payment: { crmStatus: PaymentStatus; qboMatched: boolean; qboStatus: string | null };
}

// Build the reference pairs for one company: walk each deal's deal-to-deal
// associations, keep a pair when a selected product is present AND a closed-won
// baseline exists. Deduped by the unordered id set.
function collectPairs(raw: RawClientData, wanted: Set<string>): BuiltPair[] {
  const s = assembleSummary(raw); // enriched deals (invoice numbers) + billing (qbo)
  const byId = new Map<string, Deal>();
  for (const d of s.deals) if (d.id) byId.set(d.id, d);

  const out: BuiltPair[] = [];
  const seen = new Set<string>();

  for (const d of s.deals) {
    if (!d.id) continue;
    for (const aid of d.associatedDealIds ?? []) {
      const a = byId.get(aid);
      if (!a || !a.id) continue;
      const key = [d.id, a.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      const members = [d, a];
      if (!members.some((m) => m.products.some((p) => wanted.has(p.name)))) continue;

      // Baseline = the OLDER (earlier-closing) deal. It must be closed-won (realized
      // revenue) — if the older deal is lost/unrealized it's new business, excluded.
      const ordered = [...members].sort((x, y) => time(x.closeDate) - time(y.closeDate));
      const baseline = ordered[0];
      const renewal = ordered[1];
      if (!baseline.isWon) continue;
      // A lost renewal = churn → $0 retained (NRR 0); a won/open renewal keeps its amount.
      const renewalAmount = renewal.isClosed && !renewal.isWon ? 0 : renewal.amount;

      // Cross-reference the realized (baseline) amount with QuickBooks.
      let qboMatched = false;
      let qboStatus: string | null = null;
      const qbo = raw.qbo;
      if (qbo) {
        const near = (amt: number) => Math.abs(amt - baseline.amount) <= baseline.amount * 0.02;
        const inv = qbo.invoices.find((i) => near(i.amount));
        if (inv) {
          qboMatched = true;
          qboStatus = inv.status;
        } else if (qbo.payments.some((p) => near(p.amount))) {
          qboMatched = true;
          qboStatus = "paid";
        }
      }

      out.push({
        companyId: raw.company.id,
        companyName: raw.company.name,
        baseline,
        renewal,
        renewalAmount,
        invoiceNumber: baseline.invoiceNumber ?? null,
        payment: { crmStatus: baseline.paymentStatus, qboMatched, qboStatus },
      });
    }
  }
  return out;
}

function buildNrrHealth(nrrs: (number | null)[]): Overview2["nrrHealth"] {
  let expanding = 0;
  let flat = 0;
  let contracting = 0;
  let noData = 0;
  const vals: number[] = [];
  for (const n of nrrs) {
    if (n == null) noData++;
    else {
      vals.push(n);
      if (n > 100) expanding++;
      else if (n === 100) flat++;
      else contracting++;
    }
  }
  const average = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  return { expanding, flat, contracting, noData, average };
}

export function buildOverview2(raws: RawClientData[], products: string[], year: number): Overview2 {
  const wanted = new Set(products);
  const rows: Overview2Row[] = [];

  // Per-year monthly buckets for the trend, plus the deals behind each calendar month.
  const realizedByYear = new Map<number, number[]>(); // year → 12 monthly amounts
  const expectedByYear = new Map<number, number[]>();
  const monthDeals = new Map<number, Overview2Month["deals"]>(); // month 0–11 → deals
  const countedDeals = new Set<string>();

  const addToTrend = (deal: Deal, company: string) => {
    if (!deal.isWon && deal.isClosed) return; // closed-lost contributes to neither
    const kind: "realized" | "expected" = deal.isWon ? "realized" : "expected";
    const dedupeKey = `${kind}:${deal.id ?? `${company}:${deal.name}`}`;
    if (countedDeals.has(dedupeKey)) return;
    countedDeals.add(dedupeKey);
    const y = closeYear(deal.closeDate);
    const m = closeMonth(deal.closeDate);
    const map = kind === "realized" ? realizedByYear : expectedByYear;
    if (!map.has(y)) map.set(y, Array<number>(12).fill(0));
    map.get(y)![m] += deal.amount;
    if (!monthDeals.has(m)) monthDeals.set(m, []);
    monthDeals.get(m)!.push({ year: y, kind, company, name: deal.name, amount: deal.amount });
  };

  for (const raw of raws) {
    for (const p of collectPairs(raw, wanted)) {
      // Closed-year filter: keep when either end of the pair closes in the selected year.
      if (closeYear(p.baseline.closeDate) !== year && closeYear(p.renewal.closeDate) !== year) continue;

      const nrr = p.baseline.amount > 0 ? Math.round((p.renewalAmount / p.baseline.amount) * 100) : null;
      rows.push({
        companyId: p.companyId,
        companyName: p.companyName,
        originalName: p.baseline.name,
        currentName: p.renewal.name,
        originalProducts: p.baseline.products.map((x) => x.name),
        currentProducts: p.renewal.products.map((x) => x.name),
        originalAmount: p.baseline.amount,
        currentAmount: p.renewalAmount,
        nrr,
        originalCloseDate: p.baseline.closeDate,
        expectedCloseDate: p.renewal.closeDate,
        pipelineStatus: p.renewal.stageLabel,
        pipelineProbability: p.renewal.probability,
        pipelineIsClosed: p.renewal.isClosed,
        pipelineIsWon: p.renewal.isWon,
        invoiceNumber: p.invoiceNumber,
        payment: p.payment,
      });
      addToTrend(p.baseline, p.companyName);
      addToTrend(p.renewal, p.companyName);
    }
  }

  // Series: one realized line per close-year, one expected line per expected-close-year.
  const series: Overview2Series[] = [
    ...[...realizedByYear.keys()].sort().map((y) => ({ label: `Realized (${y})`, kind: "realized" as const, year: y })),
    ...[...expectedByYear.keys()].sort().map((y) => ({ label: `Expected (${y})`, kind: "expected" as const, year: y })),
  ];

  // Cumulate each series across Jan–Dec.
  const cumulative = new Map<string, number[]>();
  for (const s of series) {
    const monthly = (s.kind === "realized" ? realizedByYear : expectedByYear).get(s.year)!;
    const cum: number[] = [];
    let run = 0;
    for (let m = 0; m < 12; m++) {
      run += monthly[m];
      cum.push(run);
    }
    cumulative.set(s.label, cum);
  }

  const months: Overview2Month[] = MONTHS.map((label, m) => {
    const values: Record<string, number> = {};
    for (const s of series) values[s.label] = cumulative.get(s.label)![m];
    return { month: label, values, deals: monthDeals.get(m) ?? [] };
  });

  return {
    rows,
    products,
    year,
    series,
    months,
    nrrHealth: buildNrrHealth(rows.map((r) => r.nrr)),
    mock: false,
  };
}
