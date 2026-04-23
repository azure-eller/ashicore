import type { Metadata } from "next";
import { cookies } from "next/headers";
import { after } from "next/server";
import { Inter } from "next/font/google";
import { ReadabilityProvider } from "@/app/readability-provider";
import {
  getRequestLogContext,
  logObservedEvent,
} from "@/lib/observability/request-log";
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
  const requestContext = await getRequestLogContext();
  const cookieStore = await cookies();
  const readability = normalizeReadabilityOption(cookieStore.get("readability")?.value);
  const readabilityAttr = readability === "default" ? undefined : readability;

  after(() => {
    logObservedEvent("rsc.root_layout.complete", requestContext);
  });

  return (
    <html
      lang="en"
      className={inter.variable}
      data-readability={readabilityAttr}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ReadabilityProvider initial={readability}>{children}</ReadabilityProvider>
      </body>
    </html>
  );
}
