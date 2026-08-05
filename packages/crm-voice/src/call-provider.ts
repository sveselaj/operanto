/**
 * Provider-neutral call launching (docs/PHASE2_1_DESIGN.md §2/§3).
 *
 * Business logic never references MicroSIP directly — it talks to the
 * CallProvider interface; the organization's `callProviderId` picks the
 * implementation. URI providers launch through the OS protocol handler
 * (MicroSIP registers for tel:/sip:) and expose NO call events: durations and
 * outcomes are manually entered and labeled as such.
 */

export interface DialTarget {
  /** Protocol URI the client launches, or null when not launchable. */
  href: string | null;
  /** Number shown to the agent (E.164). */
  displayNumber: string;
  /** Fallback copy value (E.164) — secondary to the call button. */
  copyValue: string;
  launchable: boolean;
}

export interface CallProvider {
  id: string;
  label: string;
  prepareDialTarget(e164: string): DialTarget;
  supportsAutomaticLaunch(): boolean;
  supportsCallEvents(): boolean;
  getDisplayStatus(): "manual_outcome" | "provider_events";
}

class UriCallProvider implements CallProvider {
  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly scheme: "tel" | "sip"
  ) {}

  prepareDialTarget(e164: string): DialTarget {
    return {
      href: `${this.scheme}:${e164}`,
      displayNumber: e164,
      copyValue: e164,
      launchable: true,
    };
  }

  supportsAutomaticLaunch(): boolean {
    return true;
  }

  /** URI handoff — the CRM cannot observe whether the call connected. */
  supportsCallEvents(): boolean {
    return false;
  }

  getDisplayStatus(): "manual_outcome" {
    return "manual_outcome";
  }
}

/** MicroSIP via the OS tel: handler (safest; works with any softphone). */
export const MicroSipCallProvider: CallProvider = new UriCallProvider(
  "microsip-tel",
  "MicroSIP (tel:)",
  "tel"
);

const PROVIDERS: Record<string, CallProvider> = {
  "microsip-tel": MicroSipCallProvider,
  "microsip-sip": new UriCallProvider("microsip-sip", "MicroSIP (sip:)", "sip"),
  // Future: 3CX, Asterisk, Placetel, Aircall, Twilio, generic SIP — same interface.
};

export function getCallProvider(callProviderId: string): CallProvider {
  return PROVIDERS[callProviderId] ?? MicroSipCallProvider;
}
