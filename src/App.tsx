import { useEffect, useState } from "react";
import { fetchClient, fetchClients, fetchOverview, fetchResolve } from "./api";
import type { ClientListItem, ClientSummary, CompanyResolution, Overview } from "../shared/types";
import Dashboard from "./components/Dashboard";
import Sidebar from "./components/Sidebar";
import CompanySelect from "./components/CompanySelect";
import OverviewPage from "./components/OverviewPage";
import DetailsModal, { type ContribField } from "./components/DetailsModal";

export default function App() {
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [view, setView] = useState<"dashboard" | "overview">("dashboard");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [companyId, setCompanyId] = useState<string>("");
  const [resolution, setResolution] = useState<CompanyResolution | null>(null);
  const [stripeSel, setStripeSel] = useState<string[]>([]);
  const [qboSel, setQboSel] = useState<string[]>([]);
  const [data, setData] = useState<ClientSummary | null>(null);
  const [admin, setAdmin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [details, setDetails] = useState<{ field: ContribField; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. Load companies.
  useEffect(() => {
    fetchClients()
      .then((list) => {
        setClients(list);
        if (list[0]) setCompanyId(list[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // 2. Company chosen → resolve candidates, seed selections with the best default.
  useEffect(() => {
    if (!companyId) return;
    setResolution(null);
    setData(null);
    setError(null);
    fetchResolve(companyId)
      .then((r) => {
        setResolution(r);
        setStripeSel(r.defaults.stripeId ? [r.defaults.stripeId] : []);
        setQboSel(r.defaults.quickbooksId ? [r.defaults.quickbooksId] : []);
      })
      .catch((e) => setError(String(e)));
  }, [companyId]);

  // 3. Selection changed → recompute from all selected resources.
  useEffect(() => {
    if (!resolution || resolution.company.id !== companyId) return;
    setLoading(true);
    fetchClient(companyId, stripeSel, qboSel)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [resolution, stripeSel, qboSel, companyId]);

  // Load the overview the first time the tab is opened.
  useEffect(() => {
    if (view !== "overview" || overview) return;
    fetchOverview()
      .then(setOverview)
      .catch((e) => setError(String(e)));
  }, [view, overview]);

  const toggle = (setter: typeof setStripeSel) => (id: string) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const openCompany = (id: string) => {
    setCompanyId(id);
    setView("dashboard");
  };

  return (
    <div className="app-shell">
      <header className="top">
        {view === "dashboard" && (
          <button className="icon-btn" onClick={() => setSidebarOpen((v) => !v)} title="Toggle sidebar">
            ☰
          </button>
        )}
        <h1>
          ReVue<span style={{ color: "var(--accent)" }}>2</span>
        </h1>
        <div className="tabs">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            Dashboard
          </button>
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>
            Overview
          </button>
        </div>
        {view === "dashboard" && <CompanySelect companies={clients} value={companyId} onChange={setCompanyId} />}
        <div className="spacer" />
        <label className="toggle">
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
          Admin view
        </label>
      </header>

      {error && (
        <div className="card" style={{ borderColor: "var(--risk)" }}>
          Error: {error}
        </div>
      )}

      {view === "overview" ? (
        <main className="main">
          {overview ? <OverviewPage data={overview} onOpen={openCompany} /> : <div className="spinner">Loading overview…</div>}
        </main>
      ) : (
        <div className="layout">
          {sidebarOpen && resolution && (
          <Sidebar
            resolution={resolution}
            stripeSel={stripeSel}
            qboSel={qboSel}
            onStripeToggle={toggle(setStripeSel)}
            onQboToggle={toggle(setQboSel)}
            onStripeAll={() => setStripeSel(resolution.candidates.stripe.map((c) => c.id))}
            onStripeNone={() => setStripeSel([])}
            onQboAll={() => setQboSel(resolution.candidates.quickbooks.map((c) => c.id))}
            onQboNone={() => setQboSel([])}
          />
        )}

          <main className="main">
            {data?.mock && (
              <div className="mock-banner">
                Running in <strong>mock mode</strong> — sample data. Add HubSpot &amp; Stripe keys in <code>.env</code> to go live.
              </div>
            )}
            {loading && <div className="spinner">Loading…</div>}
            {!loading && data && (
              <Dashboard data={data} admin={admin} onDetails={(field, label) => setDetails({ field, label })} />
            )}
          </main>
        </div>
      )}

      {details && data && (
        <DetailsModal
          title={details.label}
          field={details.field}
          contributions={data.contributions}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  );
}
