import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-aurora-display",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-aurora-sans",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-aurora-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "incus-web",
  description: "Multi-tenant Incus workspace control plane",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${inter.variable} ${jetBrainsMono.variable} dark h-full antialiased`}
    >
      <body className="aurora-page-shell min-h-full">{children}</body>
    </html>
  );
}
