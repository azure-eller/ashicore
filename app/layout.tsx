import type { Metadata } from "next";
import { after } from "next/server";
import { Inter } from "next/font/google";
import {
  getRequestLogContext,
  logObservedEvent,
} from "@/lib/observability/request-log";
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
  const requestContext = await getRequestLogContext();

  after(() => {
    logObservedEvent("rsc.root_layout.complete", requestContext);
  });

  return (
    <html
      lang="en"
      className={inter.variable}
      suppressHydrationWarning
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
