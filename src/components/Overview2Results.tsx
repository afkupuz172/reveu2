import { useState, type ReactNode } from "react";
import type { Overview2 } from "../../shared/types";
import { NrrHealthChart, RealizedExpectedChart } from "./Charts";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const payClass = (s: string) => (s === "Paid" ? "good" : s === "Overdue" ? "risk" : s === "Pending" ? "warn" : "muted");

type Row = Overview2["rows"][number];

// Approximate a HubSpot deal-stage color (HubSpot's API doesn't expose stage colors):
// won → green, lost → red, open → blue→amber→grey by probability.
function pipelineColor(r: Row): string {
  if (r.pipelineIsWon) return "#2fb774";
  if (r.pipelineIsClosed) return "#e2543f";
  if (r.pipelineProbability >= 80) return "#5b8cff";
  if (r.pipelineProbability >= 50) return "#7aa2ff";
  if (r.pipelineProbability >= 20) return "#e0a13a";
  return "#8a97b1";
}

type SortKey = "company" | "amount" | "nrr" | "originalClose" | "expectedClose" | "pipeline";

// Shared renewal-pairs results: hero + revenue/NRR charts + sortable pairs table.
// Used by both Overview2 (product scope) and Overview3 (price-range scope) — `scope`
// is the descriptor shown in the hero.
export default function Overview2Results({ data, onOpen, scope }: { data: Overview2; onOpen: (id: string) => void; scope: ReactNode }) {
  const { expanding, contracting, average } = data.nrrHealth;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "company", dir: 1 });

  const val = (r: Row, k: SortKey): string | number =>
    k === "company"
      ? r.companyName
      : k === "amount"
        ? r.currentAmount
        : k === "nrr"
          ? r.nrr ?? -1
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

  return (
    <div>
      <div className="card hero">
        <div style={{ flex: 1 }}>
          <div className="company-name">
            {data.rows.length} renewal pair{data.rows.length === 1 ? "" : "s"} · {scope}{" "}
            <span className="badge muted">closed {data.year}</span>
          </div>
          <div className="summary">
            Average NRR {average != null ? `${average}%` : "—"} · {expanding} expanding · {contracting} contracting ·{" "}
            {data.rows.filter((r) => !r.payment.qboMatched).length} not matched in QuickBooks ·{" "}
            {data.rows.filter((r) => !r.invoiceNumber).length} missing an invoice.
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Revenue trend — cumulative by year</h2>
          {data.series.length ? (
            <RealizedExpectedChart series={data.series} months={data.months} />
          ) : (
            <div className="empty">No deals to chart.</div>
          )}
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Realized (closed-won) and expected (open) income, cumulative across Jan–Dec for each year. Hover a point to list that month's deals.
          </div>
        </div>
        <div className="card">
          <h2>NRR health {average != null && <span className="badge muted">avg {average}%</span>}</h2>
          <NrrHealthChart nrrHealth={data.nrrHealth} />
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            {expanding} expanding (&gt;100%) · {data.nrrHealth.flat} flat · {contracting} contracting · {data.nrrHealth.noData} no renewal
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Renewal pairs</h2>
        {data.rows.length === 0 ? (
          <div className="empty">No renewal pairs found.</div>
        ) : (
          <div className="scroll-box">
            <table>
              <thead>
                <tr>
                  <Th k="company" label="Company" />
                  <th>Deals (original → renewal)</th>
                  <th>Products (old → new)</th>
                  <Th k="amount" label="Amount" />
                  <Th k="nrr" label="NRR" />
                  <Th k="originalClose" label="Original close" />
                  <Th k="expectedClose" label="Expected close" />
                  <Th k="pipeline" label="Pipeline (expected)" />
                  <th>Invoice</th>
                  <th>Payment (QBO)</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const c = pipelineColor(r);
                  return (
                    <tr key={`${r.companyId}:${i}`} className="row-link" onClick={() => onOpen(r.companyId)}>
                      <td>{r.companyName}</td>
                      <td style={{ fontSize: 12 }}>
                        {r.originalName} <span className="muted">→</span> {r.currentName}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {r.originalProducts.join(", ") || "—"} <span className="muted">→</span> {r.currentProducts.join(", ") || "—"}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {usd(r.originalAmount)} → {usd(r.currentAmount)}
                      </td>
                      <td>{r.nrr != null ? `${r.nrr}%` : "—"}</td>
                      <td className="muted">{fmtDate(r.originalCloseDate)}</td>
                      <td className="muted">{fmtDate(r.expectedCloseDate)}</td>
                      <td>
                        <span className="badge" style={{ color: c, background: `${c}22`, border: `1px solid ${c}55` }}>
                          {r.pipelineStatus}
                        </span>
                      </td>
                      <td>
                        {r.invoiceNumber ? (
                          r.invoiceNumber
                        ) : (
                          <span className="badge risk" title="No matching invoice found">⚠ missing</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${payClass(r.payment.crmStatus)}`}>{r.payment.crmStatus}</span>{" "}
                        {r.payment.qboMatched ? (
                          <span className="muted" style={{ fontSize: 11 }}>✓ QBO {r.payment.qboStatus}</span>
                        ) : (
                          <span className="badge risk" title="No corresponding QuickBooks record">⚠ not in QBO</span>
                        )}
                      </td>
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
