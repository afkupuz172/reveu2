import { useState } from "react";
import type { Overview, OverviewRow } from "../../shared/types";
import { NrrHealthChart, RevenueOverlayChart } from "./Charts";

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const bandClass = (b: string) => (b === "Good" ? "good" : b === "Action needed" ? "warn" : "risk");
const srcLabel = (s: string) => (s === "stripe" ? "Stripe" : s === "quickbooks" ? "QuickBooks" : "None");
const srcClass = (s: string) => (s === "stripe" ? "stripe" : s === "quickbooks" ? "qbo" : "muted");

type SortKey = "name" | "nrr" | "billingSource" | "band" | "outstanding" | "aligned" | "openDealValue" | "paymentsDue";

export default function OverviewPage({
  data,
  onOpen,
  onChangeScope,
}: {
  data: Overview;
  onOpen: (id: string) => void;
  onChangeScope: () => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const scopeLabel = data.scope?.label ?? "All deals";
  const scopeKind = data.scope?.kind === "product" ? "Product" : "Deal type";

  const val = (r: OverviewRow, k: SortKey): string | number =>
    k === "nrr"
      ? r.nrr ?? -1
      : k === "outstanding" || k === "openDealValue" || k === "paymentsDue"
        ? (r[k] as number)
        : k === "aligned"
          ? r.aligned
            ? 1
            : 0
          : (r[k] as string);
  const sorted = [...data.companies].sort((a, b) => {
    const av = val(a, sort.key);
    const bv = val(b, sort.key);
    return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
  });
  const onSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? ((s.dir === 1 ? -1 : 1) as 1 | -1) : 1 }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th className="sortable" onClick={() => onSort(k)}>
      {label}
      {arrow(k)}
    </th>
  );

  const { expanding, flat, contracting, noData, average } = data.nrrHealth;

  return (
    <div>
      <div className="card hero">
        <div style={{ flex: 1 }}>
          <div className="company-name">
            Portfolio overview · {data.companies.length} companies{" "}
            <span className="badge accent" title={scopeKind}>
              {scopeLabel}
            </span>
          </div>
          <div className="summary">
            Average NRR {average != null ? `${average}%` : "—"} · {expanding} expanding · {contracting} contracting ·{" "}
            {data.companies.filter((c) => !c.aligned).length} with Stripe/QuickBooks conflicts ·{" "}
            {data.companies.filter((c) => c.missingInvoice).length} with a missing invoice.
          </div>
        </div>
        <button className="icon-btn" onClick={onChangeScope} title="Change scope">
          Change scope
        </button>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Revenue trend — this year vs last year</h2>
          <RevenueOverlayChart revenue={data.revenue} />
        </div>
        <div className="card">
          <h2>NRR health {average != null && <span className="badge muted">avg {average}%</span>}</h2>
          <NrrHealthChart nrrHealth={data.nrrHealth} />
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            {expanding} expanding (&gt;100%) · {flat} flat · {contracting} contracting (&lt;100%) · {noData} no baseline
          </div>
        </div>
      </div>

      <div className="card">
        <h2>All companies</h2>
        <table>
          <thead>
            <tr>
              <Th k="name" label="Company" />
              <Th k="billingSource" label="Billing" />
              <Th k="band" label="Status" />
              <Th k="nrr" label="NRR" />
              <th>Invoice</th>
              <Th k="outstanding" label="Outstanding" />
              <Th k="openDealValue" label="Open deals" />
              <Th k="paymentsDue" label="Payments due" />
              <Th k="aligned" label="Alignment" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="row-link" onClick={() => onOpen(r.id)}>
                <td>{r.name}</td>
                <td>
                  <span className={`badge ${srcClass(r.billingSource)}`}>{srcLabel(r.billingSource)}</span>
                </td>
                <td>
                  <span className={`badge ${bandClass(r.band)}`}>{r.band}</span>
                </td>
                <td>{r.nrr != null ? `${r.nrr}%` : "—"}</td>
                <td>
                  {r.invoiceNumbers.length > 0 && (
                    <span>
                      {r.invoiceNumbers[0]}
                      {r.invoiceNumbers.length > 1 ? <span className="muted"> +{r.invoiceNumbers.length - 1}</span> : null}
                    </span>
                  )}{" "}
                  {r.missingInvoice && (
                    <span className="badge risk" title="A won deal of this type has no matching invoice">
                      ⚠ missing
                    </span>
                  )}
                  {!r.invoiceNumbers.length && !r.missingInvoice && <span className="muted">—</span>}
                </td>
                <td>{usd(r.outstanding)}</td>
                <td>
                  {r.openDealCount > 0 ? (
                    <>
                      {usd(r.openDealValue)} <span className="muted">· {r.openDealCount}</span>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {r.paymentsDue > 0 ? <span className="badge warn">{r.paymentsDue} due</span> : <span className="muted">—</span>}
                </td>
                <td>
                  {r.aligned ? (
                    <span className="badge good">Aligned</span>
                  ) : (
                    <span className="badge risk">⚠ {r.conflicts} conflict{r.conflicts > 1 ? "s" : ""}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
