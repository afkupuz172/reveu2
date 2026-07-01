import { useEffect, useState } from "react";
import type { Overview2 } from "../../shared/types";
import { fetchOverview2, fetchProducts } from "../api";
import Overview2Results from "./Overview2Results";
import LoadingBar from "./LoadingBar";

export default function Overview2Page({ onOpen }: { onOpen: (id: string) => void }) {
  const [products, setProducts] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [data, setData] = useState<Overview2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts()
      .then(setProducts)
      .catch((e) => setError(String(e)));
  }, []);

  const toggle = (p: string) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  const build = () => {
    if (!selected.length) return;
    setLoading(true);
    setError(null);
    setData(null);
    fetchOverview2(selected, year)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  return (
    <div>
      <div className="card">
        <h2>Product renewals &amp; upgrades</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Pick one or more products and a closed year. We find deals for those products whose renewal/upgrade pair
          touches that year, compute NRR from the pair, and cross-reference payment with QuickBooks.
        </p>
        <div className="sb-title">Products</div>
        {products.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>Loading products…</div>
        ) : (
          <div className="product-pick">
            {products.map((p) => (
              <label key={p} className={`pick ${selected.includes(p) ? "on" : ""}`}>
                <input type="checkbox" checked={selected.includes(p)} onChange={() => toggle(p)} />
                {p}
              </label>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
          <label className="toggle" style={{ color: "var(--text)" }}>
            Closed year
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{ width: 90, marginLeft: 8 }}
              className="combo-input"
            />
          </label>
          <button className="active" onClick={build} disabled={!selected.length || loading}>
            {loading ? "Building…" : "Build overview"}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            {selected.length} product{selected.length === 1 ? "" : "s"} selected
          </span>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--risk)" }}>
          Error: {error}
        </div>
      )}

      {loading && <LoadingBar title="Building product overview" detail="Collecting deals, pairs & billing…" />}

      {data && !loading && (
        <Overview2Results data={data} onOpen={onOpen} scope={<span className="badge accent">{data.products.join(", ")}</span>} />
      )}
    </div>
  );
}
