/**
 * Operanto Voice contracts (OI-2: interfaces ONLY — no telephony is
 * implemented in this phase). Future Operanto Voice implements these; the CRM
 * consumes them through the same seams human calling uses today
 * (`startCall` → `recordCallOutcome`). See docs/OPERANTO_CRM_INTEGRATION.md §16.
 */

/** One live or completed voice interaction, as reported by a voice provider. */
export interface VoiceSessionRef {
  /** Provider-scoped session id (opaque; never a CRM primary key). */
  providerSessionId: string;
  provider: string;
  direction: "INBOUND" | "OUTBOUND";
  /** E.164 where known; raw otherwise. */
  remoteNumber: string;
  startedAt: Date;
  endedAt?: Date;
  durationSeconds?: number;
}

/**
 * Executes calls. The CRM's MicroSIP providers (`call-provider.ts`) satisfy the
 * launch-only subset today; a live voice provider additionally reports events.
 */
export interface VoiceProvider {
  readonly id: string;
  readonly displayName: string;
  /** Start an outbound call to the given dial target. */
  startCall(input: { dialTarget: string; sessionHint?: string }): Promise<VoiceSessionRef>;
  /** End an active session (best effort). */
  endCall(providerSessionId: string): Promise<void>;
  /** True when the provider pushes session lifecycle events. */
  readonly supportsCallEvents: boolean;
}

/** Supplies transcripts for completed sessions. Content is untrusted data. */
export interface TranscriptProvider {
  readonly id: string;
  getTranscript(session: VoiceSessionRef): Promise<{
    language: string;
    segments: Array<{
      speaker: "CUSTOMER" | "AGENT" | "AI" | "UNKNOWN";
      text: string;
      startMs: number;
      endMs: number;
    }>;
  } | null>;
}

/**
 * Supplies recording references. Consent and retention are governed by the
 * platform consent model — a recording reference must never outlive the
 * erasure/retention rules of its session's customer.
 */
export interface RecordingProvider {
  readonly id: string;
  getRecording(session: VoiceSessionRef): Promise<{
    /** Storage reference (opaque key), never a public URL. */
    storageRef: string;
    mimeType: string;
    durationSeconds: number;
  } | null>;
}
