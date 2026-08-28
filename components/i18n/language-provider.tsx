"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Language } from "@/lib/business/types";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionary";

const STORAGE_KEY = "abm-lang";

type LanguageContextValue = {
  language: Language;
  t: Dictionary;
  setLanguage: (language: Language) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Client-side language state for auth/onboarding/app-shell surfaces.
 * The server-rendered initial value comes from the business profile (or
 * "en" before setup); an explicit choice is persisted to localStorage so it
 * survives across pages immediately.
 */
export function LanguageProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: Language;
  children: ReactNode;
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  // Adopt a previously saved choice (e.g. picked on the login page before
  // the business profile exists). Runs post-mount so hydration stays stable.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "ur") {
        setLanguageState(stored);
      }
    } catch {
      // Storage unavailable — keep the server-provided default.
    }
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Session-only switch.
    }
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, t: getDictionary(language), setLanguage }),
    [language, setLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useI18n(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useI18n must be used inside a LanguageProvider");
  }
  return context;
}
