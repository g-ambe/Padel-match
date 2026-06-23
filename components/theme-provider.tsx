"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

type ThemeMode = "dark" | "light";

type ThemeContextValue = {
  theme: ThemeMode;
  saving: boolean;
  message: string;
  setTheme: (theme: ThemeMode) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "padel-theme-mode";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isSharePage = pathname.startsWith("/share/");
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (isSharePage) {
      applyTheme("dark");
      setThemeState("dark");
      return;
    }

    const cached = window.localStorage.getItem(STORAGE_KEY);
    const initialTheme = isThemeMode(cached) ? cached : "dark";
    setThemeState(initialTheme);
    applyTheme(initialTheme);

    const supabase = getSupabaseClient();
    if (!supabase) return;

    void supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) return;
      const { data: preference } = await supabase
        .from("user_preferences")
        .select("theme_mode")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      const remoteTheme = isThemeMode(preference?.theme_mode) ? preference.theme_mode : "dark";
      setThemeState(remoteTheme);
      applyTheme(remoteTheme);
      window.localStorage.setItem(STORAGE_KEY, remoteTheme);
    });
  }, [isSharePage]);

  const setTheme = async (nextTheme: ThemeMode) => {
    if (isSharePage) return;
    setMessage("");
    setThemeState(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);

    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSaving(true);
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user) {
      const { error } = await supabase.from("user_preferences").upsert({
        auth_user_id: user.id,
        theme_mode: nextTheme,
        updated_at: new Date().toISOString()
      });
      if (!error) setMessage("保存しました");
    }
    setSaving(false);
  };

  const value = useMemo(() => ({ theme, saving, message, setTheme }), [theme, saving, message]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
