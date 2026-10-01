import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell, type NavCounts } from "@/components/shell";
import { authConfigured } from "@/lib/auth";
import { db } from "@/lib/db";

async function loadCounts(): Promise<NavCounts | null> {
  try {
    const { data, error } = await db().from("candidates").select("role_applied");
    if (error || !data) return null;
    return {
      all: data.length,
      pm: data.filter((r) => r.role_applied === "pm").length,
      spm: data.filter((r) => r.role_applied === "spm").length,
    };
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Candidate data is live; never prerender these pages at build time.
  await connection();
  const counts = await loadCounts();
  return (
    <Suspense>
      <AppShell counts={counts} signIn={authConfigured()}>{children}</AppShell>
    </Suspense>
  );
}
