"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const themeOptions = [
  {
    value: "system",
    title: "System",
    description: "Match the operating system appearance automatically.",
  },
  {
    value: "light",
    title: "Light",
    description: "Use a bright workspace for daytime and printed references.",
  },
  {
    value: "dark",
    title: "Dark",
    description: "Use a lower-glare interface for focused, low-light work.",
  },
] as const;

export function AppearanceSettingsPage() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const selectedTheme = (theme ?? "system") as "system" | "light" | "dark";
  const resolvedLabel = useMemo(() => {
    if (resolvedTheme === "dark") {
      return "Dark";
    }

    if (resolvedTheme === "light") {
      return "Light";
    }

    return "System";
  }, [resolvedTheme]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Appearance</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Choose how the interface looks across this device.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Theme preference</CardTitle>
          <CardDescription>
            Your current effective theme is{" "}
            <span className="font-medium text-foreground">{resolvedLabel}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            type="single"
            value={selectedTheme}
            onValueChange={(value) => {
              if (!value) {
                return;
              }

              setTheme(value);
            }}
            className="grid w-full gap-3 sm:grid-cols-3"
          >
            {themeOptions.map((option) => {
              const isActive = selectedTheme === option.value;

              return (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  variant="outline"
                  className={cn(
                    "h-auto min-h-28 flex-col items-start justify-start gap-2 rounded-xl px-4 py-4 text-left",
                    isActive
                      ? "border-foreground/15 bg-muted text-foreground"
                      : "text-foreground"
                  )}
                >
                  <span className="text-sm font-medium">{option.title}</span>
                  <span
                    className={cn(
                      "text-xs leading-relaxed",
                      isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                    )}
                  >
                    {option.description}
                  </span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </CardContent>
      </Card>
    </div>
  );
}
