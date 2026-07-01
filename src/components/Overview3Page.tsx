import { useState } from "react";
import type { Overview2 } from "../../shared/types";
import { fetchOverview3 } from "../api";
import Overview2Results from "./Overview2Results";
import LoadingBar from "./LoadingBar";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function Overview3Page({ onOpen }: { onOpen: (id: string) => void }) {
  const [min, setMin] = useState<number>(0);
  const [max, setMax] = useState<number>(50000);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [data, setData] = useState<Overview2 | null>(null);
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
    fetchOverview3(min, max, year)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  const numInput = (value: number, onChange: (n: number) => void, width: number) => (
    <input
      type="number"
      className="combo-input"
      style={{ width, marginLeft: 8 }}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );

  return (
    <div>
      <div className="card">
        <h2>Deals by price &amp; close year</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Enter a deal price range and a closed year. We find deals in that range closing that year, pull their
          associated (paired) deal, and compute NRR — populated the same way as Overview2.
        </p>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <label className="toggle" style={{ color: "var(--text)" }}>
            Min price {numInput(min, setMin, 120)}
          </label>
          <label className="toggle" style={{ color: "var(--text)" }}>
            Max price {numInput(max, setMax, 120)}
          </label>
          <label className="toggle" style={{ color: "var(--text)" }}>
            Closed year {numInput(year, setYear, 90)}
          </label>
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

      {loading && <LoadingBar title="Building price overview" detail="Collecting deals, pairs & billing…" />}

      {data && !loading && (
        <Overview2Results data={data} onOpen={onOpen} scope={<span className="badge accent">{usd(min)}–{usd(max)}</span>} />
      )}
    </div>
  );
}
