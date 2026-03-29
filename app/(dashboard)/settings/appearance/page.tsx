import type { Metadata } from "next";
import { AppearanceSettingsPage } from "./appearance-settings-page";

export const metadata: Metadata = {
  title: "Appearance",
};

export default function SettingsAppearancePage() {
  return <AppearanceSettingsPage />;
}
