import type { ScopeOption } from "../../shared/types";

// Shown before the Overview loads: the user picks a scope — a deal type OR a product
// — from the values actually present on HubSpot deals/line items. Only companies with
// a matching deal are then collected.
export default function ScopeSelect({
  options,
  onSelect,
}: {
  options: ScopeOption[];
  onSelect: (option: ScopeOption) => void;
}) {
  const dealTypes = options.filter((o) => o.kind === "dealType");
  const products = options.filter((o) => o.kind === "product");

  const group = (title: string, items: ScopeOption[]) => (
    <div className="scope-group">
      <div className="sb-title">{title}</div>
      {items.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>
          None in use.
        </div>
      ) : (
        <div className="dealtype-grid">
          {items.map((o) => (
            <button key={`${o.kind}:${o.value}`} className="dealtype-card" onClick={() => onSelect(o)}>
              <div className="dealtype-label">{o.label}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {o.kind === "product" ? "Product" : o.value}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="card">
      <h2>Portfolio overview</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Pick a deal type or product to scope the overview. We pull only the companies that have a
        matching deal, compute NRR from their pipeline, and back it with Stripe/QuickBooks billing.
      </p>
      {options.length === 0 ? (
        <div className="empty">Loading deal types &amp; products…</div>
      ) : (
        <>
          {group("Deal types", dealTypes)}
          {group("Products", products)}
        </>
      )}
    </div>
  );
}
