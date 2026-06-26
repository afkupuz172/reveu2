import type { ClientSummary } from "../../shared/types";

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

export function InvoicesTable({ invoices }: { invoices: ClientSummary["invoices"] }) {
  if (!invoices.length) return <div className="empty">No invoices.</div>;
  const cls = (s: string) => (s === "paid" ? "good" : s === "overdue" ? "risk" : "warn");
  return (
    <table>
      <thead>
        <tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Source</th><th>Date</th><th></th></tr>
      </thead>
      <tbody>
        {invoices.slice().reverse().map((inv, i) => (
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
