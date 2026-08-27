import { Moon, Sun } from "lucide-react";
import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from "react";

export type UiTheme = "dark" | "light";

const THEME_STORAGE_KEY = "ui-authoring.theme";

interface ThemeContextValue {
  readonly theme: UiTheme;
  readonly setTheme: (theme: UiTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function storedTheme(): UiTheme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setTheme] = useState<UiTheme>(storedTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme remains usable when storage is unavailable.
    }
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle({ className }: { readonly className?: string }) {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeToggle requires ThemeProvider");
  const nextTheme: UiTheme = context.theme === "dark" ? "light" : "dark";
  const title = nextTheme === "light" ? "切换为浅色主题" : "切换为深色主题";
  return (
    <button
      className={className}
      type="button"
      onClick={() => context.setTheme(nextTheme)}
      title={title}
      aria-label={title}
      data-theme-toggle={context.theme}
    >
      {nextTheme === "light" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
