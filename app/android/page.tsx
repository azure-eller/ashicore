import type { Metadata } from "next";
import Link from "next/link";
import { MobileProtectionIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SurfacePanel } from "@/components/surface-panel";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-brand";

const apkUrl =
  process.env.NEXT_PUBLIC_ANDROID_APK_URL ??
  "/downloads/ashicore-erp.apk";

export const metadata: Metadata = {
  title: "Mobile App",
  description: `Download the ${APP_NAME} mobile app.`,
};

export default function AndroidDownloadPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      <section className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-(--space-12) py-(--space-24)">
        <div className="space-y-(--space-16)">
          <div className="space-y-(--space-6)">
            <div className="grid size-(--space-16) place-items-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]">
              <HugeiconsIcon icon={MobileProtectionIcon} size={22} strokeWidth={2} />
            </div>
            <p className="text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-caps)] text-[var(--color-ink-faint)] uppercase">
              Mobile app
            </p>
            <h1 className="font-display text-[length:var(--text-2xl)] leading-[var(--leading-2xl)] font-semibold tracking-normal text-[var(--color-ink)]">
              Download the mobile app
            </h1>
            <p className="max-w-xl text-[length:var(--text-base)] leading-[var(--leading-base)] text-[var(--color-ink-faint)]">
              Use this link on an Android phone to install the employee app.
            </p>
          </div>

          <SurfacePanel className="p-(--space-10)">
            <ol className="list-decimal space-y-(--space-6) pl-(--space-10) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-[var(--color-ink-faint)]">
              <li>Open this page on the phone.</li>
              <li>Tap download.</li>
              <li>If the phone asks for permission, allow the install.</li>
            </ol>
          </SurfacePanel>

          <div className="flex flex-col gap-(--space-6) sm:flex-row">
            <Button asChild size="lg">
              <Link href={apkUrl}>Download mobile app</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-in">Back to sign in</Link>
            </Button>
          </div>

          <p className="text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-[var(--color-ink-faint)]">
            Updates use this same page.
          </p>
        </div>
      </section>
    </main>
  );
}
