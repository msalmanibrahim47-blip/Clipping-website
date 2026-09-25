"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Download, FolderOpen, LayoutDashboard, LogOut, Menu, Plus, Settings, X } from "lucide-react";
import { api, useApi } from "@/lib/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/new", label: "New Project", icon: Plus },
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/processing", label: "Processing", icon: Activity },
  { href: "/exports", label: "Exports", icon: Download },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary">
        <svg viewBox="0 0 32 32" className="size-4" aria-hidden>
          <path d="M9 8v16h6" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M18 10l6 6-6 6" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">LongCut</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data: me } = useApi<{ user: { email: string; name: string | null } }>("/api/auth/me");
  const { data: jobs } = useApi<{ jobs: Array<{ status: string }> }>("/api/jobs", { interval: 8000 });
  const activeJobs = jobs?.jobs.filter((j) => j.status === "running" || j.status === "queued").length ?? 0;

  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
            isActive(href) ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          <Icon className="size-4" />
          <span className="flex-1">{label}</span>
          {href === "/processing" && activeJobs > 0 && (
            <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-semibold text-primary tabular">{activeJobs}</span>
          )}
        </Link>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-line pt-3">
      <div className="truncate px-3 text-xs text-muted" title={me?.user.email}>
        {me?.user.email ?? " "}
      </div>
      <button
        onClick={async () => {
          await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
          router.push("/login");
          router.refresh();
        }}
        className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] text-muted hover:bg-surface-2 hover:text-fg"
      >
        <LogOut className="size-4" /> Sign out
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3 py-5 lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <div className="flex-1">{nav}</div>
        {footer}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
          <Logo />
          <button onClick={() => setOpen((v) => !v)} className="rounded-md p-2 text-muted hover:bg-surface-2" aria-label="Menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </header>
        {open && (
          <div className="fixed inset-x-0 top-14 z-40 flex flex-col gap-4 border-b border-line bg-surface p-3 lg:hidden">
            {nav}
            {footer}
          </div>
        )}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8", className)}>{children}</div>;
}
