/**
 * Voice/telephony feature flag — server-side only, environment-controlled,
 * default off, exactly like the Growth and CRM flags. Gates the telephony
 * connection settings today and the calling/webhook slices later.
 */
export function voiceEnabled(): boolean {
  return process.env.OPERANTO_VOICE_ENABLED === "1";
}
