import type { VerticalAdapter } from "@/lib/verticals/types";
import { realEstateAdapter } from "@/verticals/real-estate";

/**
 * Vertical assembly point. This is the ONLY module in the core that names a
 * concrete vertical — the composition root. Core runtime/services resolve the
 * active adapter from `Workspace.vertical` and never import a vertical directly.
 */
const ADAPTERS: Record<string, VerticalAdapter> = {
  [realEstateAdapter.id]: realEstateAdapter,
};

export function getVertical(id: string | null | undefined): VerticalAdapter | null {
  if (!id || id === "generic") return null;
  return ADAPTERS[id] ?? null;
}

export function listVerticals(): VerticalAdapter[] {
  return Object.values(ADAPTERS);
}
