import { cn } from "@/lib/utils";

/*
 * HeroBackground (docs/css.txt) — the hero section's entire backdrop,
 * isolated from content and reusable. Painted at z-index −10 behind the
 * hero copy/phone, layered bottom-to-top:
 *
 *   1. Base          pure near-black canvas (dark expression; light mode
 *                    keeps its own page canvas per AGENTS.md §18)
 *   2. Spotlight     bright emerald glow + concentric elliptical orbital
 *                    rings anchored to the EXACT centre of the phone mockup
 *   3. Film grain    SVG feTurbulence noise, ~5%, mix-blend-overlay
 *   4. Star marks    tiny "+" glyphs scattered top-left / mid-left /
 *                    bottom-right near the glow
 *   5. Particles     soft glowing dots for atmospheric depth
 *   6. Vignette      edges darken so the centre glow stands out
 *
 * Every layer is decorative: aria-hidden, pointer-events-none, zero layout
 * impact, no images (CSS gradients + inline data-URI only). Animations are
 * plain CSS and are neutralised globally under prefers-reduced-motion.
 */

/** Sparse "+" star marks: position, size (px), twinkle phase. */
const STARS = [
  { top: "14%", left: "8%", size: 13, delay: "-1.5s", duration: "10s" },
  { top: "27%", left: "5%", size: 11, delay: "-5s", duration: "12s" },
  { top: "8%", left: "20%", size: 10, delay: "-8s", duration: "11s" },
  { top: "52%", left: "4%", size: 12, delay: "-3s", duration: "13s" },
  { top: "64%", left: "13%", size: 10, delay: "-6.5s", duration: "9.5s" },
  { top: "81%", left: "85%", size: 13, delay: "-2s", duration: "10.5s" },
  { top: "69%", left: "94%", size: 11, delay: "-7.5s", duration: "12.5s" },
  { top: "20%", left: "72%", size: 9, delay: "-4s", duration: "11.5s" },
  { top: "45%", left: "88%", size: 10, delay: "-9s", duration: "10s" },
] as const;

/** Glowing particles: soft atmospheric dots scattered around the hero. */
const PARTICLES = [
  { top: "18%", left: "12%", size: 3, delay: "0s", duration: "7s" },
  { top: "35%", left: "78%", size: 4, delay: "-2s", duration: "9s" },
  { top: "62%", left: "70%", size: 3, delay: "-4.5s", duration: "8s" },
  { top: "75%", left: "18%", size: 2, delay: "-1s", duration: "10s" },
  { top: "48%", left: "92%", size: 3, delay: "-6s", duration: "7.5s" },
  { top: "85%", left: "45%", size: 2, delay: "-3.5s", duration: "9.5s" },
] as const;

/* ---------------------------------------------------------------------------
   Spotlight (glow + orbital rings)

   Colour: the Get Started button's own green — emerald-400 #34d399
   (rgb(52 211 153)) on dark, deepened to emerald-700 #047857
   (rgb(4 120 87)) on light so the wash stays premium, not neon.

   Geometry: the glow and orbital rings are centred on one zero-size anchor
   point. Rings are ELLIPTICAL (wider than tall) to create layered orbital
   lines that visually sit behind the phone and extend into the hero, like
   concentric ellipses in a reference composition. Diameters are clamped per
   breakpoint so the outermost ring never crosses the hero boundary.
--------------------------------------------------------------------------- */

/** Elliptical orbital rings: layered thin curved lines behind the phone. */
function OrbitalRings({ variant }: { variant: "compact" | "wide" }) {
  const rings =
    variant === "compact"
      ? [
          {
            width: "w-[200px]",
            height: "h-[120px]",
            tone: "border-[rgb(4_120_87/0.28)] dark:border-[rgb(52_211_153/0.38)]",
            rotate: "-3deg",
            breathe: false,
          },
          {
            width: "w-[280px]",
            height: "h-[160px]",
            tone: "border-[rgb(4_120_87/0.16)] dark:border-[rgb(52_211_153/0.22)]",
            rotate: "2deg",
            breathe: true,
          },
          {
            width: "w-[360px]",
            height: "h-[200px]",
            tone: "border-[rgb(4_120_87/0.09)] dark:border-[rgb(52_211_153/0.13)]",
            rotate: "-1deg",
            breathe: false,
          },
          {
            width: "w-[440px]",
            height: "h-[240px]",
            tone: "border-[rgb(4_120_87/0.05)] dark:border-[rgb(52_211_153/0.07)]",
            rotate: "4deg",
            breathe: true,
          },
        ]
      : [
          {
            width: "w-[220px] xl:w-[280px] 2xl:w-[330px]",
            height: "h-[130px] xl:h-[170px] 2xl:h-[200px]",
            tone: "border-[rgb(4_120_87/0.28)] dark:border-[rgb(52_211_153/0.38)]",
            rotate: "-4deg",
            breathe: false,
          },
          {
            width: "w-[320px] xl:w-[400px] 2xl:w-[480px]",
            height: "h-[180px] xl:h-[230px] 2xl:h-[270px]",
            tone: "border-[rgb(4_120_87/0.16)] dark:border-[rgb(52_211_153/0.22)]",
            rotate: "3deg",
            breathe: true,
          },
          {
            width: "w-[420px] xl:w-[540px] 2xl:w-[640px]",
            height: "h-[230px] xl:h-[300px] 2xl:h-[360px]",
            tone: "border-[rgb(4_120_87/0.09)] dark:border-[rgb(52_211_153/0.13)]",
            rotate: "-2deg",
            breathe: false,
          },
          {
            width: "w-[520px] xl:w-[680px] 2xl:w-[800px]",
            height: "h-[280px] xl:h-[370px] 2xl:h-[440px]",
            tone: "border-[rgb(4_120_87/0.05)] dark:border-[rgb(52_211_153/0.07)]",
            rotate: "5deg",
            breathe: true,
          },
        ];

  return (
    <>
      {rings.map((ring, index) => (
        <div
          key={index}
          className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border",
            ring.width,
            ring.height,
            ring.tone,
            ring.breathe && "animate-glow-breathe-delayed",
          )}
          style={{ transform: `translate(-50%, -50%) rotate(${ring.rotate})` }}
        />
      ))}
    </>
  );
}

/** Three stacked radial sources: broad bloom → breathing bloom → hot core. */
function SpotlightGlow({ variant }: { variant: "compact" | "wide" }) {
  const compact = variant === "compact";
  return (
    <>
      {/* Broad cinematic bloom — large atmospheric wash */}
      <div
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
          compact
            ? "size-[400px]"
            : "size-[500px] xl:size-[650px] 2xl:size-[800px]",
        )}
      >
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,rgb(4_120_87/0.12),rgb(4_120_87/0.04)_50%,transparent_74%)] dark:bg-[radial-gradient(closest-side,rgb(52_211_153/0.18),rgb(16_185_129/0.06)_48%,transparent_74%)]" />
      </div>

      {/* Breathing bloom — gentle pulse */}
      <div
        className={cn(
          "animate-glow-breathe absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
          compact
            ? "size-[300px]"
            : "size-[380px] xl:size-[480px] 2xl:size-[580px]",
        )}
      >
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,rgb(4_120_87/0.1),transparent_72%)] dark:bg-[radial-gradient(closest-side,rgb(52_211_153/0.22),transparent_72%)]" />
      </div>

      {/* Hot vivid core hugging the device — a spotlight, not a haze */}
      <div
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[40px]",
          compact
            ? "size-[200px]"
            : "size-[260px] xl:size-[320px] 2xl:size-[380px]",
        )}
      >
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,rgb(4_120_87/0.16),transparent_72%)] dark:bg-[radial-gradient(closest-side,rgb(52_211_153/0.40),transparent_72%)]" />
      </div>
    </>
  );
}

function HeroSpotlight({ variant }: { variant: "compact" | "wide" }) {
  return (
    <>
      <SpotlightGlow variant={variant} />
      <OrbitalRings variant={variant} />
    </>
  );
}

export function HeroBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {/* 1 — Base: pure near-black covering the full hero (dark theme).
          Light theme keeps the page's own warm canvas. */}
      <div className="absolute inset-0 hidden bg-[#050806] dark:block" />

      {/* 2 — Spotlight, anchored to the phone mockup's exact centre.

          Compact (<lg): the layout stacks and the phone sits centred below
          the copy, so the anchor is the section's horizontal centre at ~70%
          height — where the mockup lands.

          Wide (lg+): mirror the hero's REAL grid geometry (same max-width,
          padding, column ratio and gap as .container-page + the hero grid),
          then pin the anchor inside the right column at half the device
          width from its right edge (159px @lg for the 318px phone, 174px
          @xl for the 348px one) and vertically centred. The anchor therefore
          tracks the phone's true centre at every desktop width. */}
      <div className="absolute left-1/2 top-[70%] size-0 lg:hidden">
        <HeroSpotlight variant="compact" />
      </div>
      <div className="absolute inset-0 hidden lg:block">
        <div className="mx-auto h-full w-full max-w-[76rem] px-10">
          <div className="grid h-full grid-cols-[1.05fr_0.95fr] gap-6 xl:gap-10">
            <div className="min-w-0" />
            <div className="relative min-w-0">
              <div className="absolute right-[144px] top-1/2 size-0 xl:right-[160px]">
                <HeroSpotlight variant="wide" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3 — Cinematic grain across the whole background (see .hero-noise),
          blended into the lit areas only thanks to overlay blending. */}
      <div className="hero-noise absolute inset-0 opacity-[0.05] mix-blend-overlay" />

      {/* 4 — Tiny "+" star marks, very low opacity, white/light-green. */}
      {STARS.map((star) => (
        <svg
          key={`${star.top}-${star.left}`}
          viewBox="0 0 12 12"
          fill="none"
          className="animate-twinkle absolute text-emerald-800/50 dark:text-emerald-100/45"
          style={{
            top: star.top,
            left: star.left,
            width: star.size,
            height: star.size,
            animationDelay: star.delay,
            animationDuration: star.duration,
          }}
        >
          <path
            d="M6 1v10M1 6h10"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      ))}

      {/* 5 — Subtle glowing particle dots for atmospheric depth. */}
      {PARTICLES.map((particle) => (
        <div
          key={`${particle.top}-${particle.left}`}
          className="hero-particle animate-twinkle"
          style={{
            top: particle.top,
            left: particle.left,
            width: particle.size,
            height: particle.size,
            animationDelay: particle.delay,
            animationDuration: particle.duration,
          }}
        />
      ))}

      {/* 6 — Vignette: corners and edges fall away so the centre glow pops. */}
      <div className="absolute inset-0 bg-[radial-gradient(115%_115%_at_50%_50%,transparent_56%,rgb(24_33_28/0.07)_100%)] dark:bg-[radial-gradient(115%_115%_at_50%_50%,transparent_54%,rgb(1_4_3/0.55)_100%)]" />
    </div>
  );
}
