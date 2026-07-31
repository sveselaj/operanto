"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { acceptInvitation } from "@/lib/services/members";
import { clientIp, identifierKey, rateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";

export async function acceptInvitationAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const ip = clientIp(await headers());
  const limit = await rateLimit(
    `invite:ip:${identifierKey(ip)}`,
    10,
    15 * 60_000,
    { sensitive: true },
  );
  if (limit.backend === "denied-fail-closed") {
    // Shared backend down: refuse rather than degrade, with a message that
    // says nothing about whether this invitation exists.
    return "This service is temporarily unavailable. Please try again shortly.";
  }
  if (!limit.allowed) return "Too many attempts. Try again later.";

  const parsed = z
    .object({
      token: z.string().min(10),
      name: z.string().min(1).max(120),
      password: z.string().min(1).max(128),
    })
    .safeParse({
      token: formData.get("token"),
      name: formData.get("name"),
      password: formData.get("password"),
    });
  if (!parsed.success) return "Please fill in all fields.";

  try {
    await acceptInvitation(parsed.data);
  } catch (error) {
    return error instanceof Error ? error.message : "Could not accept invitation.";
  }
  redirect("/login?invited=1");
}
