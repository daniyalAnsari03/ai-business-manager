/**
 * Route-level loading UI for the whole dashboard area. Shown instantly
 * while the server renders any module page, so navigation feels immediate.
 * Deliberately lightweight (pure CSS pulse, no JS) and mirrors the shared
 * PageHeader + stat-grid structure of every module page — rendered inside
 * the app shell's <main>, which already owns the page container.
 */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-5" aria-hidden>
      <div className="h-[176px] rounded-[1.75rem] border border-line bg-surface px-6 py-8 shadow-card sm:h-[190px] sm:px-9 sm:py-10">
        <div className="h-3 w-28 rounded-full bg-surface-raised" />
        <div className="mt-4 h-8 w-64 max-w-full rounded-lg bg-surface-raised" />
        <div className="mt-3 h-4 w-80 max-w-full rounded bg-surface-raised" />
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-28 rounded-2xl border border-line bg-surface"
          />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-16 rounded-xl border border-line bg-surface"
          />
        ))}
      </div>
    </div>
  );
}
