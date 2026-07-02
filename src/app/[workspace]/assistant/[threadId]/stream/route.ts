import type { NextRequest } from "next/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { runAssistantTurn, type TurnEvent } from "@/lib/services/assistant";

/**
 * Streams one assistant turn as newline-delimited JSON (`TurnEvent` per line):
 * the user echo, each tool/approval card as it completes, the reply text in
 * chunks, then `done`. The turn is fully persisted regardless of streaming.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string; threadId: string }> },
) {
  const { workspace: slug, threadId } = await ctx.params;
  const wctx = await getWorkspaceContext(slug);
  if (!wctx) return new Response("Unauthorized", { status: 401 });

  let text = "";
  try {
    const body = await req.json();
    if (typeof body?.text === "string") text = body.text;
  } catch {
    // fall through to empty-check
  }
  if (!text.trim()) return new Response("Empty message", { status: 400 });

  const encoder = new TextEncoder();
  const write = (controller: ReadableStreamDefaultController<Uint8Array>, ev: TurnEvent | { type: "block"; block: unknown }) =>
    controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of runAssistantTurn(wctx, threadId, text, { stream: true })) {
          write(controller, ev);
        }
      } catch (err) {
        write(controller, {
          type: "block",
          block: {
            type: "error",
            code: "turn_failed",
            message: err instanceof Error ? err.message : "Turn failed",
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
