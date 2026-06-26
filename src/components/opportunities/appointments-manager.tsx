"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Download, Trash2 } from "lucide-react";
import type { AppointmentStatus, AppointmentType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { appointmentStatusLabel, appointmentStatusVariant, appointmentTypeLabel } from "@/lib/labels";
import {
  createAppointmentAction,
  setAppointmentStatusAction,
  deleteAppointmentAction,
  appointmentIcsAction,
  type ActionResult,
} from "@/app/[workspace]/opportunities/ops-actions";

const TYPES: AppointmentType[] = ["survey", "consultation", "installation", "support", "delivery"];
const STATUSES: AppointmentStatus[] = ["proposed", "scheduled", "confirmed", "completed", "cancelled", "no_show"];

export type AppointmentView = {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  title: string | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  location: string | null;
  assignee: string | null;
};

export function AppointmentsManager({
  slug,
  opportunityId,
  appointments,
  members,
  canManage,
}: {
  slug: string;
  opportunityId: string;
  appointments: AppointmentView[];
  members: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AppointmentType>("survey");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        after?.();
        router.refresh();
      } else setError(res.error);
    });
  }

  function book() {
    run(
      () =>
        createAppointmentAction(slug, opportunityId, {
          type,
          title: title || undefined,
          scheduledAt: when ? new Date(when).toISOString() : null,
          durationMinutes: duration ? Number(duration) : null,
          location: location || null,
          assignedToUserId: assignee || null,
        }),
      () => {
        setOpen(false);
        setTitle("");
        setWhen("");
        setLocation("");
      },
    );
  }

  async function downloadIcs(id: string) {
    const res = await appointmentIcsAction(slug, id);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    const blob = new Blob([res.ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div>
          {open ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Type
                  <select value={type} onChange={(e) => setType(e.target.value as AppointmentType)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                    {TYPES.map((t) => <option key={t} value={t}>{appointmentTypeLabel[t]}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  When
                  <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1" />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Duration (min)
                  <Input value={duration} inputMode="numeric" onChange={(e) => setDuration(e.target.value)} className="mt-1" />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Assignee
                  <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                    <option value="">Unassigned</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
                  Location
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="On-site / video" className="mt-1" />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={book} disabled={pending}>Book</Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
                {error && <span className="text-xs text-danger">{error}</span>}
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <CalendarPlus className="size-3.5" /> Book appointment
            </Button>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        {appointments.length === 0 && <p className="text-sm text-muted-foreground">No appointments.</p>}
        {appointments.map((a) => (
          <div key={a.id} className="rounded-md border border-border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{appointmentTypeLabel[a.type]}</Badge>
                <span className="font-medium">{a.title ?? appointmentTypeLabel[a.type]}</span>
                <Badge variant={appointmentStatusVariant[a.status]}>{appointmentStatusLabel[a.status]}</Badge>
              </div>
              <div className="flex items-center gap-2">
                {a.scheduledAt && (
                  <button onClick={() => downloadIcs(a.id)} className="text-muted-foreground hover:text-foreground" title="Download .ics">
                    <Download className="size-3.5" />
                  </button>
                )}
                {canManage && (
                  <button onClick={() => run(() => deleteAppointmentAction(slug, opportunityId, a.id))} className="text-muted-foreground hover:text-danger" title="Delete">
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {a.scheduledAt ? <span>{new Date(a.scheduledAt).toLocaleString()}</span> : <span>Not scheduled</span>}
              {a.location && <span>· {a.location}</span>}
              {a.assignee && <span>· {a.assignee}</span>}
              {canManage && (
                <select
                  value={a.status}
                  disabled={pending}
                  onChange={(e) => run(() => setAppointmentStatusAction(slug, opportunityId, a.id, e.target.value as AppointmentStatus))}
                  className="ml-auto h-7 rounded-md border border-border bg-background px-1.5 text-xs"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{appointmentStatusLabel[s]}</option>)}
                </select>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
