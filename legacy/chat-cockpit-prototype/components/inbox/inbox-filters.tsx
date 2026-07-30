"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "waiting_customer", label: "Waiting" },
  { value: "resolved", label: "Resolved" },
];

const CHANNELS = [
  { value: "all", label: "All channels" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "webchat", label: "Web chat" },
  { value: "manual", label: "Manual" },
];

export function InboxFilters({ counts }: { counts: Record<string, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const status = searchParams.get("status") ?? "all";
  const channel = searchParams.get("channel") ?? "all";
  const assignee = searchParams.get("assignee") ?? "all";
  const [q, setQ] = useState(searchParams.get("q") ?? "");

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === "all") params.delete(key);
      else params.set(key, value);
      const qs = params.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
    },
    [pathname, router, searchParams],
  );

  // Debounce search.
  useEffect(() => {
    const current = searchParams.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => setParam("q", q), 300);
    return () => clearTimeout(t);
  }, [q, searchParams, setParam]);

  return (
    <div className="space-y-2 border-b border-border p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search conversations…"
          className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <select
          value={channel}
          onChange={(e) => setParam("channel", e.target.value)}
          className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={assignee}
          onChange={(e) => setParam("assignee", e.target.value)}
          className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-1">
        {STATUS_TABS.map((tab) => {
          const active = status === tab.value;
          const count = counts[tab.value];
          return (
            <button
              key={tab.value}
              onClick={() => setParam("status", tab.value)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {typeof count === "number" && (
                <span className={cn("ml-1", active ? "opacity-80" : "opacity-60")}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
