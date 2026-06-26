import type { ClientSummary, Conflict, HealthBand } from "../../shared/types";
import { ArAgingBars, HealthFactors, InvoiceChart, RevenueChart } from "./Charts";
import { DealsTable, InvoicesTable, TicketsTable } from "./Tables";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const bandClass = (b: HealthBand) => (b === "Good" ? "good" : b === "Action needed" ? "warn" : "risk");
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function ConflictsCard({ conflicts }: { conflicts: Conflict[] }) {
  return (
    <div className="card recon flagged">
      <h2>Stripe ↔ QuickBooks conflicts <span className="badge risk">{conflicts.length}</span></h2>
      <table>
        <thead>
          <tr><th>Field</th><th>Stripe</th><th>QuickBooks</th></tr>
        </thead>
        <tbody>
          {conflicts.map((c, i) => (
            <tr key={i}>
              <td>{c.field}</td>
              <td className="risk">{c.stripe}</td>
              <td className="risk">{c.quickbooks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard({ data, admin }: { data: ClientSummary; admin: boolean }) {
  const { company, link, kpis, health, charts, reconciliation, billing } = data;

  return (
    <div>
      {/* Hero summary */}
      <div className="card hero">
        <div style={{ flex: 1 }}>
          <div className="company-name">{company.name}</div>
          <div className="summary">{data.summary}</div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className={`badge ${bandClass(health.band)}`}>● {health.band}</span>
            {billing.source === "quickbooks" && <span className="badge qbo">Billing via QuickBooks</span>}
            {billing.qboLinked && billing.source === "stripe" && <span className="badge qbo">QuickBooks linked</span>}
            {billing.conflicts.length > 0 && (
              <span className="badge risk">⚠ {billing.conflicts.length} conflict{billing.conflicts.length > 1 ? "s" : ""}</span>
            )}
            {admin && (
              <span className={`badge ${link.status === "linked" ? "muted" : "risk"}`}>
                {link.status === "linked" ? `Stripe: ${link.stripeCustomerId}` : `Stripe: ${link.status}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid kpis">
        <Kpi label="Lifetime spend" value={usd(kpis.lifetimeSpend)} />
        <Kpi label="MRR" value={usd(kpis.mrr)} />
        <Kpi label="ARR" value={usd(kpis.arr)} />
        <Kpi label="Outstanding" value={usd(kpis.outstandingBalance)} />
        <Kpi label="Next renewal" value={fmtDate(kpis.nextRenewal)} />
      </div>

      {/* Charts + health */}
      <div className="grid cols-3">
        <div className="card">
          <h2>Revenue (6 mo)</h2>
          <RevenueChart data={charts.revenueOverTime} />
        </div>
        <div className="card">
          <h2>Invoices: paid vs outstanding</h2>
          <InvoiceChart data={charts.invoices} />
        </div>
        <div className="card">
          <h2>Health score</h2>
          <div className="score-ring">
            <div className="score-num" style={{ color: `var(--${bandClass(health.band)})` }}>{health.score}</div>
            <div style={{ flex: 1 }}>
              <HealthFactors health={health} />
            </div>
          </div>
        </div>
      </div>

      {/* QuickBooks: A/R aging enrichment + Stripe↔QBO conflicts */}
      {billing.qboLinked && (
        <div className="grid cols-2">
          <div className="card">
            <h2>
              A/R aging — QuickBooks{" "}
              {billing.qboTerms && <span className="badge muted">{billing.qboTerms}</span>}
            </h2>
            {billing.arAging ? <ArAgingBars aging={billing.arAging} /> : <div className="empty">No A/R data.</div>}
            <div className="muted" style={{ marginTop: 10 }}>
              QuickBooks A/R balance: {usd(billing.qboBalance ?? 0)}
            </div>
          </div>
          {billing.conflicts.length > 0 ? (
            <ConflictsCard conflicts={billing.conflicts} />
          ) : (
            <div className="card">
              <h2>Stripe ↔ QuickBooks</h2>
              <div className="empty">No conflicts — Stripe and QuickBooks agree.</div>
            </div>
          )}
        </div>
      )}

      {/* Reconciliation — admin only */}
      {admin && (
        <div className={`card recon ${reconciliation.flagged ? "flagged" : ""}`}>
          <h2>CRM ↔ Stripe reconciliation {reconciliation.flagged && <span className="badge risk">mismatch</span>}</h2>
          <div style={{ display: "flex", gap: 32 }}>
            <div><div className="label muted">CRM closed-won</div><div className="value">{usd(reconciliation.closedWonValue)}</div></div>
            <div><div className="label muted">Stripe ARR</div><div className="value">{usd(reconciliation.stripeArr)}</div></div>
            <div><div className="label muted">Difference</div><div className="value">{usd(reconciliation.mismatch)}</div></div>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>{reconciliation.note}</div>
        </div>
      )}

      {/* Detail tables */}
      <div className="grid cols-2">
        <div className="card"><h2>Invoices</h2><InvoicesTable invoices={data.invoices} /></div>
        <div className="card"><h2>Open deals</h2><DealsTable deals={data.deals} /></div>
      </div>
      <div className="card"><h2>Support tickets</h2><TicketsTable tickets={data.tickets} /></div>
    </div>
  );
}
