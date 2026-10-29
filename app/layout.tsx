import "./globals.css";
import type { Metadata } from "next";
import { GlobalMenu } from "@/components/global-menu";
import { ThemeProvider } from "@/components/theme-provider";
import { ScoreSaveProvider } from "@/components/score-save-provider";

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
          </ScoreSaveProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
