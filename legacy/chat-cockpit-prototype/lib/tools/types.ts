/**
 * Typed tool contract for the Operanto assistant.
 *
 * The AI never touches the database directly. It *proposes* a call to a named,
 * schema-validated tool; the runtime (see ./runtime.ts) is the sole executor and
 * enforces permission + approval before anything runs. Tools are the only bridge
 * between natural language and backend effects.
 */
import type { z } from "zod";
import type { ToolRisk } from "@prisma/client";
import type { Permission } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";

/**
 * How a tool is gated:
 * - `none`   → run automatically for a permitted user (read-only).
 * - `policy` → run only if a workspace policy permits automation, else approve.
 * - `always` → always require an explicit human approval.
 */
export type ApprovalPolicy = "none" | "policy" | "always";

/** Context handed to a tool's `execute`: workspace-scoped, with the turn's ids. */
export type ToolExecutionContext = {
  ctx: WorkspaceContext;
  threadId?: string | null;
  /** Ties every event of one assistant turn / approval together in the audit log. */
  correlationId: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ToolDefinition<TInput = any, TOutput = any> = {
  /** Stable machine name the model references, e.g. "search_contacts". */
  name: string;
  /** Human-friendly title shown on cards, e.g. "Search contacts". */
  title: string;
  description: string;
  /** Grouping used in the UI and docs, e.g. "contacts", "properties". */
  category: string;
  risk: ToolRisk;
  permission: Permission;
  approval: ApprovalPolicy;
  /** Safe to run twice with the same idempotency key → single effect. */
  idempotent?: boolean;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  /** Card renderer key the UI maps to a component, e.g. "contact.list". */
  card: string;
  execute: (exec: ToolExecutionContext, input: TInput) => Promise<TOutput>;
  /** One-line human summary of a result, shown on the tool-execution card. */
  summarize: (output: TOutput, input: TInput) => string;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** A tool advertised to the planner (no execute/schema internals). */
export type ToolCatalogEntry = {
  name: string;
  title: string;
  description: string;
  category: string;
  risk: ToolRisk;
  /** JSON-schema-ish description of the input shape for the planner. */
  inputSchema: Record<string, unknown>;
};

/** Structured content stored on an AssistantMessage and rendered as cards. */
export type CockpitBlock =
  | { type: "text"; text: string }
  | {
      type: "tool";
      invocationId: string;
      toolName: string;
      title: string;
      category: string;
      risk: ToolRisk;
      status: string;
      card: string;
      data: unknown;
      summary: string;
    }
  | {
      type: "approval";
      approvalId: string;
      invocationId: string;
      toolName: string;
      title: string;
      summary: string;
      risk: ToolRisk;
      status: string;
      card: string;
      data: unknown;
    }
  | { type: "error"; code: string; message: string; toolName?: string };

export type AssistantStructuredContent = {
  blocks: CockpitBlock[];
};
