import { useEffect, useState } from "react";
import { fetchClient, fetchClients, fetchOverviewCompanies, fetchOverviewOptions, fetchOverviewRow, fetchResolve } from "./api";
import type { ClientListItem, ClientSummary, CompanyResolution, Overview, ScopeOption } from "../shared/types";
import Dashboard from "./components/Dashboard";
import Sidebar from "./components/Sidebar";
import CompanySelect from "./components/CompanySelect";
import OverviewPage from "./components/OverviewPage";
import Overview2Page from "./components/Overview2Page";
import ScopeSelect from "./components/ScopeSelect";
import LoadingBar from "./components/LoadingBar";
import DetailsModal, { type ContribField } from "./components/DetailsModal";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function App() {
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [view, setView] = useState<"dashboard" | "overview" | "overview2">("dashboard");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [companyId, setCompanyId] = useState<string>("");
  const [resolution, setResolution] = useState<CompanyResolution | null>(null);
  const [stripeSel, setStripeSel] = useState<string[]>([]);
  const [qboSel, setQboSel] = useState<string[]>([]);
  const [data, setData] = useState<ClientSummary | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [details, setDetails] = useState<{ field: ContribField; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadPhase, setLoadPhase] = useState<"idle" | "list" | "resolving" | "billing">("list");
  const [ovProgress, setOvProgress] = useState<{ current: number; total: number; detail: string } | null>(null);
  // Overview is scoped to a deal type or product chosen before it loads.
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
  const [overviewScope, setOverviewScope] = useState<ScopeOption | null>(null);

  // 1. Load companies.
  useEffect(() => {
    setLoadPhase("list");
    fetchClients()
      .then((list) => {
        setClients(list);
        if (list[0]) setCompanyId(list[0].id);
        else setLoadPhase("idle");
      })
      .catch((e) => {
        setError(String(e));
        setLoadPhase("idle");
      });
  }, []);

  // 2. Company chosen → resolve candidates, seed selections with the best default.
  // The `cancelled` flag drops a stale resolution if the user switches company
  // before this request lands, so a slow response can't overwrite a newer one.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setResolution(null);
    setData(null);
    setError(null);
    setLoadPhase("resolving");
    fetchResolve(companyId)
      .then((r) => {
        if (cancelled) return;
        setResolution(r);
        setStripeSel(r.defaults.stripeId ? [r.defaults.stripeId] : []);
        setQboSel(r.defaults.quickbooksId ? [r.defaults.quickbooksId] : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoadPhase("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // 3. Selection changed → recompute from all selected resources. Same stale-guard:
  // switching company or selection mid-flight must not let an older response win.
  useEffect(() => {
    if (!resolution || resolution.company.id !== companyId) return;
    let cancelled = false;
    setLoadPhase("billing");
    fetchClient(companyId, stripeSel, qboSel)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadPhase("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [resolution, stripeSel, qboSel, companyId]);

  // Load the scope options (deal types + products) once the user opens the Overview
  // tab, so they can pick a scope before anything heavy loads.
  useEffect(() => {
    if (view !== "overview" || scopeOptions.length) return;
    let cancelled = false;
    fetchOverviewOptions()
      .then((o) => !cancelled && setScopeOptions(o))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [view, scopeOptions.length]);

  // Overview: once a scope is chosen, fetch only the companies with a matching deal,
  // then collect each progressively so we can report what's loading.
  useEffect(() => {
    if (view !== "overview" || !overviewScope || overview) return;
    let cancelled = false;
    const scope = overviewScope;
    (async () => {
      setError(null);
      setOvProgress({ current: 0, total: 0, detail: `Finding companies for ${scope.label}…` });
      try {
        const list = await fetchOverviewCompanies(scope);
        const cy = Array<number>(12).fill(0);
        const ly = Array<number>(12).fill(0);
        const rows = [];
        let mock = false;
        for (let i = 0; i < list.length; i++) {
          if (cancelled) return;
          setOvProgress({ current: i, total: list.length, detail: `Collecting billing for ${list[i].name}` });
          const r = await fetchOverviewRow(list[i].id, scope);
          rows.push(r.row);
          mock = r.mock;
          r.revenue.currentYear.forEach((v, m) => (cy[m] += v));
          r.revenue.lastYear.forEach((v, m) => (ly[m] += v));
        }
        if (cancelled) return;
        let expanding = 0,
          flat = 0,
          contracting = 0,
          noData = 0;
        const vals: number[] = [];
        for (const row of rows) {
          if (row.nrr == null) noData++;
          else {
            vals.push(row.nrr);
            if (row.nrr > 100) expanding++;
            else if (row.nrr === 100) flat++;
            else contracting++;
          }
        }
        const average = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
        setOverview({
          companies: rows,
          scope,
          revenue: { months: MONTHS, currentYear: cy, lastYear: ly },
          nrrHealth: { expanding, flat, contracting, noData, average },
          mock,
        });
        setOvProgress(null);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setOvProgress(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, overviewScope, overview]);

  const toggle = (setter: typeof setStripeSel) => (id: string) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const openCompany = (id: string) => {
    setCompanyId(id);
    setView("dashboard");
  };

  // Pick a scope (deal type or product) for the overview (clears any prior one so it rebuilds).
  const selectScope = (option: ScopeOption) => {
    setOverview(null);
    setError(null);
    setOverviewScope(option);
  };
  // Back to the scope chooser.
  const changeScope = () => {
    setOverview(null);
    setOverviewScope(null);
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
          <button className={view === "overview2" ? "active" : ""} onClick={() => setView("overview2")}>
            Overview2
          </button>
        </div>
        {view === "dashboard" && <CompanySelect companies={clients} value={companyId} onChange={setCompanyId} />}
        <div className="spacer" />
      </header>

      {error && (
        <div className="card" style={{ borderColor: "var(--risk)" }}>
          Error: {error}
        </div>
      )}

      {view === "overview" ? (
        <main className="main">
          {!overviewScope ? (
            <ScopeSelect options={scopeOptions} onSelect={selectScope} />
          ) : overview ? (
            <OverviewPage data={overview} onOpen={openCompany} onChangeScope={changeScope} />
          ) : (
            <LoadingBar
              title="Building portfolio overview"
              detail={ovProgress?.detail ?? "Starting…"}
              progress={ovProgress && ovProgress.total > 0 ? { current: ovProgress.current, total: ovProgress.total } : undefined}
            />
          )}
        </main>
      ) : view === "overview2" ? (
        <main className="main">
          <Overview2Page onOpen={openCompany} />
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
            {loadPhase !== "idle" ? (
              loadPhase === "list" ? (
                <LoadingBar title="Loading companies" detail="Fetching your companies from HubSpot…" />
              ) : (
                <LoadingBar
                  title={`Loading ${clients.find((c) => c.id === companyId)?.name ?? "company"}`}
                  steps={[
                    { label: "Matching Stripe & QuickBooks resources", status: loadPhase === "resolving" ? "active" : "done" },
                    {
                      label: "Fetching billing & CRM data",
                      status: loadPhase === "resolving" ? "pending" : "active",
                    },
                  ]}
                />
              )
            ) : (
              data && <Dashboard data={data} onDetails={(field, label) => setDetails({ field, label })} />
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
