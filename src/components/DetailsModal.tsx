import type { ResourceContribution } from "../../shared/types";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export type ContribField = "lifetimeSpend" | "mrr" | "arr" | "outstanding";

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
        {items.length === 0 ? (
          <div className="empty">No selected resource contributes to this total.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Value</th>
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
                  <td style={{ textAlign: "right" }}>{usd(i.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ fontWeight: 700 }}>
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
