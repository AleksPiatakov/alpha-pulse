import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alpha Pulse — Demo Trading Plans",
  description: "Demo-first Bybit trading-plan assistant",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uk"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
