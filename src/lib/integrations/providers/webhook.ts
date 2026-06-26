import type { ExecResult, IntegrationConnector } from "../types";

/**
 * Generic outbound-webhook connector — the zero-setup ERP fallback. If
 * INTEGRATION_WEBHOOK_URL is set, it POSTs the payload there; otherwise it
 * simulates a successful delivery (so the Integration Hub is demoable without
 * any external endpoint, the same way demo channels work).
 */
export class WebhookConnector implements IntegrationConnector {
  readonly provider = "webhook";

  isConfigured(): boolean {
    return true; // always usable (real endpoint or simulated)
  }

  async execute(operation: string, payload: unknown): Promise<ExecResult> {
    const url = process.env.INTEGRATION_WEBHOOK_URL;
    if (!url) {
      return { ok: true, externalId: null, response: { simulated: true, operation } };
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation, payload }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) return { ok: false, error: `Webhook ${res.status}: ${text.slice(0, 200)}` };
      return { ok: true, externalId: null, response: { status: res.status } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Webhook request failed" };
    }
  }
}
