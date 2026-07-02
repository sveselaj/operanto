import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";

/**
 * In-memory Prisma mock: enough of toolInvocation + approvalRequest to exercise
 * the runtime's real control flow (create/findFirst/findUnique/update/updateMany),
 * including the atomic `awaiting_approval → running` claim that guarantees a
 * single execution.
 */
const { db, auditFn, toolHolder } = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  let seq = 0;
  const composite = "workspaceId_idempotencyKey";

  function match(row: Row, where: Row): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === composite) {
        const cv = v as { workspaceId: string; idempotencyKey: string };
        if (row.workspaceId !== cv.workspaceId || row.idempotencyKey !== cv.idempotencyKey) return false;
      } else if (row[k] !== v) return false;
    }
    return true;
  }

  function collection() {
    const rows: Row[] = [];
    return {
      rows,
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `row_${++seq}`, ...data };
        rows.push(row);
        return { ...row };
      }),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const r = rows.find((x) => match(x, where));
        return r ? { ...r } : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const r = rows.find((x) => match(x, where));
        return r ? { ...r } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const r = rows.find((x) => match(x, where));
        if (!r) throw new Error("not found");
        Object.assign(r, data);
        return { ...r };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const matched = rows.filter((x) => match(x, where));
        matched.forEach((r) => Object.assign(r, data));
        return { count: matched.length };
      }),
    };
  }

  return {
    db: { toolInvocation: collection(), approvalRequest: collection() },
    auditFn: vi.fn(async (..._args: unknown[]) => {}),
    toolHolder: { tool: null as unknown },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => auditFn(...a) }));
vi.mock("@/lib/tools/registry", () => ({ getTool: () => toolHolder.tool }));

import { runTool, approveInvocation, rejectInvocation } from "@/lib/tools/runtime";
import { ForbiddenError } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";
import type { ToolDefinition, ToolExecutionContext } from "@/lib/tools/types";

const ctx = (role = "owner", workspaceId = "ws_1"): WorkspaceContext =>
  ({ workspace: { id: workspaceId, slug: "pronatona", vertical: "real-estate" }, member: { role }, userId: "u_1" }) as unknown as WorkspaceContext;

const exec = (c = ctx()): ToolExecutionContext => ({ ctx: c, threadId: null, correlationId: "corr_1" });

function makeTool(
  overrides: Partial<ToolDefinition> & { execute?: ToolDefinition["execute"] } = {},
): ToolDefinition {
  const execute = overrides.execute ?? vi.fn(async () => ({ ok: true }));
  const tool: ToolDefinition = {
    name: "test_tool",
    title: "Test tool",
    description: "",
    category: "test",
    risk: "write",
    permission: "conversations:reply",
    approval: "none",
    card: "generic",
    inputSchema: z.object({ body: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute,
    summarize: () => "done",
    ...overrides,
  };
  return tool;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.toolInvocation.rows.length = 0;
  db.approvalRequest.rows.length = 0;
  toolHolder.tool = null;
});

describe("runTool — validation & permission (deny by default)", () => {
  it("rejects invalid input without executing", async () => {
    const execFn = vi.fn(async () => ({ ok: true }));
    const tool = makeTool({ approval: "none", execute: execFn });
    const out = await runTool(exec(), tool, {} /* missing body */);
    expect(out.error).toBeTruthy();
    expect(out.invocation.status).toBe("failed");
    expect(execFn).not.toHaveBeenCalled();
  });

  it("denies a role without the tool's permission and does not execute", async () => {
    const execFn = vi.fn(async () => ({ ok: true }));
    // reviewer lacks conversations:reply
    const tool = makeTool({ approval: "none", permission: "conversations:reply", execute: execFn });
    const out = await runTool(exec(ctx("reviewer")), tool, { body: "hi" });
    expect(out.error).toBe("forbidden");
    expect(out.invocation.status).toBe("failed");
    expect(out.invocation.errorCode).toBe("forbidden");
    expect(execFn).not.toHaveBeenCalled();
  });
});

describe("runTool — read/none executes immediately", () => {
  it("runs a permitted no-approval tool and records completion", async () => {
    const execFn = vi.fn(async () => ({ ok: true }));
    const tool = makeTool({ approval: "none", execute: execFn });
    const out = await runTool(exec(), tool, { body: "hi" });
    expect(execFn).toHaveBeenCalledTimes(1);
    expect(out.invocation.status).toBe("completed");
    expect(out.block.type).toBe("tool");
    expect(out.awaitingApproval).toBe(false);
  });
});

describe("runTool — sensitive tool requires approval and does NOT execute", () => {
  it("creates an awaiting_approval invocation + pending approval", async () => {
    const execFn = vi.fn(async () => ({ ok: true }));
    const tool = makeTool({ approval: "always", execute: execFn });
    const out = await runTool(exec(), tool, { body: "hi" });
    expect(execFn).not.toHaveBeenCalled();
    expect(out.awaitingApproval).toBe(true);
    expect(out.invocation.status).toBe("awaiting_approval");
    expect(out.approval).toBeTruthy();
    expect(db.approvalRequest.rows[0]).toMatchObject({ status: "pending" });
  });
});

describe("approval resolution — single execution & no-execute-on-reject", () => {
  it("executes exactly once even if approved twice (idempotent approval)", async () => {
    const execFn = vi.fn(async () => ({ ok: true }));
    const tool = makeTool({ approval: "always", execute: execFn });
    toolHolder.tool = tool;
    const proposed = await runTool(exec(), tool, { body: "hi" });
    const invId = proposed.invocation.id;

    const first = await approveInvocation(ctx("owner"), invId);
    const second = await approveInvocation(ctx("owner"), invId);

    expect(execFn).toHaveBeenCalledTimes(1);
    expect(first.executed).toBe(true);
    expect(second.executed).toBe(false); // already completed → no re-run
    expect(first.invocation.status).toBe("completed");
  });

  it("rejects without executing, and a later approve is refused", async () => {
    const execFn = vi.fn(async () => ({ ok: true }));
    const tool = makeTool({ approval: "always", execute: execFn });
    toolHolder.tool = tool;
    const proposed = await runTool(exec(), tool, { body: "hi" });
    const invId = proposed.invocation.id;

    const rejected = await rejectInvocation(ctx("owner"), invId, { reviewNote: "no" });
    expect(rejected.status).toBe("rejected");
    expect(execFn).not.toHaveBeenCalled();

    await expect(approveInvocation(ctx("owner"), invId)).rejects.toThrow(/rejected/i);
    expect(execFn).not.toHaveBeenCalled();
  });

  it("denies approval to a role without approvals:review", async () => {
    const tool = makeTool({ approval: "always" });
    toolHolder.tool = tool;
    const proposed = await runTool(exec(), tool, { body: "hi" });
    await expect(approveInvocation(ctx("agent"), proposed.invocation.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("denies cross-workspace approval (invocation not found in caller's workspace)", async () => {
    const tool = makeTool({ approval: "always" });
    toolHolder.tool = tool;
    const proposed = await runTool(exec(ctx("owner", "ws_1")), tool, { body: "hi" });
    await expect(
      approveInvocation(ctx("owner", "ws_OTHER"), proposed.invocation.id),
    ).rejects.toThrow(/not found/i);
  });

  it("surfaces a connector/execution failure as failed with no false success", async () => {
    const execFn = vi.fn(async () => {
      throw new Error("Channel not connected");
    });
    const tool = makeTool({ approval: "always", execute: execFn });
    toolHolder.tool = tool;
    const proposed = await runTool(exec(), tool, { body: "hi" });
    const res = await approveInvocation(ctx("owner"), proposed.invocation.id);
    expect(res.executed).toBe(false);
    expect(res.error).toMatch(/not connected/i);
    expect(res.invocation.status).toBe("failed");
  });
});
