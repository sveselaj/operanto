"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  Inbox,
  Target,
  ShieldCheck,
  CheckSquare,
  BookOpen,
  PenLine,
  BarChart3,
  Workflow,
  Users,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

export function Sidebar({
  workspaceSlug,
  workspaceName,
  visible,
}: {
  workspaceSlug: string;
  workspaceName: string;
  visible: Record<string, boolean>;
}) {
  const pathname = usePathname();
  const base = `/${workspaceSlug}`;

  const items: NavItem[] = [
    { key: "command", label: "Command", href: `${base}/command`, icon: Sparkles },
    { key: "inbox", label: "Inbox", href: `${base}/inbox`, icon: Inbox },
    { key: "opportunities", label: "Opportunities", href: `${base}/opportunities`, icon: Target },
    { key: "approvals", label: "Approvals", href: `${base}/approvals`, icon: ShieldCheck },
    { key: "tasks", label: "Tasks", href: `${base}/tasks`, icon: CheckSquare },
    { key: "sops", label: "SOPs", href: `${base}/sops`, icon: BookOpen },
    { key: "studio", label: "Studio", href: `${base}/studio`, icon: PenLine },
    { key: "intelligence", label: "Intelligence", href: `${base}/intelligence`, icon: BarChart3 },
    { key: "automations", label: "Automations", href: `${base}/automations`, icon: Workflow },
    { key: "team", label: "Team", href: `${base}/team`, icon: Users },
    { key: "settings", label: "Settings", href: `${base}/settings`, icon: Settings },
  ];

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 px-5">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </div>
        <span className="text-[15px] font-semibold text-white">Operanto</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {items
          .filter((i) => visible[i.key] !== false)
          .map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-white/10 text-white"
                    : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
      </nav>

      <div className="border-t border-white/10 px-5 py-3 text-xs text-sidebar-foreground/70">
        {workspaceName}
      </div>
    </aside>
  );
}
