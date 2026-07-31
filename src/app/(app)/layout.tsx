import { redirect } from "next/navigation";
import { requireOrg, listMyOrganisations } from "@/lib/org-context";
import { prisma } from "@/lib/prisma";
import { roleRequiresTwoFactor } from "@/lib/services/two-factor";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireOrg();

  // Privileged roles can read every customer in the organisation, so the
  // cockpit stays closed to them until a second factor is active. Enrolment
  // lives at /two-factor, outside this layout, so the redirect cannot loop.
  if (roleRequiresTwoFactor(ctx.membership.role)) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: { totpConfirmedAt: true },
    });
    if (!user.totpConfirmedAt) redirect("/two-factor");
  }

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
