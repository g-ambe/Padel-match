import "./globals.css";
import type { Metadata } from "next";
import { GlobalMenu } from "@/components/global-menu";

export const metadata: Metadata = {
  title: "Padel Club App",
  description: "パデルクラブのリアルタイム運用アプリ"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen">
        <GlobalMenu />
        {children}
      </body>
    </html>
  );
}
