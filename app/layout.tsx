import "./globals.css";
import type { Metadata } from "next";
import { GlobalMenu } from "@/components/global-menu";
import { ThemeProvider } from "@/components/theme-provider";
import { ScoreSaveProvider } from "@/components/score-save-provider";
import { AppNavigation } from "@/components/app-navigation";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Padel Club App",
  description: "パデルクラブのリアルタイム運用アプリ"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen">
        <ThemeProvider>
          <ScoreSaveProvider>
            <GlobalMenu />
            {children}
            <Suspense fallback={null}><AppNavigation /></Suspense>
          </ScoreSaveProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
