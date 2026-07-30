/**
 * Vertical extension point.
 *
 * Operanto's core (assistant runtime, tool runtime, approvals, CRM) is
 * vertical-agnostic. A vertical adds domain tools, grounding context, and card
 * renderers WITHOUT the core importing its concrete entities. The real-estate
 * adapter (Pronatona) is the reference implementation — see
 * `src/verticals/real-estate`.
 */
import type { ToolDefinition } from "@/lib/tools/types";

export type VerticalAdapter = {
  /** Stable id stored on `Workspace.vertical`, e.g. "real-estate". */
  id: string;
  label: string;
  /** Domain tools contributed to the tool registry. */
  tools: ToolDefinition[];
  /**
   * Extra grounding notes injected into the assistant's system prompt so it
   * knows the domain rules (e.g. "never claim a property is available without
   * calling check_property_availability").
   */
  assistantContext?: string;
  /** Card renderer keys this vertical contributes (documentation/discovery). */
  cardKinds?: string[];
};
