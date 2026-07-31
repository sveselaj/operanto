import { requireOrg, listMyOrganisations } from "@/lib/org-context";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireOrg();
  const memberships = await listMyOrganisations();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role={ctx.membership.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          ctx={ctx}
          organisations={memberships.map((m) => ({
            organisationId: m.organisationId,
            name: m.organisation.name,
          }))}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
