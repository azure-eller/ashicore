import type { Metadata } from "next";
import { after } from "next/server";
import { Space_Grotesk } from "next/font/google";
import {
  getRequestLogContext,
  logObservedEvent,
} from "@/lib/observability/request-log";
import { Providers } from "@/app/providers";
import { APP_NAME } from "@/lib/app-brand";
import "./globals.css";

// One family across all three roles: Space Grotesk carries display, body, and
// "mono"/numeric text (kept on tabular-nums for alignment).
const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-app-sans",
});
const mono = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-app-mono",
});
const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-app-display",
});

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
      className={`${sans.variable} ${mono.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
