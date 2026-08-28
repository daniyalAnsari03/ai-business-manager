"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "abm-theme";

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
});

/**
 * Dark-first theme handling. The initial class is applied pre-paint by an
 * inline script in app/layout.tsx (no flash); this provider only keeps React
 * state in sync and persists explicit user choice.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggleTheme: () => {
        const next: Theme = window.document.documentElement.classList.contains(
          "dark",
        )
          ? "light"
          : "dark";
        document.documentElement.classList.toggle("dark", next === "dark");
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Storage unavailable (private mode etc.) — session-only switch.
        }
        setTheme(next);
      },
    }),
    [theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
