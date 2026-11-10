"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { savePreference } from "@/lib/user-preferences";
import { useSessionAccount } from "./use-session-account";

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
  const account = useSessionAccount();
  const isSharePage = pathname.startsWith("/share/");
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
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

    if (account.ready && account.id) void (async () => {
      const { data: preference } = await supabase
        .from("user_preferences")
        .select("theme_mode")
        .eq("auth_user_id", account.id)
        .maybeSingle();
      if (!active) return;
      const remoteTheme = isThemeMode(preference?.theme_mode) ? preference.theme_mode : "dark";
      setThemeState(remoteTheme);
      applyTheme(remoteTheme);
      window.localStorage.setItem(STORAGE_KEY, remoteTheme);
    })();
    return () => { active = false; };
  }, [isSharePage, account.ready, account.id]);

  const setTheme = async (nextTheme: ThemeMode) => {
    if (isSharePage) return;
    setMessage("");
    setThemeState(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);

    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSaving(true);
    try { if (account.id) { await savePreference(supabase, account.id, "theme_mode", nextTheme); setMessage("保存しました"); } }
    catch { setMessage("設定を保存できませんでした。再度お試しください。"); }
    finally { setSaving(false); }
  };

  const value = useMemo(() => ({ theme, saving, message, setTheme }), [theme, saving, message]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
