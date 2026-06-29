import { useState } from "react";
import type { ClientSummary, MergedInvoice } from "../../shared/types";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function DealsTable({ deals }: { deals: ClientSummary["deals"] }) {
  if (!deals.length) return <div className="empty">No deals.</div>;
  return (
    <table>
      <thead>
        <tr><th>Deal</th><th>Stage</th><th>Amount</th><th>Close</th></tr>
      </thead>
      <tbody>
        {deals.map((d, i) => (
          <tr key={i}>
            <td>{d.name}</td>
            <td className="muted">{d.stage}</td>
            <td>{usd(d.amount)}</td>
            <td className="muted">{date(d.closeDate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
