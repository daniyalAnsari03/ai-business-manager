"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  MotionConfig,
  type Variants,
} from "framer-motion";
import { EASE_PREMIUM } from "@/components/motion/presets";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { BrandMark, BrandWordmark } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const MotionLink = motion.create(Link);

const NAV_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "AI capabilities", href: "#capabilities" },
  { label: "Manage everything", href: "#modules" },
  { label: "Safe actions", href: "#actions" },
  { label: "Security", href: "#security" },
] as const;

const menuVariants = {
  closed: {
    height: 0,
    opacity: 0,
    transition: {
      height: { duration: 0.28, ease: EASE_PREMIUM },
      opacity: { duration: 0.18, ease: "easeIn" as const },
      when: "afterChildren" as const,
    },
  },
  open: {
    height: "auto",
    opacity: 1,
    transition: {
      height: { duration: 0.32, ease: EASE_PREMIUM },
      opacity: { duration: 0.22, ease: "easeOut" as const },
      staggerChildren: 0.045,
      delayChildren: 0.08,
    },
  },
} satisfies Variants;

const menuItemVariants = {
  closed: { opacity: 0, y: -8 },
  open: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: EASE_PREMIUM },
  },
} satisfies Variants;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        headerRef.current &&
        event.target instanceof Node &&
        !headerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <MotionConfig reducedMotion="user">
      <header
        ref={headerRef}
        className={cn(
          "sticky top-0 z-50 w-full border-b transition-[background-color,border-color,box-shadow] duration-300",
          scrolled
            ? "border-line bg-background/85 shadow-card backdrop-blur-xl"
            : "border-transparent bg-background/60 backdrop-blur-md",
        )}
      >
        <div className="container-page flex h-16 items-center justify-between gap-4 sm:h-[4.5rem]">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-2.5"
            aria-label="AI Business Manager — home"
          >
            <BrandMark className="size-9 rounded-xl shadow-glow-btn" />
            <BrandWordmark className="text-base" />
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group relative rounded-full px-3.5 py-2 text-sm text-muted transition-colors duration-200 hover:text-foreground focus-visible:text-foreground"
              >
                {link.label}
                <span
                  aria-hidden
                  className="absolute inset-x-3.5 bottom-[3px] h-px origin-left scale-x-0 bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600 transition-transform duration-300 ease-out group-hover:scale-x-100 group-focus-visible:scale-x-100 motion-reduce:transition-none"
                />
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <Button href="/login" size="md" className="max-lg:hidden">
              Get started
            </Button>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition-colors min-touch-target hover:border-emerald-500/40 hover:text-accent lg:hidden"
            >
              <HamburgerIcon open={open} />
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              id="mobile-nav"
              key="mobile-nav"
              variants={menuVariants}
              initial="closed"
              animate="open"
              exit="closed"
              className="overflow-hidden border-t border-line bg-background/95 backdrop-blur-xl lg:hidden"
            >
              <nav
                aria-label="Mobile"
                className="container-page flex flex-col gap-1 py-4"
              >
                {NAV_LINKS.map((link) => (
                  <MotionLink
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    variants={menuItemVariants}
                    className={cn(
                      "rounded-xl px-3 py-3 text-[15px] text-muted transition-[color,background-color] duration-200",
                      "hover:bg-surface hover:text-foreground",
                      "active:bg-emerald-500/10 active:text-accent",
                    )}
                  >
                    {link.label}
                  </MotionLink>
                ))}
                <motion.div variants={menuItemVariants} className="pt-2">
                  <Button href="/login" size="lg" onClick={() => setOpen(false)} className="w-full">
                    Get started
                  </Button>
                </motion.div>
              </nav>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </header>
    </MotionConfig>
  );
}

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <span aria-hidden className="relative block size-5">
      <span
        aria-hidden
        className={cn(
          "absolute left-1/2 top-1/2 block h-[1.5px] w-[18px] rounded-full bg-current",
          "transition-all duration-300 ease-out",
          open
            ? "-translate-x-1/2 -translate-y-1/2 rotate-45"
            : "-translate-x-1/2 -translate-y-[6.5px]",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute left-1/2 top-1/2 block h-[1.5px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-current",
          "transition-all duration-200 ease-out",
          open ? "scale-x-0 opacity-0" : "scale-x-100 opacity-100",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute left-1/2 top-1/2 block h-[1.5px] w-[18px] rounded-full bg-current",
          "transition-all duration-300 ease-out",
          open
            ? "-translate-x-1/2 -translate-y-1/2 -rotate-45"
            : "-translate-x-1/2 translate-y-[4.5px]",
        )}
      />
    </span>
  );
}
