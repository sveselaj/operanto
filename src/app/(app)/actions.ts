"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { listMyOrganisations, ORG_COOKIE } from "@/lib/org-context";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function switchOrganisationAction(formData: FormData) {
  const organisationId = String(formData.get("organisationId") ?? "");
  // The cookie only selects among memberships verified ACTIVE on each request;
  // still, validate here so the cookie never holds a foreign org id.
  const memberships = await listMyOrganisations();
  if (!memberships.some((m) => m.organisationId === organisationId)) {
    redirect("/dashboard");
  }
  (await cookies()).set(ORG_COOKIE, organisationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  redirect("/dashboard");
}
