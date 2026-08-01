import { describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/org-context";
import { ForbiddenError } from "@/lib/rbac";

/**
 * Pure/permission behaviour of the conversation service: tenancy scoping
 * shapes, validation, and permission gates that must reject BEFORE any
 * database access. Query correctness against a real database is covered in
 * test/conversations.integration.test.ts.
 */

// The service only needs `scope` from org-context; keep the real shape.
vi.mock("@/lib/org-context", () => ({
  scope: (c: { organisation: { id: string } }) => ({
    organisationId: c.organisation.id,
  }),
}));
// An empty prisma stub: any test that reaches the database here is a bug —
// the call fails loudly instead of silently passing.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), auditSystem: vi.fn() }));

const {
  CONVERSATION_PRIORITIES,
  CONVERSATION_STATUSES,
  changeConversationStatus,
  conversationAccessWhere,
  createManualConversation,
} = await import("@/lib/services/conversations");

function ctxWithRole(role: "ADMIN" | "SUPERVISOR" | "OPERATOR"): OrgContext {
  return {
    organisation: { id: "org_1" },
    membership: { id: "mem_1", role },
    user: { id: "user_1", name: "Test", email: "test@example.com" },
  } as OrgContext;
}

describe("conversationAccessWhere", () => {
  it("scopes managers to the organisation only", () => {
    expect(conversationAccessWhere(ctxWithRole("ADMIN"))).toEqual({
      organisationId: "org_1",
    });
    expect(conversationAccessWhere(ctxWithRole("SUPERVISOR"))).toEqual({
      organisationId: "org_1",
    });
  });

  it("scopes operators to conversations they are assigned or created", () => {
    expect(conversationAccessWhere(ctxWithRole("OPERATOR"))).toEqual({
      organisationId: "org_1",
      OR: [
        { assignedMembershipId: "mem_1" },
        { createdByMembershipId: "mem_1" },
      ],
    });
  });
});

describe("status and priority vocabularies", () => {
  it("exposes exactly the four statuses and four priorities of the slice", () => {
    expect(CONVERSATION_STATUSES).toEqual(["OPEN", "PENDING", "RESOLVED", "ARCHIVED"]);
    expect(CONVERSATION_PRIORITIES).toEqual(["LOW", "NORMAL", "HIGH", "URGENT"]);
  });
});

describe("permission gates reject before any database access", () => {
  it("archiving requires conversations:archive, which operators lack", async () => {
    await expect(
      changeConversationStatus(ctxWithRole("OPERATOR"), "conv_1", "ARCHIVED"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("unknown statuses are rejected", async () => {
    await expect(
      changeConversationStatus(
        ctxWithRole("ADMIN"),
        "conv_1",
        "ESCALATED" as never,
      ),
    ).rejects.toThrow("Unknown status");
  });

  it("creation requires a counterpart name when no customer is linked", async () => {
    await expect(
      createManualConversation(ctxWithRole("ADMIN"), {}),
    ).rejects.toThrow("Name the counterpart or link a customer");
  });

  it("creation rejects oversized subjects before touching the database", async () => {
    await expect(
      createManualConversation(ctxWithRole("ADMIN"), {
        counterpartName: "Visitor",
        subject: "x".repeat(201),
      }),
    ).rejects.toThrow("Subject must be at most 200 characters");
  });
});
