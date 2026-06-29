import type { CompanyResolution, ResourceCandidate } from "../../shared/types";

function CheckList({
  title,
  badgeClass,
  candidates,
  selected,
  onToggle,
  onAll,
  onNone,
}: {
  title: string;
  badgeClass: string;
  candidates: ResourceCandidate[];
  selected: string[];
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <div className="resolve-col">
      <div className="sub">
        <span className={`badge ${badgeClass}`}>{title}</span>
        <span className="src-actions">
          <button onClick={onAll}>All</button>
          <button onClick={onNone}>None</button>
        </span>
      </div>
      <div className="cand-list">
        {candidates.map((c) => (
          <label key={c.id} className={`cand ${selected.includes(c.id) ? "sel" : ""}`}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => onToggle(c.id)} />
            <div className="cand-body">
              <div className="cand-top">
                <span className="cand-label">{c.label}</span>
                <span className="score">{c.score}</span>
              </div>
              <div className="muted cand-sub">
                {c.email || "no email"}
                {c.sublabel ? ` · ${c.sublabel}` : ""}
              </div>
              <div className="reasons">
                {c.matchReasons.map((r) => (
                  <span className="reason" key={r}>
                    {r}
                  </span>
                ))}
              </div>
            </div>
          </label>
        ))}
        {candidates.length === 0 && <div className="muted cand-empty">No matches found.</div>}
      </div>
    </div>
  );
}

export default function Sidebar({
  resolution,
  stripeSel,
  qboSel,
  onStripeToggle,
  onQboToggle,
  onStripeAll,
  onStripeNone,
  onQboAll,
  onQboNone,
}: {
  resolution: CompanyResolution;
  stripeSel: string[];
  qboSel: string[];
  onStripeToggle: (id: string) => void;
  onQboToggle: (id: string) => void;
  onStripeAll: () => void;
  onStripeNone: () => void;
  onQboAll: () => void;
  onQboNone: () => void;
}) {
  const { contacts, references, candidates, company } = resolution;
  return (
    <aside className="sidebar">
      <h2 className="sb-title">Resolve sources</h2>
      <div className="resolve-col">
        <div className="sub">HubSpot · {company.domain || "no domain"}</div>
        {contacts.length === 0 && <div className="muted">No contacts.</div>}
        {contacts.map((c, i) => (
          <div key={i} className="contact">
            <div className="contact-name">{c.name}</div>
            <div className="muted">
              {c.title ? `${c.title} · ` : ""}
              {c.email || "no email"}
            </div>
          </div>
        ))}
        <div className="sub" style={{ marginTop: 12 }}>
          Reference IDs
        </div>
        <div className="muted ref">
          Stripe: <code>{references.stripeCustomerId || "—"}</code>
        </div>
        <div className="muted ref">
          QuickBooks: <code>{references.quickbooksCustomerId || "—"}</code>
        </div>
      </div>

      <CheckList
        title="Stripe"
        badgeClass="stripe"
        candidates={candidates.stripe}
        selected={stripeSel}
        onToggle={onStripeToggle}
        onAll={onStripeAll}
        onNone={onStripeNone}
      />
      <CheckList
        title="QuickBooks"
        badgeClass="qbo"
        candidates={candidates.quickbooks}
        selected={qboSel}
        onToggle={onQboToggle}
        onAll={onQboAll}
        onNone={onQboNone}
      />
    </aside>
  );
}
