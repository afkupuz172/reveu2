import type { DataSource, ResourceContribution } from "../../shared/types";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export type ContribField = "lifetimeSpend" | "mrr" | "arr" | "outstanding";

// Plain-English formula for each total.
const FORMULA: Record<ContribField, string> = {
  lifetimeSpend: "Lifetime spend = Σ Stripe charges + Σ QuickBooks income received",
  mrr: "MRR = Σ active Stripe subscription MRR",
  arr: "ARR = MRR × 12",
  outstanding: "Outstanding = Σ Stripe unpaid invoices + Σ QuickBooks A/R balance",
};

// The actual underlying value being pulled from each source, so the user knows
// what the number represents (not just "value").
function valueName(field: ContribField, source: DataSource): string {
  if (field === "lifetimeSpend") return source === "stripe" ? "Stripe charges" : "QuickBooks income";
  if (field === "outstanding") return source === "stripe" ? "Stripe unpaid invoices" : "QuickBooks A/R balance";
  if (field === "mrr") return "Active subscription MRR";
  if (field === "arr") return "Active subscription ARR";
  return "Value";
}

export default function DetailsModal({
  title,
  field,
  contributions,
  onClose,
}: {
  title: string;
  field: ContribField;
  contributions: ResourceContribution[];
  onClose: () => void;
}) {
  const items = contributions.map((c) => ({ ...c, value: c[field] })).filter((c) => c.value !== 0);
  const total = items.reduce((s, i) => s + i.value, 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title} — breakdown</h3>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          How this total is calculated and which selected resource each value comes from.
        </p>
        <div className="formula">{FORMULA[field]}</div>
        {items.length === 0 ? (
          <div className="empty">No selected resource contributes to this total.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Source</th>
                <th>Value pulled</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={idx}>
                  <td>{i.label}</td>
                  <td>
                    <span className={`badge ${i.source === "stripe" ? "stripe" : "qbo"}`}>
                      {i.source === "stripe" ? "Stripe" : "QuickBooks"}
                    </span>
                  </td>
                  <td className="muted">{valueName(field, i.source)}</td>
                  <td style={{ textAlign: "right" }}>{usd(i.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ fontWeight: 700 }}>
                  Total
                </td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{usd(total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
