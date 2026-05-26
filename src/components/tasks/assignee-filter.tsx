"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function AssigneeFilter({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function set(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "all") params.delete("assignee");
    else params.set("assignee", v);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <select
      value={value}
      onChange={(e) => set(e.target.value)}
      className="h-9 rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="all">All tasks</option>
      <option value="me">Assigned to me</option>
    </select>
  );
}
