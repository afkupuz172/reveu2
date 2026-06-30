import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ArAging, ClientSummary, HealthFactor, MonthPoint, Overview, Overview2 } from "../../shared/types";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

const axis = { stroke: "#8a97b1", fontSize: 12 };
const grid = "#25324f";
const usd = (v: number) => `$${v.toLocaleString()}`;

export function RevenueChart({ data }: { data: MonthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis {...axis} tickFormatter={usd} width={56} />
        <Tooltip
          contentStyle={{ background: "#131c31", border: "1px solid #25324f", borderRadius: 8, color: "#e6ecf7" }}
          formatter={(v: number) => usd(v)}
        />
        <Line type="monotone" dataKey="revenue" stroke="#5b8cff" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function InvoiceChart({ data }: { data: MonthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis {...axis} tickFormatter={usd} width={56} />
        <Tooltip
          contentStyle={{ background: "#131c31", border: "1px solid #25324f", borderRadius: 8, color: "#e6ecf7" }}
          formatter={(v: number) => usd(v)}
        />
        <Bar dataKey="paid" stackId="a" fill="#2fb774" radius={[0, 0, 0, 0]} />
        <Bar dataKey="outstanding" stackId="a" fill="#e2543f" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Portfolio revenue: this year overlaid on last year, by calendar month.
export function RevenueOverlayChart({ revenue }: { revenue: Overview["revenue"] }) {
  const data = revenue.months.map((month, i) => ({
    month,
    "This year": revenue.currentYear[i],
    "Last year": revenue.lastYear[i],
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis {...axis} tickFormatter={usd} width={56} />
        <Tooltip
          contentStyle={{ background: "#131c31", border: "1px solid #25324f", borderRadius: 8, color: "#e6ecf7" }}
          formatter={(v: number) => usd(v)}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="Last year" stroke="#8a97b1" strokeWidth={2} strokeDasharray="5 4" dot={false} />
        <Line type="monotone" dataKey="This year" stroke="#5b8cff" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

const GREENS = ["#2fb774", "#1b8f57", "#0f6e41", "#6fd39a"];
const ORANGES = ["#e0a13a", "#c47f1f", "#a36314", "#efc173"];

// Custom tooltip: each series' cumulative value + the deals that closed this month.
function TrendTooltip({ active, payload, label }: { active?: boolean; label?: string; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const deals = (payload[0].payload.deals ?? []) as Overview2["months"][number]["deals"];
  return (
    <div style={{ background: "#131c31", border: "1px solid #25324f", borderRadius: 8, color: "#e6ecf7", padding: 10, fontSize: 12, maxWidth: 320 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.stroke }}>
          {p.dataKey}: {usd(p.value)}
        </div>
      ))}
      {deals.length > 0 && (
        <div style={{ marginTop: 6, borderTop: "1px solid #25324f", paddingTop: 6 }}>
          <div style={{ color: "#8a97b1", marginBottom: 2 }}>Closed this month:</div>
          {deals.map((d, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              <span style={{ color: d.kind === "realized" ? "#2fb774" : "#e0a13a" }}>●</span> {d.company} — {d.name} · {usd(d.amount)}{" "}
              <span style={{ color: "#8a97b1" }}>({d.year})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Overview2: one cumulative line per year — realized (closed-won, green) and expected
// (open, orange) — over a Jan–Dec axis. Hovering a month lists that month's deals.
export function RealizedExpectedChart({ series, months }: { series: Overview2["series"]; months: Overview2["months"] }) {
  const data = months.map((m) => ({ month: m.month, deals: m.deals, ...m.values }));
  const colorOf = new Map<string, string>();
  let g = 0;
  let o = 0;
  for (const s of series) colorOf.set(s.label, s.kind === "realized" ? GREENS[g++ % GREENS.length] : ORANGES[o++ % ORANGES.length]);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="month" {...axis} />
        <YAxis {...axis} tickFormatter={usd} width={56} />
        <Tooltip content={<TrendTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Line
            key={s.label}
            type="monotone"
            dataKey={s.label}
            name={s.label}
            stroke={colorOf.get(s.label)}
            strokeWidth={2}
            strokeDasharray={s.kind === "expected" ? "5 4" : undefined}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Distribution of NRR across the portfolio.
export function NrrHealthChart({ nrrHealth }: { nrrHealth: Overview["nrrHealth"] }) {
  const data = [
    { name: "Expanding", count: nrrHealth.expanding, fill: "#2fb774" },
    { name: "Flat", count: nrrHealth.flat, fill: "#5b8cff" },
    { name: "Contracting", count: nrrHealth.contracting, fill: "#e2543f" },
    { name: "No data", count: nrrHealth.noData, fill: "#8a97b1" },
  ];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="name" {...axis} />
        <YAxis {...axis} allowDecimals={false} width={32} />
        <Tooltip
          contentStyle={{ background: "#131c31", border: "1px solid #25324f", borderRadius: 8, color: "#e6ecf7" }}
          formatter={(v: number) => [`${v} companies`, ""]}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HealthFactors({ health }: { health: ClientSummary["health"] }) {
  const color = (f: HealthFactor) =>
    f.score / f.max >= 0.75 ? "#2fb774" : f.score / f.max >= 0.4 ? "#e0a13a" : "#e2543f";
  return (
    <div>
      {health.factors.map((f) => (
        <div className="factor" key={f.key}>
          <div className="row">
            <span>{f.label}</span>
            <span>
              {f.score}/{f.max}
            </span>
          </div>
          <div className="bar">
            <div style={{ width: `${(f.score / f.max) * 100}%`, background: color(f) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// A/R aging buckets (QuickBooks enrichment) as labeled bars.
export function ArAgingBars({ aging }: { aging: ArAging }) {
  const buckets = [
    { label: "Current", v: aging.current, c: "#2fb774" },
    { label: "1–30", v: aging.d1_30, c: "#e0a13a" },
    { label: "31–60", v: aging.d31_60, c: "#e0863a" },
    { label: "61–90", v: aging.d61_90, c: "#e2543f" },
    { label: "90+", v: aging.d90plus, c: "#c0392b" },
  ];
  const max = Math.max(1, ...buckets.map((b) => b.v));
  return (
    <div>
      {buckets.map((b) => (
        <div className="factor" key={b.label}>
          <div className="row">
            <span>{b.label}</span>
            <span>{money(b.v)}</span>
          </div>
          <div className="bar">
            <div style={{ width: `${(b.v / max) * 100}%`, background: b.c }} />
          </div>
        </div>
      ))}
    </div>
  );
}
