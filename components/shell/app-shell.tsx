"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useI18n } from "@/components/i18n/language-provider";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import {
  ArchiveIcon,
  BrandMark,
  BrandWordmark,
  CartIcon,
  ChartIcon,
  GaugeIcon,
  MenuIcon,
  MessageCircleIcon,
  PackageIcon,
  SettingsIcon,
  UsersIcon,
  WalletIcon,
  XIcon,
} from "@/components/ui/icons";
import type { BusinessType } from "@/lib/business/constants";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { cn } from "@/lib/utils";

type NavItem = {
  labelKey: keyof Dictionary["nav"];
  icon: typeof GaugeIcon;
  href?: string;
};

const MAIN_ITEMS: NavItem[] = [
  { labelKey: "dashboard", icon: GaugeIcon, href: "/dashboard" },
  { labelKey: "aiManager", icon: MessageCircleIcon, href: "/dashboard/assistant" },
  { labelKey: "products", icon: PackageIcon, href: "/dashboard/products" },
];

const MANAGE_ITEMS: NavItem[] = [
  { labelKey: "customers", icon: UsersIcon, href: "/dashboard/customers" },
  { labelKey: "orders", icon: CartIcon, href: "/dashboard/orders" },
  { labelKey: "inventory", icon: ArchiveIcon, href: "/dashboard/inventory" },
  { labelKey: "sales", icon: ChartIcon, href: "/dashboard/sales" },
  { labelKey: "expenses", icon: WalletIcon, href: "/dashboard/expenses" },
  { labelKey: "settings", icon: SettingsIcon, href: "/dashboard/settings" },
];

/**
 * Authenticated application shell: responsive sidebar, mobile drawer,
 * theme toggle, business identity and logout. Future modules appear as
 * clearly marked "Soon" entries — no fake functionality behind them.
 */
export function AppShell({
  businessName,
  businessType,
  displayName,
  avatarUrl,
  userEmail,
  children,
}: {
  businessName: string;
  businessType: BusinessType;
  displayName: string | null;
  avatarUrl: string | null;
  userEmail: string | null;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  // Close the drawer whenever navigation happens.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const sidebar = (
    <NavContent
      t={t}
      pathname={pathname}
      businessName={businessName}
      businessType={businessType}
      displayName={displayName}
      avatarUrl={avatarUrl}
      userEmail={userEmail}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-dvh flex-col overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-surface/80 backdrop-blur-xl lg:flex">
        {sidebar}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur-xl lg:hidden">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href="/dashboard"
            className="flex min-h-11 items-center gap-2.5"
            aria-label="AI Business Manager"
          >
            <BrandMark className="size-9 rounded-xl shadow-glow-btn" />
            <BrandWordmark className="text-base" />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              aria-controls="mobile-nav-drawer"
              aria-label={t.nav.openMenu}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition-colors min-touch-target hover:border-emerald-500/40 hover:text-accent"
            >
              <MenuIcon className="size-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      <AnimatePresence initial={false}>
        {drawerOpen ? (
          <motion.div
            key="mobile-nav-drawer"
            id="mobile-nav-drawer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="fixed inset-0 z-50 lg:hidden"
          >
            <div
              aria-hidden
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col border-r border-line bg-surface shadow-phone will-change-transform"
            >
              {sidebar}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Application content */}
      <div className="h-full min-h-0 flex-1 lg:pl-64">
        <main
          id="main"
          className={cn(
            "mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10",
            pathname.startsWith("/dashboard/assistant")
              ? "h-full flex-1 min-h-0 py-0 overflow-hidden"
              : "h-full py-6 sm:py-8 overflow-y-auto",
          )}
        >
          {children}
        </main>
      </div>
      </div>
    </MotionConfig>
  );
}

function NavContent({
  t,
  pathname,
  businessName,
  businessType,
  displayName,
  avatarUrl,
  userEmail,
  onNavigate,
}: {
  t: Dictionary;
  pathname: string;
  businessName: string;
  businessType: BusinessType;
  displayName: string | null;
  avatarUrl: string | null;
  userEmail: string | null;
  onNavigate: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex min-h-11 items-center gap-2.5"
          aria-label="AI Business Manager"
        >
          <BrandMark className="size-9 shrink-0 rounded-xl shadow-glow-btn" />
          <BrandWordmark className="text-[15px] leading-tight" />
        </Link>
        <button
          type="button"
          onClick={() => onNavigate()}
          aria-label={t.nav.closeMenu}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground lg:hidden min-touch-target"
        >
          <XIcon className="size-5" />
        </button>
      </div>

      <nav aria-label={t.nav.mainSection} className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <div>
          <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-widest text-faint">
            {t.nav.mainSection}
          </p>
          <ul className="space-y-1">
            {MAIN_ITEMS.map((item) => (
              <li key={item.labelKey}>
                <NavLink
                  {...item}
                  label={t.nav[item.labelKey]}
                  active={
                    item.href === "/dashboard"
                      ? pathname === item.href
                      : Boolean(item.href && pathname.startsWith(item.href))
                  }
                  soon={false}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-widest text-faint">
            {t.nav.manageSection}
          </p>
          <ul className="space-y-1">
            {MANAGE_ITEMS.map((item) => (
              <li key={item.labelKey}>
                <NavLink
                  {...item}
                  label={t.nav[item.labelKey]}
                  active={Boolean(item.href && pathname.startsWith(item.href))}
                  soon={false}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="border-t border-line p-4">
        <UserMenu
          businessName={businessName}
          businessType={businessType}
          displayName={displayName}
          avatarUrl={avatarUrl}
          email={userEmail}
        />
        <div className="mt-3 flex items-center justify-end">
          <ThemeToggle />
        </div>
      </div>
    </>
  );
}

function NavLink({
  label,
  icon: Icon,
  href,
  active,
  soon,
  soonLabel,
  onNavigate,
}: {
  label: string;
  icon: NavItem["icon"];
  href?: string;
  active: boolean;
  soon: boolean;
  soonLabel?: string;
  onNavigate: () => void;
}) {
  const styles = cn(
    "group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-200",
    active
      ? "bg-emerald-500/[0.12] font-medium text-accent"
      : "text-muted hover:bg-surface-raised hover:text-foreground",
    soon && "cursor-not-allowed opacity-55 hover:bg-transparent hover:text-muted",
  );

  if (soon || !href) {
    return (
      <span className={styles} aria-disabled="true" title={label}>
        <Icon className="size-[18px] shrink-0" />
        <span className="flex-1">{label}</span>
        {soon && soonLabel ? (
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-faint">
            {soonLabel}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <Link href={href} onClick={onNavigate} className={styles} aria-current={active ? "page" : undefined}>
      <Icon className="size-[18px] shrink-0" />
      <span className="flex-1">{label}</span>
    </Link>
  );
}
