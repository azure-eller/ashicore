import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-brand";

const apkUrl =
  process.env.NEXT_PUBLIC_ANDROID_APK_URL ??
  "/downloads/ashicore-erp.apk";

export const metadata: Metadata = {
  title: "Android App",
  description: `Download the ${APP_NAME} Android app.`,
};

export default function AndroidDownloadPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-12">
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Android install
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Download {APP_NAME}
            </h1>
            <p className="max-w-xl text-base leading-7 text-muted-foreground">
              Install the employee Android app from the latest signed APK.
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-5 text-card-foreground shadow-sm">
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground">
              <li>Tap download on the Android phone.</li>
              <li>Allow installs from the browser if Android asks.</li>
              <li>Open the downloaded file and tap install.</li>
            </ol>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={apkUrl}>Download Android APK</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-in">Back to sign in</Link>
            </Button>
          </div>

          <p className="text-xs leading-5 text-muted-foreground">
            Updates use the same link. If Android says the app cannot be updated,
            uninstall the old app and install again.
          </p>
        </div>
      </section>
    </main>
  );
}
