import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requiresApproval, isAutomationAllowed } from "@/lib/tools/policy";
import type { WorkspaceContext } from "@/lib/workspace";
import type { ToolDefinition } from "@/lib/tools/types";

const ctx = (slug = "pronatona") =>
  ({ workspace: { id: "ws", slug }, member: { role: "owner" }, userId: "u" }) as unknown as WorkspaceContext;

const tool = (approval: ToolDefinition["approval"], name = "queue_social_post") =>
  ({ name, approval } as ToolDefinition);

describe("approval policy", () => {
  const original = process.env.OPERANTO_AUTO_APPROVE;
  beforeEach(() => {
    delete process.env.OPERANTO_AUTO_APPROVE;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OPERANTO_AUTO_APPROVE;
    else process.env.OPERANTO_AUTO_APPROVE = original;
  });

  it("never requires approval for read/none tools", () => {
    expect(requiresApproval(ctx(), tool("none"))).toBe(false);
  });

  it("always requires approval for always-tools", () => {
    expect(requiresApproval(ctx(), tool("always"))).toBe(true);
  });

  it("requires approval for policy-tools by default (deny-by-default)", () => {
    expect(requiresApproval(ctx(), tool("policy"))).toBe(true);
  });

  it("permits automation only via an explicit workspace:tool allowlist entry", () => {
    process.env.OPERANTO_AUTO_APPROVE = "pronatona:queue_social_post";
    expect(isAutomationAllowed(ctx("pronatona"), "queue_social_post")).toBe(true);
    expect(requiresApproval(ctx("pronatona"), tool("policy"))).toBe(false);
    // Different workspace is not covered by the allowlist entry.
    expect(requiresApproval(ctx("bloom-studio"), tool("policy"))).toBe(true);
  });

  it("supports a wildcard workspace in the allowlist", () => {
    process.env.OPERANTO_AUTO_APPROVE = "*:queue_social_post";
    expect(isAutomationAllowed(ctx("anything"), "queue_social_post")).toBe(true);
  });
});
