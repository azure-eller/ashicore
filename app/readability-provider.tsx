"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReadabilityOption } from "@/lib/schemas/account";

type ReadabilityContextValue = {
  readability: ReadabilityOption;
  setReadability: (value: ReadabilityOption) => void;
};

const ReadabilityContext = createContext<ReadabilityContextValue | null>(null);

export function useReadability() {
  const context = useContext(ReadabilityContext);

  if (!context) {
    throw new Error("useReadability must be used within ReadabilityProvider");
  }

  return context;
}

export function ReadabilityProvider({
  initial,
  children,
}: {
  initial: ReadabilityOption;
  children: React.ReactNode;
}) {
  const [readability, setReadabilityState] = useState<ReadabilityOption>(initial);

  useEffect(() => {
    setReadabilityState(initial);
  }, [initial]);

  useEffect(() => {
    if (readability === "small") {
      document.documentElement.removeAttribute("data-readability");
      return;
    }

    document.documentElement.setAttribute("data-readability", readability);
  }, [readability]);

  const value = useMemo<ReadabilityContextValue>(
    () => ({
      readability,
      setReadability: (nextReadability) => setReadabilityState(nextReadability),
    }),
    [readability]
  );

  return (
    <ReadabilityContext.Provider value={value}>
      {children}
    </ReadabilityContext.Provider>
  );
}
