"use client";

import { useTransition } from "react";
import { Bot, UserCheck, ShieldCheck } from "lucide-react";
import type { ChannelType, ConsentStatus, ConversationHandling } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { channelLabel, consentStatusLabel, consentStatusVariant, handlingLabel } from "@/lib/labels";
import {
  takeOverAction,
  releaseToAiAction,
  setConsentAction,
  type ActionResult,
} from "@/app/[workspace]/inbox/actions";

/**
 * MediaSync conversation controls: human takeover and per-channel consent.
 * The communication layer surfaced inline on the conversation.
 */
export function MediaSyncPanel({
  slug,
  conversationId,
  customerId,
  channelType,
  handling,
  consent,
  canReply,
  canManageMessaging,
}: {
  slug: string;
  conversationId: string;
  customerId: string | null;
  channelType: ChannelType;
  handling: ConversationHandling;
  consent: ConsentStatus;
  canReply: boolean;
  canManageMessaging: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<ActionResult>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) alert(res.error);
    });
  }

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="size-3.5" /> MediaSync
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
        {/* Handling / human takeover */}
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {handling === "ai" ? (
              <Bot className="size-3.5" />
            ) : (
              <UserCheck className="size-3.5" />
            )}
            {handlingLabel[handling]}
          </span>
          {canReply &&
            (handling === "ai" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(() => takeOverAction(slug, conversationId))}
              >
                Take over
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => releaseToAiAction(slug, conversationId))}
              >
                Hand to AI
              </Button>
            ))}
        </div>

        {/* Consent for this channel */}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{channelLabel[channelType]} consent</div>
            <Badge variant={consentStatusVariant[consent]}>{consentStatusLabel[consent]}</Badge>
          </div>
          {canManageMessaging && customerId && (
            <select
              value={consent}
              disabled={pending}
              onChange={(e) =>
                run(() =>
                  setConsentAction(
                    slug,
                    conversationId,
                    customerId,
                    channelType,
                    e.target.value as ConsentStatus,
                  ),
                )
              }
              className="h-8 rounded-md border border-border bg-background px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="unknown">Unknown</option>
              <option value="opted_in">Opted in</option>
              <option value="opted_out">Opted out</option>
            </select>
          )}
        </div>
      </div>
    </section>
  );
}
