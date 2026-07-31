import "server-only";

/**
 * Outbound email — the single provider boundary.
 *
 * With RESEND_API_KEY + EMAIL_FROM configured, mail goes through the Resend
 * REST API (no SDK dependency). Without them, delivery is reported as NOT
 * delivered and the message is written to the server log so a controlled
 * staging environment can still onboard people by hand.
 *
 * Invitation links are secrets. The dev-log fallback is gated on
 * NODE_ENV !== "production" precisely so that a misconfigured production
 * deployment fails loudly instead of printing usable invitation URLs into a
 * log aggregator.
 */

export type MailResult =
  | { delivered: true; providerId?: string }
  | { delivered: false; reason: string; previewUrl?: string };

type Mail = { to: string; subject: string; text: string };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

async function send(mail: Mail): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      // Never print a live invitation link to production logs.
      return {
        delivered: false,
        reason: "Email provider is not configured in this environment",
      };
    }
    console.info(`[email:dev] To: ${mail.to} — ${mail.subject}\n${mail.text}`);
    return { delivered: false, reason: "Email provider not configured (logged)" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Body may echo the request; keep only the status.
      return { delivered: false, reason: `Provider rejected the message (${res.status})` };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { delivered: true, providerId: body.id };
  } catch (error) {
    return {
      delivered: false,
      reason:
        error instanceof Error ? `Provider unreachable: ${error.name}` : "Provider unreachable",
    };
  }
}

/**
 * Deliver an invitation. The raw token is used ONLY to build the outgoing
 * link — it is never stored (only its hash is) and never logged in
 * production. Callers record the returned result so a failed send is not
 * mistaken for a delivered one.
 */
export async function deliverInvitation(input: {
  to: string;
  organisationName: string;
  role: string;
  /** Raw token — used to construct the link and then discarded. */
  acceptUrl: string;
  expiresAt: Date;
}): Promise<MailResult> {
  const expires = input.expiresAt.toISOString().slice(0, 10);
  const text = [
    `You have been invited to join ${input.organisationName} on Operanto.`,
    "",
    `Role: ${input.role}`,
    "",
    "Accept your invitation and set a password:",
    input.acceptUrl,
    "",
    `This link is valid until ${expires} and can be used once.`,
    "If you did not expect this invitation, you can ignore this message.",
    "",
    "— Operanto",
    "https://operanto.ai",
  ].join("\n");

  const result = await send({
    to: input.to,
    subject: `Join ${input.organisationName} on Operanto`,
    text,
  });

  // Development preview: surfaces the link to the administrator's screen
  // rather than only the log, and only outside production.
  if (!result.delivered && process.env.NODE_ENV !== "production") {
    return { ...result, previewUrl: input.acceptUrl };
  }
  return result;
}
