import type { Metadata } from "next";
import Link from "next/link";
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
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-(--space-12) py-(--space-24)">
        <div className="space-y-(--space-16)">
          <div className="space-y-(--space-6)">
            <p className="text-[length:var(--text-xs)] leading-[var(--leading-xs)] font-semibold tracking-[var(--tracking-caps)] text-muted-foreground uppercase">
              Mobile app
            </p>
            <h1 className="text-[length:var(--text-2xl)] leading-[var(--leading-2xl)] font-semibold tracking-[var(--tracking-tight)]">
              Download the mobile app
            </h1>
            <p className="max-w-xl text-[length:var(--text-base)] leading-[var(--leading-base)] text-muted-foreground">
              Use this link on an Android phone to install the employee app.
            </p>
          </div>

          <SurfacePanel className="p-(--space-10) shadow-none">
            <ol className="list-decimal space-y-(--space-6) pl-(--space-10) text-[length:var(--text-sm)] leading-[var(--leading-sm)] text-muted-foreground">
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

          <p className="text-[length:var(--text-xs)] leading-[var(--leading-xs)] text-muted-foreground">
            Updates use this same page.
          </p>
        </div>
      </section>
    </main>
  );
}
