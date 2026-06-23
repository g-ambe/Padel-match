import "./globals.css";
import type { Metadata } from "next";
import { GlobalMenu } from "@/components/global-menu";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Padel Club App",
  description: "パデルクラブのリアルタイム運用アプリ"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen">
        <ThemeProvider>
          <GlobalMenu />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
