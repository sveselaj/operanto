/**
 * MediaSync — Operanto's embedded communication layer.
 *
 * MediaSync is a subsystem *inside* Operanto (not a separate product). It owns
 * everything between the customer's channel and Operanto's vertical workflow:
 *
 *   channel connectors · unified inbox intake · customer identity resolution
 *   delivery status · consent / opt-out · reusable templates
 *   webhook intake (idempotency + replay) · connector sync/observability
 *   human takeover · diagnostics
 *
 * The vertical AI qualification + workflow engine sits on top of this layer and
 * treats it as the source of truth for "what was said, by whom, on which
 * channel, and was it delivered". See docs/MEDIASYNC.md.
 *
 * Connector abstraction lives in `@/lib/channels`; it is re-exported here so the
 * module has a single public surface.
 */

export * from "@/lib/channels";

export { normalizePhone, samePhone } from "./phone";
export { detectConsentSignal, type ConsentSignal } from "./consent-keywords";
export {
  extractTemplateVariables,
  renderTemplate,
  type RenderResult,
} from "./templates-render";
export {
  rateLimit,
  resetRateLimits,
  type RateLimitOptions,
  type RateLimitResult,
} from "./rate-limit";

export {
  findMatchingCustomer,
  resolveCustomer,
  mergeCustomers,
  type IdentityCandidate,
  type ResolveOptions,
} from "./identity";
export {
  getConsent,
  listConsentForCustomer,
  canSend,
  setConsent,
  applyInboundConsentSignal,
  type SendGate,
} from "./consent";
export { applyStatusUpdate, setMessageStatus, shouldAdvance } from "./delivery";
export {
  recordWebhookEvent,
  markWebhookEvent,
  type RecordWebhookInput,
  type RecordWebhookResult,
} from "./webhook-events";
export {
  startSyncJob,
  finishSyncJob,
  withSyncJob,
  listSyncJobs,
  type StartSyncInput,
  type FinishSyncInput,
} from "./sync";
export {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  setTemplateStatus,
  deleteTemplate,
  renderTemplateById,
  type TemplateInput,
} from "./templates";
export { takeOver, releaseToAi } from "./takeover";
export {
  runDiagnostic,
  channelDiagnostics,
  type DiagnosticResult,
  type ChannelDiagnostic,
} from "./diagnostics";
