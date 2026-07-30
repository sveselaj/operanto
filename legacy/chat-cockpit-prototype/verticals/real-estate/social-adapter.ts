import "server-only";

/**
 * Social publishing adapter.
 *
 * There is NO real Instagram/TikTok integration — publishing to those platforms
 * requires OAuth apps, review, and secrets Operanto does not hold. This mock
 * adapter records a queued job so the approval → queue → history flow is real
 * end-to-end, while being explicit that nothing leaves the system. A real
 * adapter would live behind `OPERANTO_SOCIAL_LIVE=1` + per-channel credentials
 * and is intentionally left as a `not configured` error.
 */
export type QueueSocialInput = {
  channel: string;
  content: string;
  scheduledAt: Date;
};

export type QueueSocialResult = {
  adapter: string;
  externalRef: string;
  status: "queued";
};

export async function queueSocialPost(input: QueueSocialInput): Promise<QueueSocialResult> {
  if (process.env.OPERANTO_SOCIAL_LIVE === "1") {
    // A real connector would authenticate and enqueue here.
    throw new Error(
      `Live ${input.channel} publishing is not configured (no channel credentials).`,
    );
  }
  const ref = `mock_${input.channel}_${Math.abs(hash(input.content + input.scheduledAt.toISOString()))
    .toString(36)
    .slice(0, 10)}`;
  return { adapter: "mock", externalRef: ref, status: "queued" };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}
