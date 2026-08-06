import { redirect } from "next/navigation";

// Root app/not-found.tsx catches every unmatched URL app-wide (Next.js
// 13.3+, no extra config needed) — send it straight to "/" instead of
// showing a bare 404 screen, since this is an internal staff tool with no
// content worth landing on a dead-end page for.
export default function NotFound() {
  redirect("/");
}
