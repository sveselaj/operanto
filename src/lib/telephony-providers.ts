/**
 * Telephony provider catalog (OI voice settings slice).
 *
 * Pure metadata consumed by BOTH the settings form (client) and the
 * connection service (server): which credentials each provider needs and
 * where its admin finds them. Adding a provider here makes it configurable;
 * actual call/webhook behavior additionally needs an adapter implementing
 * the `@operanto/crm-voice` contracts (none ship in this slice — connections
 * are stored, verified-on-connect later, and consumed by the calling slice).
 *
 * Credential shapes reflect each provider's own API conventions. The form
 * renders exactly the fields listed; the service validates the same list —
 * one source of truth, no provider-specific forms.
 */

export interface TelephonyCredentialField {
  /** Storage slot: apiKey/apiSecret are encrypted at rest; accountRef is not secret. */
  key: "apiKey" | "apiSecret" | "accountRef";
  label: string;
  secret: boolean;
  placeholder?: string;
}

export interface TelephonyProviderSpec {
  id: string;
  label: string;
  fields: TelephonyCredentialField[];
  /** Where the provider's admin generates these credentials. */
  credentialsHint: string;
  /** Whether the provider can push call events to a webhook we host. */
  supportsWebhooks: boolean;
}

export const TELEPHONY_PROVIDERS: TelephonyProviderSpec[] = [
  {
    id: "cloudtalk",
    label: "CloudTalk",
    fields: [
      { key: "apiKey", label: "API Key ID", secret: true },
      { key: "apiSecret", label: "API Secret", secret: true },
    ],
    credentialsHint: "CloudTalk Dashboard → Settings → API → Add API key",
    supportsWebhooks: true,
  },
  {
    id: "aircall",
    label: "Aircall",
    fields: [
      { key: "apiKey", label: "API ID", secret: true },
      { key: "apiSecret", label: "API Token", secret: true },
    ],
    credentialsHint: "Aircall Dashboard → Integrations & API → API keys",
    supportsWebhooks: true,
  },
  {
    id: "justcall",
    label: "JustCall",
    fields: [
      { key: "apiKey", label: "API Key", secret: true },
      { key: "apiSecret", label: "API Secret", secret: true },
    ],
    credentialsHint: "JustCall → Settings → Developers → API keys",
    supportsWebhooks: true,
  },
  {
    id: "ringover",
    label: "Ringover",
    fields: [{ key: "apiKey", label: "API Key", secret: true }],
    credentialsHint: "Ringover Dashboard → Developer → API keys",
    supportsWebhooks: true,
  },
  {
    id: "sipgate",
    label: "sipgate",
    fields: [
      { key: "apiKey", label: "Token ID", secret: true },
      { key: "apiSecret", label: "Token", secret: true },
    ],
    credentialsHint: "sipgate → Account → Personal access tokens",
    supportsWebhooks: true,
  },
  {
    id: "placetel",
    label: "Placetel",
    fields: [{ key: "apiKey", label: "API Token", secret: true }],
    credentialsHint: "Placetel Web → Integrations → Web API token",
    supportsWebhooks: true,
  },
  {
    id: "twilio",
    label: "Twilio",
    fields: [
      { key: "accountRef", label: "Account SID", secret: false, placeholder: "AC…" },
      { key: "apiSecret", label: "Auth Token", secret: true },
    ],
    credentialsHint: "Twilio Console → Account → API keys & tokens",
    supportsWebhooks: true,
  },
  {
    id: "threecx",
    label: "3CX",
    fields: [
      { key: "apiKey", label: "Client ID", secret: true },
      { key: "apiSecret", label: "Client Secret", secret: true },
    ],
    credentialsHint: "3CX Admin Console → Integrations → API (V20+)",
    supportsWebhooks: true,
  },
  {
    id: "other",
    label: "Other / generic",
    fields: [
      { key: "apiKey", label: "API key or token", secret: true },
      { key: "accountRef", label: "Account reference (optional)", secret: false },
    ],
    credentialsHint:
      "Any system with an HTTP API. The adapter is built once the provider is confirmed.",
    supportsWebhooks: false,
  },
];

export function telephonyProvider(id: string): TelephonyProviderSpec | undefined {
  return TELEPHONY_PROVIDERS.find((p) => p.id === id);
}
