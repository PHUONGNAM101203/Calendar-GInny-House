const BACK_CELLS = [
  "bg-white/25",
  "bg-white/10",
  "bg-white/10",
  "bg-white/15",
  "bg-white/10",
  "bg-white/25",
  "bg-white/10",
  "bg-white/15",
];

const FRONT_CELLS = ["--chart-3", "--gold", "--chart-4", "--success", "--chart-6", "--chart-5"];

// A stand-in for the reference's photographic illustration — built from the
// app's own visual language (calendar-grid cards + shift chips + person
// colors) instead of stock clip-art, so it reads as *this* product's screen,
// not a generic dashboard-template person. Pure CSS/divs, no image asset.
export default function AuthIllustration() {
  return (
    <div className="relative h-56 w-72 shrink-0">
      {/* Back card — a quiet month-grid, mostly empty cells */}
      <div className="absolute top-2 left-0 w-56 -rotate-6 rounded-2xl border border-white/15 bg-white/10 p-3 shadow-2xl shadow-black/30 backdrop-blur-sm">
        <div className="mb-2 h-2 w-14 rounded-full bg-white/30" />
        <div className="grid grid-cols-4 gap-1.5">
          {BACK_CELLS.map((cls, i) => (
            <span key={i} className={`h-4 rounded-[4px] ${cls}`} />
          ))}
        </div>
      </div>

      {/* Front card — colored shift chips, like the real calendar grid */}
      <div className="absolute right-0 bottom-0 w-56 rotate-4 rounded-2xl border border-white/15 bg-white/95 p-3 shadow-2xl shadow-black/30">
        <div className="mb-2 flex items-center justify-between">
          <span className="h-2 w-16 rounded-full bg-primary/20" />
          <span className="size-2 rounded-full bg-destructive" />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {FRONT_CELLS.map((token, i) => (
            <span
              key={token}
              className="h-6 rounded-[4px]"
              style={{ backgroundColor: `color-mix(in oklch, var(${token}) ${i === 0 ? 90 : 22}%, white)` }}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1">
          <span className="size-1.5 rounded-full bg-primary" />
          <span className="text-[10px] font-medium text-primary">8:00 AM – 6:00 PM</span>
        </div>
      </div>
    </div>
  );
}
