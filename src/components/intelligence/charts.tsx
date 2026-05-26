"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};

export function IntentBarChart({ data }: { data: { label: string; count: number }[] }) {
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" tick={AXIS} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={AXIS} width={120} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
        <Bar dataKey="count" fill="var(--primary)" radius={[0, 4, 4, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const SENTIMENT_COLORS = [
  "#16a34a",
  "#6366f1",
  "#d97706",
  "#dc2626",
  "#0ea5e9",
  "#a855f7",
  "#64748b",
  "#f43f5e",
];

export function SentimentDonut({ data }: { data: { label: string; count: number }[] }) {
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="label" innerRadius={55} outerRadius={85} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={SENTIMENT_COLORS[i % SENTIMENT_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function VolumeTrendChart({
  data,
}: {
  data: { date: string; inbound: number; outbound: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ left: -10, right: 8 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={AXIS} />
        <YAxis tick={AXIS} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="inbound" stroke="var(--primary)" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="outbound" stroke="#16a34a" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function Empty() {
  return (
    <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
      Not enough data yet.
    </div>
  );
}
