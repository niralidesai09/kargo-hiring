"use client";

import clsx from "clsx";
import { LogOut, Menu, Settings, Upload, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

export interface NavCounts {
  all: number;
  pm: number;
  spm: number;
}

function NavLink({ href, active, children, count }: { href: string; active: boolean; children: ReactNode; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex h-8 items-center justify-between rounded-[var(--radius)] px-2.5 text-base transition-colors duration-[var(--dur-fast)]",
        active ? "bg-sheet font-medium text-ink shadow-sheet ring-1 ring-rule" : "text-ink-2 hover:bg-sheet-3 hover:text-ink",
      )}
    >
      <span>{children}</span>
      {count != null && <span className="tabular text-sm text-ink-3">{count}</span>}
    </Link>
  );
}

function SidebarContent({ counts, onNavigate, signIn }: { counts: NavCounts | null; onNavigate?: () => void; signIn: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const onList = pathname === "/";
  const role = params.get("role");

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col" onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate?.()}>
      <Link href="/" className="mb-6 block px-2.5 pt-1">
        <span className="block text-lg font-semibold tracking-[-0.02em]">Kargo</span>
        <span className="block text-sm text-ink-3">Hiring</span>
      </Link>
      <nav aria-label="Candidates" className="flex flex-col gap-0.5">
        <NavLink href="/" active={onList && !role} count={counts?.all}>All candidates</NavLink>
        <NavLink href="/?role=pm" active={onList && role === "pm"} count={counts?.pm}>Product Manager</NavLink>
        <NavLink href="/?role=spm" active={onList && role === "spm"} count={counts?.spm}>Senior Product Manager</NavLink>
      </nav>
      <div className="my-4 border-t border-rule" />
      <nav aria-label="Workspace" className="flex flex-col gap-0.5">
        <NavLink href="/upload" active={pathname === "/upload"}>
          <span className="inline-flex items-center gap-2"><Upload className="size-3.5 text-ink-3" aria-hidden />Screen a candidate</span>
        </NavLink>
        <NavLink href="/settings" active={pathname === "/settings"}>
          <span className="inline-flex items-center gap-2"><Settings className="size-3.5 text-ink-3" aria-hidden />Settings</span>
        </NavLink>
      </nav>
      <div className="mt-auto flex items-center justify-between border-t border-rule px-2.5 pt-3">
        <span className="flex items-center gap-2">
          <span aria-hidden className="grid size-6 place-items-center rounded-full bg-ink text-2xs font-semibold text-sheet">AM</span>
          <span className="text-sm text-ink-2">Arjun Mehta</span>
        </span>
        {signIn && (
          <button type="button" onClick={signOut} className="rounded p-1 text-ink-3 hover:text-ink" aria-label="Sign out" title="Sign out">
            <LogOut className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function AppShell({ children, counts, signIn }: { children: ReactNode; counts: NavCounts | null; signIn: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-rule bg-sheet-2 px-3 py-5 lg:block">
        <SidebarContent counts={counts} signIn={signIn} />
      </aside>

      {/* Small screens: a slim bar with a drawer. */}
      <div className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-rule bg-paper/95 px-4 backdrop-blur-sm lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="-ml-1 rounded p-1.5 text-ink-2" aria-label="Open navigation" aria-expanded={open}>
          <Menu className="size-4" />
        </button>
        <Link href="/" className="text-base font-semibold">Kargo <span className="font-normal text-ink-3">Hiring</span></Link>
        <Link href="/upload" className="-mr-1 rounded p-1.5 text-ink-2" aria-label="Screen a candidate">
          <Upload className="size-4" />
        </Link>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-ink/25" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[272px] border-r border-rule bg-sheet-2 px-3 py-5 shadow-pop">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded p-1 text-ink-3" aria-label="Close navigation">
              <X className="size-4" />
            </button>
            <SidebarContent counts={counts} signIn={signIn} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main id="main" className="min-w-0">{children}</main>
    </div>
  );
}
