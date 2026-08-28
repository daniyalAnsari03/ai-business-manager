import type { Variants } from "framer-motion";

/** Signature easing used for premium, soft landings. */
export const EASE_PREMIUM: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const VIEWPORT_ONCE = { once: true, margin: "-80px" } as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE_PREMIUM },
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};
