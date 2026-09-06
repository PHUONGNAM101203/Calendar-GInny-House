import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // react-big-calendar: browser-only, its CJS entry breaks under server-side
  // React evaluation — see components/calendar/ShiftCalendarLoader.tsx.
  //
  // web-push: keeps the DEP0169 `url.parse()` deprecation warning out of the
  // production logs. web-push@3.6.7 (the latest release) calls url.parse twice
  // per push, at web-push-lib.js:274 and :348. Node suppresses deprecation
  // warnings raised from inside node_modules — verified both ways on Node
  // 26.7.0: the identical call warns from a project file and stays silent from
  // a node_modules file. Bundling web-push moved those call sites into
  // .next/server/chunks, i.e. out of node_modules, which is why the warning
  // only ever showed up in the deployed runtime and never in a local build.
  //
  // Leaving it external means a require() from node_modules at runtime, which
  // is how it behaved before it was ever bundled. Nothing about push delivery
  // changes, and one fewer library gets inlined into the server bundle.
  serverExternalPackages: ["react-big-calendar", "web-push"],
};

export default nextConfig;
