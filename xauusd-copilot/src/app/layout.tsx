import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AurumDesk Pro | Institutional XAU/USD & Multi-Asset AI Trading Suite",
  description:
    "Multi-workspace trading terminal, 8-gate recommendation engine, order execution desk, Monte Carlo backtester, prop-firm analytics, and MT5 broker bridge.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
