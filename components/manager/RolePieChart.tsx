"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { ROLE_LABELS } from "@/lib/roles";
import type { RoleCount } from "@/lib/attendance";

// Staff-by-role donut for TechnicalDashboard. Split into its own file for the
// same reason as HoursAreaChart: it is the only other recharts consumer, and
// keeping both isolated is what lets next/dynamic drop recharts out of the
// initial bundle. Colors arrive as a prop rather than being defined here
// because the legend under the chart uses the same list and must stay in the
// dashboard — importing the array from this file would statically pull
// recharts back in and undo the split.
export default function RolePieChart({
  data,
  colors,
}: {
  data: RoleCount[];
  colors: string[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="role" innerRadius={50} outerRadius={90} paddingAngle={2}>
          {data.map((entry, i) => (
            <Cell key={entry.role} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, _name, item) => [
            `${value} người`,
            ROLE_LABELS[(item?.payload as { role: keyof typeof ROLE_LABELS }).role],
          ]}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
