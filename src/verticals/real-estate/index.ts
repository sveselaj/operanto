import type { VerticalAdapter } from "@/lib/verticals/types";
import { realEstateTools } from "@/verticals/real-estate/tools";

/**
 * Pronatona real-estate vertical adapter.
 *
 * Registered against `Workspace.vertical = "real-estate"`. Contributes property,
 * viewing, and social tools plus grounding rules to the assistant.
 */
export const realEstateAdapter: VerticalAdapter = {
  id: "real-estate",
  label: "Real estate",
  tools: realEstateTools,
  assistantContext:
    "This workspace sells and rents real estate. Property code, price, area, location, media, and " +
    "availability come ONLY from the Property catalogue via tools. Never state that a property is " +
    "available, its price, or its legal/ownership status without a fresh check_property_availability " +
    "or get_property result. When a property is reserved/sold, do not claim it is available — offer " +
    "matching alternatives with find_matching_properties instead.",
  cardKinds: [
    "property.list",
    "property.detail",
    "property.availability",
    "social.draft",
    "social.queued",
    "viewing.request",
    "viewing.scheduled",
    "agent.availability",
  ],
};
