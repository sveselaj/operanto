import "server-only";
import type { ActorType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrgContext } from "@/lib/org-context";

type AuditInput = {
  eventType: string;
  targetType: string;
  targetId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  correlationId?: string;
  requestId?: string;
};

/** Audit a staff action performed inside an org context. */
export async function audit(ctx: OrgContext, input: AuditInput) {
  await prisma.auditEvent.create({
    data: {
      organisationId: ctx.organisation.id,
      actorType: "STAFF",
      actorUserId: ctx.user.id,
      actorMembershipId: ctx.membership.id,
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      beforeMetadata: input.before,
      afterMetadata: input.after,
      correlationId: input.correlationId,
      requestId: input.requestId,
    },
  });
}

/** Audit a system/integration action (event processing, retries, jobs). */
export async function auditSystem(
  organisationId: string,
  actorType: Extract<ActorType, "SYSTEM" | "INTEGRATION">,
  input: AuditInput,
) {
  await prisma.auditEvent.create({
    data: {
      organisationId,
      actorType,
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      beforeMetadata: input.before,
      afterMetadata: input.after,
      correlationId: input.correlationId,
      requestId: input.requestId,
    },
  });
}
