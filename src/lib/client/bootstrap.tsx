"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import useSWR, { type KeyedMutator } from "swr";
import { fetcher } from "./api";
import type { Bootstrap } from "./types";

interface BootstrapCtx {
  data: Bootstrap | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<Bootstrap>;
  skewMs: number; // server_time - client_time at last fetch
}

const Ctx = createContext<BootstrapCtx | null>(null);

export function BootstrapProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, mutate } = useSWR<Bootstrap>("/bootstrap", fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 4000,
  });
  const skewMs = useMemo(
    () => (data ? new Date(data.server_time).getTime() - Date.now() : 0),
    [data?.server_time], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <Ctx.Provider value={{ data, isLoading, mutate, skewMs }}>{children}</Ctx.Provider>;
}

export function useBootstrap(): BootstrapCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBootstrap must be used within BootstrapProvider");
  return ctx;
}

/** Returns a function giving the server-aligned current time in ms. */
export function useServerNow(): () => number {
  const { skewMs } = useBootstrap();
  return () => Date.now() + skewMs;
}
