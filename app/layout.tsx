import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import { getOptionalSessionReadability } from "@/lib/dal/user-preferences";
import { normalizeReadabilityOption } from "@/lib/schemas/account";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: {
    default: "Paonia Soil Co ERP",
    template: "%s | Paonia Soil Co ERP",
  },
  description:
    "ERP workspace for inventory, manufacturing, sales, purchasing, and team operations.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [cookieStore, persistedReadability] = await Promise.all([
    cookies(),
    getOptionalSessionReadability(),
  ]);
  const cookieReadability = normalizeReadabilityOption(
    cookieStore.get("readability")?.value
  );
  const readability = persistedReadability ?? cookieReadability;
  const readabilityAttr = readability === "default" ? undefined : readability;

  return (
    <html
      lang="en"
      className={inter.variable}
      data-readability={readabilityAttr}
      suppressHydrationWarning
    >
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
