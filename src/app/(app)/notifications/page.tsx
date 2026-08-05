import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { crmEnabled } from "@/lib/crm-flag";
import { listMyNotifications } from "@/lib/services/crm/notifications";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { dismissAction, markAllReadAction, markReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Notification payloads are i18n keys, never stored prose (so the same row
 * renders in any language). Until the cockpit has a translation layer, this
 * map is the English rendering.
 */
const TITLES: Record<string, string> = {
  callbackScheduled: "Callback scheduled",
  callbackDue: "Callback due",
  callbackOverdue: "Callback overdue",
  taskAssigned: "Task assigned",
  taskOverdue: "Task overdue",
  leadAssigned: "Lead assigned to you",
  lockOverridden: "Your work session was taken over",
};

export default async function NotificationsPage() {
  if (!crmEnabled()) notFound();
  const ctx = await requireOrg();
  const notifications = await listMyNotifications(ctx);
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader title="Notifications" description="Work that needs your attention.">
        {unread > 0 ? (
          <form action={markAllReadAction}>
            <Button type="submit" variant="outline" size="sm">
              Mark all read
            </Button>
          </form>
        ) : null}
      </PageHeader>

      {notifications.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          Nothing right now.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={`flex items-center gap-3 px-4 py-3 text-sm ${
                notification.readAt ? "text-muted-foreground" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className={notification.readAt ? "" : "font-medium"}>
                  {TITLES[notification.titleKey] ?? notification.titleKey}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(notification.createdAt)}
                  {notification.entityType === "Lead" && notification.entityId ? (
                    <>
                      {" · "}
                      <Link
                        href={`/crm/leads/${notification.entityId}`}
                        className="underline"
                      >
                        open lead
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {notification.readAt ? null : (
                  <form action={markReadAction}>
                    <input type="hidden" name="id" value={notification.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Read
                    </Button>
                  </form>
                )}
                <form action={dismissAction}>
                  <input type="hidden" name="id" value={notification.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Dismiss
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
