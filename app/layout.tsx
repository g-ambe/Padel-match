import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Padel Club App",
  description: "パデルクラブのリアルタイム運用アプリ"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
