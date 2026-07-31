import type { ActorType } from "@prisma/client";
import { cn } from "@/lib/utils";

/** Visual distinction between customer, staff, system, and integration actions. */
const STYLES: Record<ActorType, { label: string; className: string }> = {
  CUSTOMER: { label: "Customer", className: "bg-blue-50 text-blue-700 border-blue-200" },
  STAFF: { label: "Staff", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  SYSTEM: { label: "System", className: "bg-gray-100 text-gray-600 border-gray-200" },
  INTEGRATION: {
    label: "Pronatona",
    className: "bg-violet-50 text-violet-700 border-violet-200",
  },
};

export function ActorBadge({ actorType }: { actorType: ActorType }) {
  const style = STYLES[actorType];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        style.className,
      )}
    >
      {style.label}
    </span>
  );
}
