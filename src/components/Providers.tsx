"use client";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { fetcher } from "@/lib/client/api";
import { BootstrapProvider } from "@/lib/client/bootstrap";
import { ToastProvider } from "./Toast";
import { AppShell } from "./AppShell";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: false, shouldRetryOnError: false }}>
      <ToastProvider>
        <BootstrapProvider>
          <AppShell>{children}</AppShell>
        </BootstrapProvider>
      </ToastProvider>
    </SWRConfig>
  );
}
