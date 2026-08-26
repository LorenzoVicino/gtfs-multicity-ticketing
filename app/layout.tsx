import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GTFS Hub",
  description: "A self-hosted platform for exploring, creating, editing, and validating multi-city GTFS feeds."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
