import { z } from "zod";
import { can } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";
import { getVertical } from "@/lib/verticals/registry";
import { coreTools } from "@/lib/tools/core";
import type { ToolCatalogEntry, ToolDefinition } from "@/lib/tools/types";

/**
 * The tool registry. Composes vertical-agnostic core tools with the active
 * vertical's tools (resolved from `Workspace.vertical`). This is the assistant's
 * entire action surface — nothing runs that isn't here.
 */
export function getWorkspaceTools(vertical: string | null | undefined): ToolDefinition[] {
  const verticalTools = getVertical(vertical)?.tools ?? [];
  return [...coreTools, ...verticalTools];
}

export function getToolMap(vertical: string | null | undefined): Map<string, ToolDefinition> {
  return new Map(getWorkspaceTools(vertical).map((t) => [t.name, t]));
}

export function getTool(
  vertical: string | null | undefined,
  name: string,
): ToolDefinition | undefined {
  return getToolMap(vertical).get(name);
}

/** Tools the current user's role is permitted to use (deny-by-default). */
export function getVisibleTools(ctx: WorkspaceContext): ToolDefinition[] {
  return getWorkspaceTools(ctx.workspace.vertical).filter((t) =>
    can(ctx.member.role, t.permission),
  );
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Compact tool descriptions advertised to the planner (no execute/internals). */
export function toCatalog(tools: ToolDefinition[]): ToolCatalogEntry[] {
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    category: t.category,
    risk: t.risk,
    inputSchema: toJsonSchema(t.inputSchema),
  }));
}
