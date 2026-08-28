import { CheckCircleIcon, SparkleIcon, TrendingUpIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Floating smartphone mockup (AGENTS.md §14).
 * The screen shows OUR OWN Business Manager UI with clearly presentational
 * mock data — it communicates dashboard metrics, inventory and an AI Manager
 * action. It does not pretend to be live backend data.
 *
 * Float/tilt are pure CSS so the component stays server-rendered and the
 * global prefers-reduced-motion rule neutralises every effect.
 */
export function PhonePreview() {
  return (
    <div className="relative mx-auto w-fit [perspective:1800px]">
      {/* Small double halo (docs/css.txt): exactly TWO thin, closed
          elliptical rings centred directly behind the device, compact enough
          to stay INSIDE the backlight's light zone — never taller than the
          device itself, only slightly wider. A tight premium halo, NOT a
          large background graphic. Painted first so the backlight blooms
          over them and the rings melt into the light. */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -z-10 h-[98%] w-[112%] -translate-x-1/2 -translate-y-1/2"
      >
        <div className="phone-halo-ring animate-glow-breathe-delayed absolute inset-0 opacity-70 [transform:rotate(-6deg)]" />
      </div>
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -z-10 h-[88%] w-[103%] -translate-x-1/2 -translate-y-1/2"
      >
        <div className="phone-halo-ring animate-glow-breathe absolute inset-0 [transform:rotate(4deg)]" />
      </div>

      {/* Emerald backlight rising FROM BEHIND the device (docs/css.txt).
          Three stacked sources centred on the middle/right of the phone:
          broad cinematic falloff → breathing bloom → hot core hugging the
          glass. Colour is the same soft/light emerald (emerald-400, as on
          the Get Started button) in BOTH themes — a premium soft light
          source, never dark or neon green. Position/intensity unchanged. */}
      <div
        aria-hidden
        className="absolute left-[54%] top-[46%] -z-10 h-[520px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(52_211_153/0.16),rgb(52_211_153/0.05)_48%,transparent_74%)] sm:h-[660px] sm:w-[760px] lg:h-[560px] lg:w-[620px]"
      />
      <div
        aria-hidden
        className="ambient-glow animate-glow-breathe-delayed left-[54%] top-[46%] -z-10 h-[500px] w-[540px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,rgb(52_211_153/0.16),transparent_74%)] sm:h-[620px] sm:w-[660px] lg:h-[520px] lg:w-[540px]"
      />
      <div
        aria-hidden
        className="absolute left-[53%] top-[47%] -z-10 h-[340px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(52_211_153/0.3),transparent_74%)] blur-[40px] sm:h-[400px] sm:w-[370px] lg:h-[280px] lg:w-[250px]"
      />

      <div className="[transform:rotateY(-16deg)_rotateX(5deg)] [transform-style:preserve-3d]">
        <div className="animate-float">
          {/* Device frame */}
          <div className="relative w-[272px] rounded-[2.9rem] border border-white/15 bg-gradient-to-b from-charcoal-500 to-obsidian-950 p-[10px] shadow-phone sm:w-[318px] lg:w-[252px] xl:w-[272px]">
            {/* Side buttons */}
            <div
              aria-hidden
              className="absolute -left-[2px] top-28 h-14 w-[3px] rounded-full bg-white/15"
            />
            <div
              aria-hidden
              className="absolute -right-[2px] top-36 h-20 w-[3px] rounded-full bg-white/15"
            />

            {/* Backlit rim — the light source behind the device kissing its
                edge; painted only on the outer 1px, brightest top-right */}
            <div aria-hidden className="phone-rim" />

            {/* Screen */}
            <div className="relative aspect-[9/19] overflow-hidden rounded-[2.35rem] bg-obsidian-950 ring-1 ring-black/70">
              {/* Dynamic island */}
              <div
                aria-hidden
                className="absolute left-1/2 top-2.5 z-20 h-[22px] w-24 -translate-x-1/2 rounded-full bg-black"
              />

              {/* Screen glow wash */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-emerald-500/12 via-emerald-500/[0.04] to-transparent"
              />

              {/* Glass reflection across the corner — subtle, premium */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-10 rounded-[2.35rem] bg-gradient-to-br from-white/[0.08] via-white/[0.02] to-transparent opacity-70"
              />

              <div className="flex h-full flex-col gap-3 px-4 pb-5 pt-11 text-white">
                {/* Status bar */}
                <div className="flex items-center justify-between text-[10px] font-medium text-white/50">
                  <span>9:41</span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
                    <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
                    <span className="h-2 w-5 rounded-[3px] border border-white/40" />
                  </span>
                </div>

                {/* App bar */}
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 text-[11px] font-semibold text-emerald-950">
                    KC
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-[13px] font-medium">Kurta Corner</p>
                    <p className="text-[10px] text-white/45">Aaj · Live</p>
                  </div>
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                  </span>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.06] p-2.5">
                    <p className="text-[9.5px] uppercase tracking-wide text-white/45">
                      Aaj ki Sales
                    </p>
                    <p className="mt-1 text-[15px] font-semibold tracking-tight text-emerald-300">
                      Rs 25,000
                    </p>
                    <p className="mt-0.5 text-[9.5px] font-medium text-emerald-400">
                      ↑ 12% kal se
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.06] p-2.5">
                    <p className="text-[9.5px] uppercase tracking-wide text-white/45">
                      Orders
                    </p>
                    <p className="mt-1 text-[15px] font-semibold tracking-tight">
                      12
                    </p>
                    <p className="mt-0.5 text-[9.5px] font-medium text-white/50">
                      3 naye aaye
                    </p>
                  </div>
                </div>

                {/* Low stock notice */}
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5">
                  <span className="size-1.5 shrink-0 rounded-full bg-white/50" />
                  <p className="truncate text-[10px] text-white/60">
                    Low stock: White Kurti — sirf 8 bache
                  </p>
                </div>

                {/* Inventory rows */}
                <div className="space-y-1.5">
                  {[
                    { name: "Black Kurta L", stock: "50 pcs", ok: true },
                    { name: "White Kurti M", stock: "8 pcs", ok: false },
                  ].map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5"
                    >
                      <span className="text-[11px] text-white/80">{item.name}</span>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                          item.ok
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-white/10 text-white/70",
                        )}
                      >
                        {item.stock}
                      </span>
                    </div>
                  ))}
                </div>

                {/* AI Manager exchange */}
                <div className="mt-auto space-y-1.5 rounded-xl border border-emerald-400/20 bg-gradient-to-b from-emerald-500/[0.09] to-transparent p-2.5">
                  <p className="flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-wide text-emerald-300">
                    <SparkleIcon className="size-3" />
                    AI Manager
                  </p>
                  <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-white/[0.08] px-2.5 py-1.5 text-[10.5px] text-white/85">
                    Black Kurta ka stock 50 kar do
                  </p>
                  <p className="w-fit max-w-[92%] rounded-2xl rounded-bl-sm bg-emerald-500/20 px-2.5 py-1.5 text-[10.5px] text-emerald-100">
                    Ho gaya — Black Kurta ka stock ab 50 pcs hai.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Grounding light pool beneath the floating device (docs/css.txt
              §5): wide diffuse pool + tighter core, both fading into black */}
          <div
            aria-hidden
            className="absolute -bottom-14 left-1/2 -z-10 h-24 w-[110%] -translate-x-1/2 rounded-[100%] bg-emerald-500/20 blur-[36px] dark:bg-emerald-400/[0.13] lg:-bottom-12 lg:h-20"
          />
          <div
            aria-hidden
            className="absolute -bottom-8 left-1/2 -z-10 h-10 w-[58%] -translate-x-1/2 rounded-[100%] bg-emerald-400/25 blur-[20px] dark:bg-emerald-300/20 lg:-bottom-6 lg:h-9"
          />
        </div>

        {/* Floating confirmation chips */}
        <div className="animate-float-delayed absolute -left-16 top-24 hidden items-center gap-1.5 rounded-full border border-line bg-background/90 py-2 pl-2.5 pr-3.5 shadow-card backdrop-blur md:flex">
          <CheckCircleIcon className="size-4 text-accent" />
          <span className="text-xs font-medium">Stock updated</span>
        </div>
        <div className="animate-float absolute -right-14 bottom-28 hidden items-center gap-1.5 rounded-full border border-line bg-background/90 py-2 pl-2.5 pr-3.5 shadow-card backdrop-blur md:flex">
          <TrendingUpIcon className="size-4 text-accent" />
          <span className="text-xs font-medium">Rs 25,000 aaj</span>
        </div>
      </div>
    </div>
  );
}
