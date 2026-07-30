import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { hashInvitationToken } from "@/lib/invitations";
import { AcceptInvitationForm } from "./accept-form";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function InvitePage({
  params,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: { organisation: { select: { name: true } } },
  });

  const valid =
    invitation && !invitation.acceptedAt && invitation.expiresAt > new Date();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center text-xl font-semibold tracking-tight">
          Operanto
        </Link>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          {valid ? (
            <>
              <h1 className="mb-1 text-lg font-semibold">
                Join {invitation.organisation.name}
              </h1>
              <p className="mb-6 text-sm text-muted-foreground">
                You are joining as <span className="font-medium">{invitation.role}</span>{" "}
                with the email <span className="font-medium">{invitation.email}</span>.
              </p>
              <AcceptInvitationForm token={token} />
            </>
          ) : (
            <>
              <h1 className="mb-1 text-lg font-semibold">Invitation not valid</h1>
              <p className="text-sm text-muted-foreground">
                This invitation link has expired or was already used. Ask your
                administrator to send a new one.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
