import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Security" };

export default async function SecuritySettingsPage() {
  const ctx = await requireOrg();

  return (
    <>
      <PageHeader title="Security" description="Your account security.">
        <nav className="flex gap-2 text-sm">
          <Link href="/settings/organisation" className="text-primary hover:underline">
            Organisation
          </Link>
          <span className="text-muted-foreground">·</span>
          <Link href="/settings/users" className="text-primary hover:underline">
            Users
          </Link>
        </nav>
      </PageHeader>

      <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Changing your password signs out every session, including this
              one.
            </p>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Security model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Signed in as <span className="text-foreground">{ctx.user.email}</span>{" "}
              ({ctx.membership.role} in {ctx.organisation.name}).
            </p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Access is invitation-only; there is no self-registration.</li>
              <li>
                Roles and membership status are re-read from the database on
                every request — suspension takes effect immediately.
              </li>
              <li>
                Administrators can revoke sessions instantly from the Users
                page.
              </li>
              <li>All sensitive actions are recorded in the audit log.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
