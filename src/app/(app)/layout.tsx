import { requireOrg, listMyOrganisations } from "@/lib/org-context";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { growthEnabled } from "@/lib/growth-flag";
import { crmEnabled } from "@/lib/crm-flag";
import { unreadNotificationCount } from "@/lib/services/crm/notifications";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireOrg();

  // The two-factor gate lives in requireOrg(), so it covers Server Actions
  // too — a layout only guards rendering.
  const memberships = await listMyOrganisations();
  // Notifications ship with the CRM module (OI-4); the bell appears with it.
  const unread = crmEnabled() ? await unreadNotificationCount(ctx) : 0;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role={ctx.membership.role} growth={growthEnabled()} crm={crmEnabled()} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          ctx={ctx}
          organisations={memberships.map((m) => ({
            organisationId: m.organisationId,
            name: m.organisation.name,
          }))}
          unreadNotifications={unread}
          showNotifications={crmEnabled()}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
