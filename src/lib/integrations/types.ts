/**
 * Integration Hub connector contract. An IntegrationConnector executes a single
 * operation against an external system (CRM/ERP/calendar) and reports the
 * outcome. The service wraps it with idempotency + retry (IntegrationAction),
 * mirroring the MediaSync SyncJob pattern.
 */

export type ExecResult = {
  ok: boolean;
  externalId?: string | null;
  response?: unknown;
  error?: string | null;
};

export interface IntegrationConnector {
  readonly provider: string;
  isConfigured(): boolean;
  execute(operation: string, payload: unknown): Promise<ExecResult>;
}
