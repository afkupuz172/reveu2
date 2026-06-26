import { useEffect, useState } from "react";
import { fetchClient, fetchClients } from "./api";
import type { ClientListItem, ClientSummary } from "../shared/types";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [data, setData] = useState<ClientSummary | null>(null);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load the client list once.
  useEffect(() => {
    fetchClients()
      .then((list) => {
        setClients(list);
        if (list[0]) setSelected(list[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Load the selected client's dashboard.
  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    fetchClient(selected)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selected]);

  return (
    <div className="app">
      <header className="top">
        <h1>ReVue<span style={{ color: "var(--accent)" }}>2</span></h1>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <label className="toggle">
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
          Admin view
        </label>
      </header>

      {data?.mock && (
        <div className="mock-banner">
          Running in <strong>mock mode</strong> — sample data. Add HubSpot &amp; Stripe keys in <code>.env</code> to go live.
        </div>
      )}

      {error && <div className="card" style={{ borderColor: "var(--risk)" }}>Error: {error}</div>}
      {loading && <div className="spinner">Loading…</div>}
      {!loading && data && <Dashboard data={data} admin={admin} />}
    </div>
  );
}
