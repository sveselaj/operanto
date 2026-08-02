import type { Metadata } from "next";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { listLinkableCustomers } from "@/lib/services/conversations";
import { listAssignableMembers } from "@/lib/services/opportunities";
import { PageHeader } from "@/components/app/page-header";
import { NewConversationForm } from "./new-conversation-form";

export const metadata: Metadata = { title: "New conversation" };

export default async function NewConversationPage() {
  const ctx = await requireOrg();
  const canLink = can(ctx.membership.role, "conversations:link_customer");
  const canAssign = can(ctx.membership.role, "conversations:assign");

  const [customers, members] = await Promise.all([
    canLink ? listLinkableCustomers(ctx) : Promise.resolve([]),
    canAssign ? listAssignableMembers(ctx) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="New conversation"
        description="Record a conversation that started outside a connected channel."
      />
      <div className="max-w-xl rounded-lg border border-border bg-card p-5">
        <NewConversationForm
          customers={customers.map((c) => ({
            id: c.id,
            label: c.name ?? c.email ?? c.id,
          }))}
          members={members.map((m) => ({ id: m.id, label: m.user.name }))}
          selfMembershipId={ctx.membership.id}
          canAssign={canAssign}
        />
      </div>
    </>
  );
}
