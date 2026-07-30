import type { WorkspaceContext } from "@/lib/workspace";
import type { ToolDefinition } from "@/lib/tools/types";

/**
 * Approval policy resolution.
 *
 * Deny-by-default: a `write`-risk tool requires human approval unless the
 * workspace has explicitly opted into automating that specific tool. This is the
 * single place that decides "can this run without a human?" — see AGENTS spec §6.
 *
 * Auto-approval is intentionally NOT wired to any UI yet: enabling it is a
 * deliberate operator action. `AUTO_APPROVE` reads an allowlist from the
 * environment (comma-separated `workspaceSlug:toolName` pairs) so a deployment
 * can permit automation without a code change, while the default stays safe.
 */
function autoApproveAllowlist(): Set<string> {
  const raw = process.env.OPERANTO_AUTO_APPROVE ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isAutomationAllowed(ctx: WorkspaceContext, toolName: string): boolean {
  const allow = autoApproveAllowlist();
  return (
    allow.has(`${ctx.workspace.slug}:${toolName}`) || allow.has(`*:${toolName}`)
  );
}

/** Whether an approval must be created before this tool can produce its effect. */
export function requiresApproval(ctx: WorkspaceContext, tool: ToolDefinition): boolean {
  switch (tool.approval) {
    case "none":
      return false;
    case "always":
      return true;
    case "policy":
      return !isAutomationAllowed(ctx, tool.name);
    default:
      return true;
  }
}
