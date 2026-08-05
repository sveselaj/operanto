import Link from "next/link";
import {
  Activity,
  ClipboardList,
  Gauge,
  MessageSquare,
  Plug,
  Settings,
  ShieldCheck,
  Sprout,
  Target,
  Users,
} from "lucide-react";
import type { MembershipRole } from "@prisma/client";
import { Phone } from "lucide-react";
import { can } from "@/lib/rbac";

const CORE_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/opportunities", label: "Opportunities", icon: Target },
  { href: "/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/activity", label: "Activity", icon: Activity },
];

export function Sidebar({
  role,
  growth = false,
  crm = false,
}: {
  role: MembershipRole;
  growth?: boolean;
  crm?: boolean;
}) {
  const crmItems =
    crm && can(role, "crm.view")
      ? [{ href: "/crm/leads", label: "Leads", icon: Phone }]
      : [];
  const growthItems =
    growth && can(role, "growth:view")
      ? [
          { href: "/growth", label: "Overview", icon: Sprout },
          { href: "/growth/target-profiles", label: "Target Profiles", icon: Target },
          { href: "/growth/accounts", label: "Accounts", icon: Users },
        ]
      : [];
  const adminItems = [
    ...(can(role, "integrations:manage")
      ? [{ href: "/integrations", label: "Integrations", icon: Plug }]
      : []),
    ...(can(role, "org:manage")
      ? [{ href: "/settings/organisation", label: "Settings", icon: Settings }]
      : []),
    ...(can(role, "audit:view")
      ? [{ href: "/audit", label: "Audit log", icon: ShieldCheck }]
      : []),
  ];

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <Link href="/dashboard" className="px-5 py-5 text-lg font-semibold tracking-tight text-white">
        Operanto
      </Link>
      <nav className="flex-1 space-y-0.5 px-2">
        {CORE_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm hover:bg-white/10 hover:text-white"
          >
            <item.icon className="h-4 w-4" aria-hidden />
            {item.label}
          </Link>
        ))}
        {crmItems.length > 0 ? (
          <div className="pt-4">
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-white/40">
              CRM
            </p>
            {crmItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm hover:bg-white/10 hover:text-white"
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
        {growthItems.length > 0 ? (
          <div className="pt-4">
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-white/40">
              Growth
            </p>
            {growthItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm hover:bg-white/10 hover:text-white"
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
        {adminItems.length > 0 ? (
          <div className="pt-4">
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-white/40">
              Administration
            </p>
            {adminItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm hover:bg-white/10 hover:text-white"
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </nav>
      <p className="px-5 py-4 text-[11px] text-white/40">
        Recognize. Resume. Resolve.
      </p>
    </aside>
  );
}
