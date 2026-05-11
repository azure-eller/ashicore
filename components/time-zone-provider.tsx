"use client";

import { createContext, useContext, type ReactNode } from "react";

const TimeZoneContext = createContext<string | null>(null);

export function TimeZoneProvider({
  children,
  timeZone,
}: {
  children: ReactNode;
  timeZone: string;
}) {
  return (
    <TimeZoneContext.Provider value={timeZone}>
      {children}
    </TimeZoneContext.Provider>
  );
}

export function useOrganizationTimeZone() {
  const timeZone = useContext(TimeZoneContext);

  if (!timeZone) {
    throw new Error("Organization timezone is not available.");
  }

  return timeZone;
}
