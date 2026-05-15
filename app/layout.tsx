import type { Metadata } from "next";
import { after } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import {
  getRequestLogContext,
  logObservedEvent,
} from "@/lib/observability/request-log";
import { Providers } from "@/app/providers";
import { APP_NAME } from "@/lib/app-brand";
import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description:
    "Operations workspace for inventory, manufacturing, sales, purchasing, and team management.",
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
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
