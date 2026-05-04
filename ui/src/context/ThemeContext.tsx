import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { IS_NEOFFICE } from "@/lib/deployment";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const THEME_STORAGE_KEY = "paperclip.theme";
//// Neoffice Modification: theme-sync-frappe
//// Why: Frappe Desk persists its current theme in localStorage.theme_active
////      (string "light" | "dark"). Since /app and /paperclip/ share the same
////      origin on Neoffice tenants, Paperclip can read this key directly.
////      Mirroring it ensures the embedded board doesn't look dark when the
////      user picked light in the Desk (or vice-versa).
//// Date: 2026-05-04
//// Refs: NORA #27 Phase C — see [[NORA/27-paperclip-neoffice-embed/README]]
const FRAPPE_THEME_STORAGE_KEY = "theme_active";
//// End Neoffice Modification: theme-sync-frappe

const DARK_THEME_COLOR = "#18181b";
const LIGHT_THEME_COLOR = "#ffffff";
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

//// Neoffice Modification: theme-sync-frappe
//// Why: Read the Frappe Desk theme at startup so the embedded board boots in
////      the right mode. Returns null when:
////        - we're not running in Neoffice mode (standalone / NeoCompany), or
////        - the Frappe key is missing or has an unexpected value.
////      Caller decides the fallback. Per user spec 2026-05-04: when in
////      Neoffice mode without a Frappe theme, default to "light" (NOT the
////      upstream default of "dark").
//// Refs: NORA #27 Phase C
function readFrappeTheme(): Theme | null {
  if (!IS_NEOFFICE || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(FRAPPE_THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // Storage can throw in private mode / restricted iframes — ignore.
  }
  return null;
}
//// End Neoffice Modification: theme-sync-frappe

function resolveThemeFromDocument(): Theme {
  //// Neoffice Modification: theme-sync-frappe
  //// Why: In Neoffice mode the source of truth is the Frappe Desk preference,
  ////      not whatever class the index.html bootstrap script applied (which
  ////      defaults to "dark"). When the Frappe key is unset, force "light"
  ////      per user requirement.
  //// Refs: NORA #27 Phase C
  const frappeTheme = readFrappeTheme();
  if (frappeTheme) return frappeTheme;
  if (IS_NEOFFICE) return "light";
  //// End Neoffice Modification: theme-sync-frappe

  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const isDark = theme === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta instanceof HTMLMetaElement) {
    themeColorMeta.setAttribute("content", isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => resolveThemeFromDocument());

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore local storage write failures in restricted environments.
    }
  }, [theme]);

  //// Neoffice Modification: theme-sync-frappe
  //// Why: Cross-tab sync. When the user toggles the theme in Frappe Desk
  ////      (storage event fires here, same origin), Paperclip mirrors it
  ////      without reload. The browser fires `storage` only on OTHER tabs
  ////      that share the same localStorage, so this also covers the case
  ////      where Paperclip is open in one tab and the Desk in another.
  //// Date: 2026-05-04
  //// Refs: NORA #27 Phase C
  useEffect(() => {
    if (!IS_NEOFFICE || typeof window === "undefined") return;
    const handler = (event: StorageEvent) => {
      if (event.key !== FRAPPE_THEME_STORAGE_KEY) return;
      if (event.newValue === "light" || event.newValue === "dark") {
        setThemeState(event.newValue);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  //// End Neoffice Modification: theme-sync-frappe

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
