import { Space_Grotesk, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";

// Marketing-site type system, scoped to the onboarding flow only. Space Grotesk
// for display, Hanken Grotesk for body/UI, JetBrains Mono for eyebrows/labels/SKUs.
// Exposed as CSS variables and applied to the onboarding-flow-screen roots; the
// scoped token block in globals.css maps --font-sans/--font-display/--font-mono to them.
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ob-display",
  display: "swap",
});

const body = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ob-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ob-mono",
  display: "swap",
});

export const onboardingFontVariables = `${display.variable} ${body.variable} ${mono.variable}`;
