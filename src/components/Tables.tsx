import { useState } from "react";
import type { ClientSummary, MergedInvoice } from "../../shared/types";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const payClass = (s: string) =>
  s === "Paid" ? "good" : s === "Overdue" ? "risk" : s === "Pending" ? "warn" : "muted";

function ProductCells({ products }: { products: ClientSummary["deals"][number]["products"] }) {
  if (!products.length) return <span className="muted">—</span>;
  const title = products.map((p) => `${p.name} ×${p.quantity} (${usd(p.amount)})`).join("\n");
  return (
    <span title={title}>
      {products[0].name}
      {products.length > 1 && <span className="muted"> +{products.length - 1}</span>}
    </span>
  );
}

export function DealsTable({ deals }: { deals: ClientSummary["deals"] }) {
  if (!deals.length) return <div className="empty">No deals.</div>;
  return (
    <div className="scroll-box">
      <table>
        <thead>
          <tr><th>Deal</th><th>Stage</th><th>Amount</th><th>Payment</th><th>Products</th><th>Close</th></tr>
        </thead>
        <tbody>
          {deals.map((d, i) => (
            <tr key={i}>
              <td>{d.name}</td>
              <td>
                <div>{d.stageLabel}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {d.pipeline} · {d.probability}%
                </div>
              </td>
              <td>{usd(d.amount)}</td>
              <td><span className={`badge ${payClass(d.paymentStatus)}`}>{d.paymentStatus}</span></td>
              <td><ProductCells products={d.products} /></td>
              <td className="muted">{date(d.closeDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Pipeline activity: open deals grouped by stage (ordered by probability), with
// count, value bar, and a probability-weighted pipeline total.
export function PipelineCard({ deals }: { deals: ClientSummary["deals"] }) {
  const open = deals.filter((d) => !d.isClosed);
  if (!open.length) return <div className="empty">No open deals in the pipeline.</div>;
  const byStage = new Map<string, { label: string; prob: number; count: number; value: number }>();
  for (const d of open) {
    const e = byStage.get(d.stageLabel) ?? { label: d.stageLabel, prob: d.probability, count: 0, value: 0 };
    e.count += 1;
    e.value += d.amount;
    byStage.set(d.stageLabel, e);
  }
  const stages = [...byStage.values()].sort((a, b) => a.prob - b.prob);
  const max = Math.max(1, ...stages.map((s) => s.value));
  const weighted = open.reduce((a, d) => a + (d.amount * d.probability) / 100, 0);
  return (
    <div>
      {stages.map((s) => (
        <div className="factor" key={s.label}>
          <div className="row">
            <span>
              {s.label} <span className="muted">· {s.count}</span>
            </span>
            <span>
              {usd(s.value)} <span className="muted">· {s.prob}%</span>
            </span>
          </div>
          <div className="bar">
            <div style={{ width: `${(s.value / max) * 100}%`, background: "var(--accent)" }} />
          </div>
        </div>
      ))}
      <div className="muted" style={{ marginTop: 10 }}>
        Weighted pipeline (by probability): {usd(weighted)}
      </div>
    </div>
  );
}

type InvSortKey = "number" | "amount" | "status" | "source" | "date";

export function InvoicesTable({ invoices }: { invoices: ClientSummary["invoices"] }) {
  const [sort, setSort] = useState<{ key: InvSortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });
  if (!invoices.length) return <div className="empty">No invoices.</div>;
  const cls = (s: string) => (s === "paid" ? "good" : s === "overdue" ? "risk" : "warn");

  const val = (inv: MergedInvoice, key: InvSortKey): string | number =>
    key === "amount" ? inv.amount : key === "date" ? new Date(inv.date).getTime() : (inv[key] as string);
  const sorted = [...invoices].sort((a, b) => {
    const av = val(a, sort.key);
    const bv = val(b, sort.key);
    return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
  });
  const onSort = (key: InvSortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? ((s.dir === 1 ? -1 : 1) as 1 | -1) : 1 }));
  const arrow = (key: InvSortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const Th = ({ k, label }: { k: InvSortKey; label: string }) => (
    <th className="sortable" onClick={() => onSort(k)}>
      {label}
      {arrow(k)}
    </th>
  );

  return (
    <div className="scroll-box">
      <table>
        <thead>
          <tr>
            <Th k="number" label="Invoice" />
            <Th k="amount" label="Amount" />
            <Th k="status" label="Status" />
            <Th k="source" label="Source" />
            <Th k="date" label="Date" />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((inv, i) => (
            <tr key={i}>
              <td>{inv.number}</td>
              <td>{usd(inv.amount)}</td>
              <td><span className={`badge ${cls(inv.status)}`}>{inv.status}</span></td>
              <td><span className={`badge ${inv.source === "stripe" ? "stripe" : "qbo"}`}>{inv.source === "stripe" ? "Stripe" : "QuickBooks"}</span></td>
              <td className="muted">{date(inv.date)}</td>
              <td>{inv.pdfUrl ? <a href={inv.pdfUrl} target="_blank" rel="noreferrer">PDF</a> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TicketsTable({ tickets }: { tickets: ClientSummary["tickets"] }) {
  if (!tickets.length) return <div className="empty">No open tickets.</div>;
  return (
    <table>
      <thead>
        <tr><th>Subject</th><th>Status</th><th>Created</th></tr>
      </thead>
      <tbody>
        {tickets.map((t, i) => (
          <tr key={i}>
            <td>{t.subject}</td>
            <td><span className={`badge ${t.status === "open" ? "warn" : "muted"}`}>{t.status}</span></td>
            <td className="muted">{date(t.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
