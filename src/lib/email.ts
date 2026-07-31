import "server-only";

/**
 * Email delivery. With RESEND_API_KEY configured, sends through the Resend
 * REST API (no SDK dependency). Otherwise logs a redacted notice plus the
 * action URL to the server console — acceptable for development only.
 */

type Mail = { to: string; subject: string; text: string };

export async function sendMail(mail: Mail): Promise<{ delivered: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.info(
      `[email:dev] To: ${mail.to} — ${mail.subject}\n${mail.text}`,
    );
    return { delivered: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Email delivery failed (${res.status})`);
  }
  return { delivered: true };
}
