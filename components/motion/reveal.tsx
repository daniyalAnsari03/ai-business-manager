"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EASE_PREMIUM } from "@/components/motion/presets";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Seconds of delay before the reveal starts. */
  delay?: number;
  /** Vertical travel distance in px. */
  y?: number;
};

/* ---------------------------------------------------------------------------
   Shared IntersectionObserver (singleton)

   Every Reveal instance registers its element and a per-instance callback.
   When the element enters the viewport the callback fires once, then the
   element is unobserved.  This replaces the previous approach where each
   Reveal created its own observer (26 on the homepage), which caused a
   variable-length hydration bottleneck: clicking a navigation button while
   the 26 observers were still being set up / torn down hit a busy main
   thread and intermittently delayed navigation.

   One observer + one matchMedia listener = zero per-instance overhead.
--------------------------------------------------------------------------- */

type RevealEntry = {
  el: Element;
  cb: () => void;
};

const entries = new Map<HTMLElement, RevealEntry>();
let observer: IntersectionObserver | null = null;
let reducedMotion = false;

function ensureObserver() {
  if (observer) return;
  observer = new IntersectionObserver(
    (ios) => {
      for (const io of ios) {
        if (!io.isIntersecting) continue;
        const entry = entries.get(io.target as HTMLElement);
        if (entry) {
          entry.cb();
          observer!.unobserve(io.target);
          entries.delete(io.target as HTMLElement);
        }
      }
    },
    { rootMargin: "-80px" },
  );
}

function cleanupObserver() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
  entries.clear();
}

/* ---------------------------------------------------------------------- */

/**
 * Scroll-triggered entrance used across sections.
 *
 * Hydration-safe by design: the server and the first client render output
 * the same visible markup, and only after mount do we decide whether to
 * run the entrance (never when the visitor prefers reduced motion).
 */
export function Reveal({ children, className, delay = 0, y = 26 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [allowMotion, setAllowMotion] = useState(false);
  const [inView, setInView] = useState(false);
  const hasRevealed = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotion = mq.matches;
      setAllowMotion(!mq.matches);
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (hasRevealed.current) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const cb = () => {
      if (hasRevealed.current) return;
      hasRevealed.current = true;
      if (!reducedMotion) setInView(true);
    };

    ensureObserver();
    entries.set(el, { el, cb });
    observer!.observe(el);

    return () => {
      entries.delete(el);
      if (observer) observer.unobserve(el);
      if (entries.size === 0) cleanupObserver();
    };
  }, [allowMotion]);

  const hidden = allowMotion && !inView;

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={false}
      animate={hidden ? { opacity: 0, y } : { opacity: 1, y: 0 }}
      transition={
        hidden
          ? { duration: 0 }
          : { duration: 0.7, delay, ease: EASE_PREMIUM }
      }
    >
      {children}
    </motion.div>
  );
}
