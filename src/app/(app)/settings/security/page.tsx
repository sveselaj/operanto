import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "./change-password-form";
import { TwoFactorPanel } from "./two-factor-panel";
import {
  roleRequiresTwoFactor,
  twoFactorStatus,
} from "@/lib/services/two-factor";

export const metadata: Metadata = { title: "Security" };

export default async function SecuritySettingsPage() {
  const ctx = await requireOrg();
  const status = await twoFactorStatus(ctx.user.id);
  const required = roleRequiresTwoFactor(ctx.membership.role);

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
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Two-factor authentication
              {required ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  required for {ctx.membership.role}
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TwoFactorPanel
              active={status.active}
              required={required}
              recoveryCodesRemaining={status.recoveryCodesRemaining}
            />
          </CardContent>
        </Card>

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
              <li>
                Administrators and supervisors must use two-factor
                authentication; they can read every customer in the
                organisation.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
