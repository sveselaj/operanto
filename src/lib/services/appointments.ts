import "server-only";
import type { AppointmentStatus, AppointmentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import { buildICS } from "@/lib/ics";

/**
 * Scheduling — appointments linked to opportunities, exportable as ICS and
 * (optionally) pushed to a calendar via the Integration Hub.
 */

export function listAppointments(ctx: WorkspaceContext, opportunityId?: string) {
  requirePermission(ctx.member.role, "appointments:manage");
  return prisma.appointment.findMany({
    where: { workspaceId: ctx.workspace.id, ...(opportunityId ? { opportunityId } : {}) },
    include: { assignedTo: true, customer: true },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
  });
}

export type AppointmentInput = {
  opportunityId?: string | null;
  customerId?: string | null;
  type: AppointmentType;
  title?: string | null;
  scheduledAt?: string | null; // ISO
  durationMinutes?: number | null;
  location?: string | null;
  assignedToUserId?: string | null;
  notes?: string | null;
};

export async function createAppointment(ctx: WorkspaceContext, input: AppointmentInput) {
  requirePermission(ctx.member.role, "appointments:manage");

  // Default the customer from the opportunity when not provided.
  let customerId = input.customerId ?? null;
  if (!customerId && input.opportunityId) {
    const opp = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, workspaceId: ctx.workspace.id },
      select: { customerId: true },
    });
    customerId = opp?.customerId ?? null;
  }

  const appt = await prisma.appointment.create({
    data: {
      workspaceId: ctx.workspace.id,
      opportunityId: input.opportunityId ?? null,
      customerId,
      type: input.type,
      status: input.scheduledAt ? "scheduled" : "proposed",
      title: input.title?.trim() || null,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      durationMinutes: input.durationMinutes ?? 60,
      location: input.location?.trim() || null,
      assignedToUserId: input.assignedToUserId ?? null,
      notes: input.notes ?? null,
    },
  });
  await audit(ctx, { action: "appointment.create", entity: "Appointment", entityId: appt.id });
  return appt;
}

async function assertAppointment(ctx: WorkspaceContext, id: string) {
  const a = await prisma.appointment.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
  });
  if (!a) throw new Error("Appointment not found");
  return a;
}

export async function setAppointmentStatus(ctx: WorkspaceContext, id: string, status: AppointmentStatus) {
  requirePermission(ctx.member.role, "appointments:manage");
  await assertAppointment(ctx, id);
  await prisma.appointment.update({ where: { id }, data: { status } });
  await audit(ctx, { action: "appointment.status", entity: "Appointment", entityId: id, after: { status } });
}

export async function deleteAppointment(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "appointments:manage");
  await assertAppointment(ctx, id);
  await prisma.appointment.delete({ where: { id } });
  await audit(ctx, { action: "appointment.delete", entity: "Appointment", entityId: id });
}

/** Build an ICS document for an appointment (must be scheduled). */
export async function appointmentIcs(ctx: WorkspaceContext, id: string): Promise<string> {
  requirePermission(ctx.member.role, "appointments:manage");
  const a = await prisma.appointment.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    include: { customer: true },
  });
  if (!a) throw new Error("Appointment not found");
  if (!a.scheduledAt) throw new Error("Appointment has no scheduled time yet");
  return buildICS({
    uid: `${a.id}@operanto`,
    title: a.title ?? `${a.type} — ${a.customer?.name ?? "customer"}`,
    start: a.scheduledAt,
    durationMinutes: a.durationMinutes,
    location: a.location,
    description: a.notes,
  });
}
