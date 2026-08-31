import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Badges Demo",
  description: "A 3D enamel pins and badges showcase",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/typeface.json"
          as="fetch"
          type="application/json"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
