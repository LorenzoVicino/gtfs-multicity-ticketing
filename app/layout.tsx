import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GTFS Hub",
  description: "Piattaforma GTFS urbana con ricerca citta e visualizzazione su mappa"
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
