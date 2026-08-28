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
      <body>{children}</body>
    </html>
  );
}
