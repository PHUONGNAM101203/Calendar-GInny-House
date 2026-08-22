"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
  Label,
} from "recharts";
import type { DayHours } from "@/lib/attendance";

// The hours-worked area chart shared by ManagerDashboard and
// TechnicalDashboard. It lives in its own file purely so the ~300KB recharts
// bundle can be split out behind next/dynamic — both dashboards render this
// chart below the fold, so paying for recharts before first paint bought
// nothing. Keep it free of anything but the chart: the moment something else
// in a dashboard imports from here, recharts comes back into the main bundle.
//
// gradientId must be unique per chart instance on the page — SVG <defs> ids
// are document-global, so two charts sharing one id silently make the second
// one paint with the first one's fill.
export default function HoursAreaChart({
  data,
  gradientId,
  peakDay,
  showAxisLines = true,
  yAxisWidth = 32,
}: {
  data: DayHours[];
  gradientId: string;
  peakDay: DayHours;
  showAxisLines?: boolean;
  yAxisWidth?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 28, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--calendar-grid)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={showAxisLines}
          tickLine={showAxisLines}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          width={yAxisWidth}
          axisLine={showAxisLines}
          tickLine={showAxisLines}
        />
        <Tooltip
          formatter={(value) => [`${value} giờ`, "Tổng giờ làm"]}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="hours"
          stroke="var(--primary)"
          strokeWidth={2.5}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4 }}
        />
        {peakDay.hours > 0 && (
          <ReferenceDot
            x={peakDay.label}
            y={peakDay.hours}
            r={4}
            fill="var(--primary)"
            stroke="var(--card)"
            strokeWidth={2}
          >
            <Label
              value={`${peakDay.hours} giờ`}
              position="top"
              offset={10}
              style={{ fill: "var(--foreground)", fontSize: 12, fontWeight: 600 }}
            />
          </ReferenceDot>
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
