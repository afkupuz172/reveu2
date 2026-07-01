import { useState } from "react";
import type { Overview4 } from "../../shared/types";
import { fetchOverview4 } from "../api";
import { NrrHealthChart, RealizedExpectedChart } from "./Charts";
import LoadingBar from "./LoadingBar";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Row = Overview4["rows"][number];

// Approximate a HubSpot stage color (API exposes no stage color): won → green,
// lost → red, open → blue→amber→grey by probability.
function pipelineColor(r: Row): string {
  if (r.pipelineIsWon) return "#2fb774";
  if (r.pipelineIsClosed) return "#e2543f";
  if (r.pipelineProbability >= 80) return "#5b8cff";
  if (r.pipelineProbability >= 50) return "#7aa2ff";
  if (r.pipelineProbability >= 20) return "#e0a13a";
  return "#8a97b1";
}

type SortKey = "company" | "amount" | "arr" | "cusNrr" | "hbNrr" | "originalClose" | "expectedClose" | "pipeline";

export default function Overview4Page({ onOpen }: { onOpen: (id: string) => void }) {
  const [min, setMin] = useState<number>(0);
  const [max, setMax] = useState<number>(50000);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [data, setData] = useState<Overview4 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = () => {
    if (min > max) {
      setError("Min price must be ≤ max price.");
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    fetchOverview4(min, max, year)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  const numInput = (value: number, onChange: (n: number) => void, width: number) => (
    <input type="number" className="combo-input" style={{ width, marginLeft: 8 }} value={value} onChange={(e) => onChange(Number(e.target.value))} />
  );

  return (
    <div>
      <div className="card">
        <h2>Renewals by price &amp; close year — deal data only</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Finds deals in the price range closing that year and pairs them with their associated deal, using only HubSpot
          deal properties (3 calls: search + batch associations + batch read). No company-name or QuickBooks lookups.
        </p>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <label className="toggle" style={{ color: "var(--text)" }}>Min price {numInput(min, setMin, 120)}</label>
          <label className="toggle" style={{ color: "var(--text)" }}>Max price {numInput(max, setMax, 120)}</label>
          <label className="toggle" style={{ color: "var(--text)" }}>Closed year {numInput(year, setYear, 90)}</label>
          <button className="active" onClick={build} disabled={loading}>
            {loading ? "Building…" : "Build overview"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--risk)" }}>
          Error: {error}
        </div>
      )}
      {loading && <LoadingBar title="Building deal overview" detail="Searching deals & batch-reading properties…" />}
      {data && !loading && <Results data={data} onOpen={onOpen} />}
    </div>
  );
}

function Results({ data, onOpen }: { data: Overview4; onOpen: (id: string) => void }) {
  const { expanding, contracting, average } = data.nrrHealth;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "company", dir: 1 });

  const val = (r: Row, k: SortKey): string | number =>
    k === "company"
      ? r.companyId
      : k === "amount"
        ? r.currentAmount
        : k === "arr"
          ? r.currentArr
          : k === "cusNrr"
            ? r.cusNrr ?? -1
            : k === "hbNrr"
              ? r.hbNrr ?? -1
              : k === "originalClose"
                ? new Date(r.originalCloseDate).getTime()
                : k === "expectedClose"
                  ? new Date(r.expectedCloseDate).getTime()
                  : r.pipelineStatus;
  const sorted = [...data.rows].sort((a, b) => {
    const av = val(a, sort.key);
    const bv = val(b, sort.key);
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sort.dir;
    return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
  });
  const onSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? ((s.dir === 1 ? -1 : 1) as 1 | -1) : 1 }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th className="sortable" onClick={() => onSort(k)}>
      {label}
      {arrow(k)}
    </th>
  );
  const pair = (a: number | string, b: number | string) => (
    <>
      {a} <span className="muted">→</span> {b}
    </>
  );

  return (
    <div>
      <div className="card hero">
        <div style={{ flex: 1 }}>
          <div className="company-name">
            {data.rows.length} renewal pair{data.rows.length === 1 ? "" : "s"} ·{" "}
            <span className="badge accent">{usd(data.min)}–{usd(data.max)}</span> <span className="badge muted">closed {data.year}</span>
          </div>
          <div className="summary">
            Average NRR (cus) {average != null ? `${average}%` : "—"} · {expanding} expanding · {contracting} contracting.
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Revenue trend — cumulative by year</h2>
          {data.series.length ? <RealizedExpectedChart series={data.series} months={data.months} /> : <div className="empty">No deals to chart.</div>}
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Amount-based, cumulative across Jan–Dec for each year. Hover a point for that month's deals.</div>
        </div>
        <div className="card">
          <h2>NRR health (cus_nrr) {average != null && <span className="badge muted">avg {average}%</span>}</h2>
          <NrrHealthChart nrrHealth={data.nrrHealth} />
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            {expanding} expanding (&gt;100%) · {data.nrrHealth.flat} flat · {contracting} contracting · {data.nrrHealth.noData} no renewal
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Renewal pairs</h2>
        {data.rows.length === 0 ? (
          <div className="empty">No renewal pairs for this price range closing in {data.year}.</div>
        ) : (
          <div className="scroll-box">
            <table>
              <thead>
                <tr>
                  <Th k="company" label="Company id" />
                  <th>Deals (original → renewal)</th>
                  <th>Line items</th>
                  <Th k="amount" label="Amount" />
                  <Th k="arr" label="ARR" />
                  <th>MRR</th>
                  <Th k="cusNrr" label="cus_nrr" />
                  <Th k="hbNrr" label="hb_nrr" />
                  <Th k="originalClose" label="Original close" />
                  <Th k="expectedClose" label="Expected close" />
                  <Th k="pipeline" label="Pipeline (expected)" />
                  <th>Deal type</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const c = pipelineColor(r);
                  return (
                    <tr key={`${r.companyId}:${i}`} className="row-link" onClick={() => r.companyId && onOpen(r.companyId)}>
                      <td className="muted" style={{ fontSize: 12 }}>{r.companyId || "—"}</td>
                      <td style={{ fontSize: 12 }}>{pair(r.originalName, r.currentName)}</td>
                      <td className="muted">{pair(r.originalLineItems, r.currentLineItems)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{pair(usd(r.originalAmount), usd(r.currentAmount))}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{pair(usd(r.originalArr), usd(r.currentArr))}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{pair(usd(r.originalMrr), usd(r.currentMrr))}</td>
                      <td>{r.cusNrr != null ? `${r.cusNrr}%` : "—"}</td>
                      <td>{r.hbNrr != null ? `${r.hbNrr}%` : "—"}</td>
                      <td className="muted">{fmtDate(r.originalCloseDate)}</td>
                      <td className="muted">{fmtDate(r.expectedCloseDate)}</td>
                      <td>
                        <span className="badge" style={{ color: c, background: `${c}22`, border: `1px solid ${c}55` }}>{r.pipelineStatus}</span>
                      </td>
                      <td className="muted">{r.dealType || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
