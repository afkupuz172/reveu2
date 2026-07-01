// Overview4: like Overview3 (price-range + closed-year, one row per reference pair,
// baseline = older closed-won, lost renewal → 0) but built PURELY from HubSpot deal
// properties — no company-name or QuickBooks fetch. Two NRRs: cus_nrr (deal amount)
// and hb_nrr (recurring: hs_arr, MRR×12 fallback). NRR health uses cus_nrr; the
// revenue trend is amount-based.

import type { Overview4, Overview4Row, Overview2Month, Overview2Series } from "../shared/types";

// Normalized deal built from HubSpot deal properties (no external data).
export interface O4Deal {
  id: string;
  name: string;
  amount: number;
  arr: number;
  mrr: number;
  lineItems: number;
  companyId: string;
  closeDate: string;
  isWon: boolean;
  isClosed: boolean;
  probability: number;
  stageLabel: string;
  dealType: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const closeYear = (iso: string) => new Date(iso).getUTCFullYear();
const closeMonth = (iso: string) => new Date(iso).getUTCMonth();
const time = (iso: string) => new Date(iso).getTime();
const recurring = (d: O4Deal) => (d.arr > 0 ? d.arr : d.mrr * 12);

function buildNrrHealth(nrrs: (number | null)[]): Overview4["nrrHealth"] {
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

export function buildOverview4(
  byId: Map<string, O4Deal>,
  pairMap: Map<string, string[]>, // seed deal id → associated deal ids
  seedIds: Set<string>,
  min: number,
  max: number,
  year: number,
): Overview4 {
  const rows: Overview4Row[] = [];
  const realizedByYear = new Map<number, number[]>();
  const expectedByYear = new Map<number, number[]>();
  const monthDeals = new Map<number, Overview2Month["deals"]>();
  const counted = new Set<string>();
  const seenPairs = new Set<string>();

  const addTrend = (d: O4Deal) => {
    if (!d.isWon && d.isClosed) return; // lost → contributes to neither
    const kind: "realized" | "expected" = d.isWon ? "realized" : "expected";
    const key = `${kind}:${d.id}`;
    if (counted.has(key)) return;
    counted.add(key);
    const y = closeYear(d.closeDate);
    const m = closeMonth(d.closeDate);
    const map = d.isWon ? realizedByYear : expectedByYear;
    if (!map.has(y)) map.set(y, Array<number>(12).fill(0));
    map.get(y)![m] += d.amount;
    if (!monthDeals.has(m)) monthDeals.set(m, []);
    monthDeals.get(m)!.push({ year: y, kind, company: d.companyId, name: d.name, amount: d.amount });
  };

  for (const sid of seedIds) {
    for (const aid of pairMap.get(sid) ?? []) {
      const s = byId.get(sid);
      const a = byId.get(aid);
      if (!s || !a) continue;
      const key = [s.id, a.id].sort().join("|");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);

      const [older, newer] = [s, a].sort((x, y) => time(x.closeDate) - time(y.closeDate));
      if (!older.isWon) continue; // baseline must be closed-won (realized)
      const lost = newer.isClosed && !newer.isWon;

      const curAmount = lost ? 0 : newer.amount;
      const curArr = lost ? 0 : newer.arr;
      const curMrr = lost ? 0 : newer.mrr;
      const cusNrr = older.amount > 0 ? Math.round((curAmount / older.amount) * 100) : null;
      const baseRec = recurring(older);
      const hbNrr = baseRec > 0 ? Math.round(((lost ? 0 : recurring(newer)) / baseRec) * 100) : null;

      rows.push({
        companyId: older.companyId || newer.companyId || "",
        originalName: older.name,
        currentName: newer.name,
        originalLineItems: older.lineItems,
        currentLineItems: newer.lineItems,
        originalAmount: older.amount,
        currentAmount: curAmount,
        originalArr: older.arr,
        currentArr: curArr,
        originalMrr: older.mrr,
        currentMrr: curMrr,
        cusNrr,
        hbNrr,
        originalCloseDate: older.closeDate,
        expectedCloseDate: newer.closeDate,
        pipelineStatus: newer.stageLabel,
        pipelineProbability: newer.probability,
        pipelineIsClosed: newer.isClosed,
        pipelineIsWon: newer.isWon,
        dealType: newer.dealType,
      });
      addTrend(older);
      addTrend(newer);
    }
  }

  const series: Overview2Series[] = [
    ...[...realizedByYear.keys()].sort().map((y) => ({ label: `Realized (${y})`, kind: "realized" as const, year: y })),
    ...[...expectedByYear.keys()].sort().map((y) => ({ label: `Expected (${y})`, kind: "expected" as const, year: y })),
  ];
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

  return { rows, min, max, year, series, months, nrrHealth: buildNrrHealth(rows.map((r) => r.cusNrr)), mock: false };
}
