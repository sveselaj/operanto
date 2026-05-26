"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Search, ChevronsUpDown, LogOut, Check } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export type WorkspaceOption = { slug: string; name: string };

export function Topbar({
  current,
  workspaces,
  user,
  roleLabel,
}: {
  current: WorkspaceOption;
  workspaces: WorkspaceOption[];
  user: { name?: string | null; email?: string | null; image?: string | null };
  roleLabel: string;
}) {
  const router = useRouter();

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
      {/* Workspace switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted focus:outline-none">
          {current.name}
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.slug} onSelect={() => router.push(`/${w.slug}/command`)}>
              <span className="flex-1">{w.name}</span>
              {w.slug === current.slug && <Check className="size-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push("/select-workspace")}>
            Manage workspaces
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Global search (placeholder for command palette) */}
      <div className="relative ml-2 hidden max-w-md flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search conversations, tasks, SOPs…"
          className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-xs text-muted-foreground sm:inline">{roleLabel}</span>
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full focus:outline-none focus:ring-2 focus:ring-ring">
            <Avatar name={user.name} src={user.image} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="font-medium text-foreground">{user.name}</div>
              <div className="text-muted-foreground">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/select-workspace">Switch workspace</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/login" })}>
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
