import type { Metadata } from "next";
import Link from "next/link";
import type { LeadStatus } from "@prisma/client";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { listLeads } from "@/lib/services/crm/leads";
import { LeadStatus as LEAD_STATUS } from "@operanto/crm-domain";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatStage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createLeadAction } from "./actions";

export const metadata: Metadata = { title: "Leads" };

const LEAD_STATUSES = Object.values(LEAD_STATUS);

export default async function LeadsPage({ searchParams }: PageProps<"/crm/leads">) {
  const ctx = await requireOrg();
  const params = await searchParams;
  const statusParam = typeof params.status === "string" ? params.status : undefined;
  const status = LEAD_STATUSES.includes(statusParam as LeadStatus)
    ? (statusParam as LeadStatus)
    : undefined;
  const unassigned = params.unassigned === "1";

  const leads = await listLeads(ctx, { status, unassigned });
  const canCreate = can(ctx.membership.role, "crm.leads.create");

  return (
    <>
      <PageHeader
        title="Leads"
        description="Sales pursuits moving through the pipeline — assignment, callbacks and next actions in one place."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link
          href="/crm/leads"
          className={cn(
            "rounded-full border px-3 py-1 text-xs",
            !status && !unassigned
              ? "border-primary bg-accent text-accent-foreground"
              : "border-border text-muted-foreground hover:border-ring/50",
          )}
        >
          All
        </Link>
        {LEAD_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/crm/leads?status=${s}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              status === s
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:border-ring/50",
            )}
          >
            {formatStage(s)}
          </Link>
        ))}
        <Link
          href="/crm/leads?unassigned=1"
          className={cn(
            "rounded-full border px-3 py-1 text-xs",
            unassigned
              ? "border-primary bg-accent text-accent-foreground"
              : "border-border text-muted-foreground hover:border-ring/50",
          )}
        >
          Unassigned
        </Link>
      </div>

      {canCreate ? (
        <form
          action={createLeadAction}
          className="mb-6 grid grid-cols-2 gap-2 rounded-lg border border-border p-4 md:grid-cols-5"
        >
          <Input name="fullName" placeholder="Full name *" required maxLength={200} />
          <Input name="companyName" placeholder="Company" maxLength={200} />
          <Input name="phone" placeholder="Phone" maxLength={40} />
          <Input name="email" placeholder="Email" type="email" maxLength={200} />
          <div className="flex gap-2">
            <Input name="source" placeholder="Source" maxLength={100} />
            <Button type="submit" variant="outline">
              Add lead
            </Button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5">Lead</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Phone</th>
              <th className="px-4 py-2.5">Next action</th>
              <th className="px-4 py-2.5">Assignee</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No leads match this view.
                </td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr key={lead.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/crm/leads/${lead.id}`} className="font-medium hover:underline">
                      {lead.fullName}
                    </Link>
                    {lead.companyName ? (
                      <span className="ml-2 text-muted-foreground">{lead.companyName}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline">{formatStage(lead.status)}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {lead.phoneNormalized ?? lead.phone ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {formatDateTime(lead.nextActionAt)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {lead.assignee?.user.name ?? "Unassigned"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
