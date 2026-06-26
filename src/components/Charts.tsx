import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ArAging, ClientSummary, HealthFactor, MonthPoint } from "../../shared/types";

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
