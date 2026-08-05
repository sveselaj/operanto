/**
 * Voice RUNTIME flag - reserved for the adapter slice (dialing, webhook
 * ingestion). Connection SETTINGS are deliberately not gated by it: admins
 * manage them entirely in the app. Server-side only, default off.
 */
export function voiceEnabled(): boolean {
  return process.env.OPERANTO_VOICE_ENABLED === "1";
}
