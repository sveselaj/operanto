import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { can } from "@/lib/rbac";
import { listMembers, listPendingInvitations } from "@/lib/services/members";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { InviteForm } from "./invite-form";
import {
  changeRoleAction,
  revokeSessionsAction,
  setMemberStatusAction,
} from "./actions";

export const metadata: Metadata = { title: "Users" };

const ROLES = ["ADMIN", "SUPERVISOR", "OPERATOR"] as const;

export default async function UsersSettingsPage() {
  const ctx = await requireOrg();
  if (!can(ctx.membership.role, "members:manage")) redirect("/dashboard");

  const [members, invitations] = await Promise.all([
    listMembers(ctx),
    listPendingInvitations(ctx),
  ]);

  return (
    <>
      <PageHeader
        title="Users"
        description="Invitation-only onboarding. Roles apply per organisation."
      >
        <nav className="flex gap-2 text-sm">
          <Link href="/settings/organisation" className="text-primary hover:underline">
            Organisation
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link href="/settings/security" className="text-primary hover:underline">
            Security
          </Link>
        </nav>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Member</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Last login</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="py-2.5 pr-3">
                      <p className="font-medium">{member.user.name}</p>
                      <p className="text-xs text-muted-foreground">{member.user.email}</p>
                    </td>
                    <td className="py-2.5 pr-3">
                      <form action={changeRoleAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="membershipId" value={member.id} />
                        <select
                          name="role"
                          defaultValue={member.role}
                          className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"
                          aria-label="Role"
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" variant="outline" size="sm">
                          Set
                        </Button>
                      </form>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge
                        variant={member.status === "ACTIVE" ? "default" : "danger"}
                      >
                        {member.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {formatDateTime(member.user.lastLoginAt)}
                    </td>
                    <td className="py-2.5">
                      <div className="flex gap-1.5">
                        <form action={setMemberStatusAction}>
                          <input type="hidden" name="membershipId" value={member.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"}
                          />
                          <Button type="submit" variant="outline" size="sm">
                            {member.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                          </Button>
                        </form>
                        <form action={revokeSessionsAction}>
                          <input type="hidden" name="membershipId" value={member.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Revoke sessions
                          </Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invite a member</CardTitle>
            </CardHeader>
            <CardContent>
              <InviteForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pending invitations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {invitations.length === 0 ? (
                <p className="text-muted-foreground">None outstanding.</p>
              ) : (
                invitations.map((invitation) => (
                  <div key={invitation.id} className="flex justify-between gap-2">
                    <span className="truncate">{invitation.email}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {invitation.role} · expires {formatDateTime(invitation.expiresAt)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
