"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { channelLabel } from "@/lib/labels";
import type { ChannelType } from "@prisma/client";
import {
  setChannelCredentialsAction,
  type ActionResult,
} from "@/app/[workspace]/settings/actions";

type State = {
  channelAccountId: string;
  name: string;
  type: string;
  configured: boolean;
  hasToken: boolean;
  externalAccountId: string | null;
};

const REF_LABEL: Record<string, string> = {
  whatsapp: "Phone number ID",
  facebook: "Page ID",
  instagram: "IG user ID",
  sms: "Sender ID",
  viber: "Sender ID",
  telegram: "Bot id (optional)",
};

/** Per-channel credential entry. Tokens are write-only — never read back. */
export function ChannelCredentialsManager({
  slug,
  channels,
}: {
  slug: string;
  channels: State[];
}) {
  if (channels.length === 0) {
    return <p className="text-sm text-muted-foreground">No channels connected yet.</p>;
  }
  return (
    <div className="space-y-3">
      {channels.map((c) => (
        <CredentialRow key={c.channelAccountId} slug={slug} channel={c} />
      ))}
      <p className="text-xs text-muted-foreground">
        App-level secrets (Meta app secret, verify tokens, Infobip key, Telegram bot token) come
        from environment variables — see <span className="font-mono">.env.example</span>. Access
        tokens entered here are encrypted at rest and never shown again.
      </p>
    </div>
  );
}

function CredentialRow({ slug, channel }: { slug: string; channel: State }) {
  const [token, setToken] = useState("");
  const [ref, setRef] = useState(channel.externalAccountId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const isProvider = !["webchat", "manual", "email"].includes(channel.type);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res: ActionResult = await setChannelCredentialsAction(slug, channel.channelAccountId, {
        accessToken: token || undefined,
        externalAccountId: ref,
      });
      if (res.ok) {
        setToken("");
        setSaved(true);
      } else setError(res.error);
    });
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{channel.name}</span>
          <Badge variant="default">{channelLabel[channel.type as ChannelType]}</Badge>
          {channel.configured ? (
            <Badge variant="success">Configured</Badge>
          ) : (
            <Badge variant="warning">Needs credentials</Badge>
          )}
        </div>
        {channel.hasToken && <span className="text-[11px] text-muted-foreground">token stored</span>}
      </div>

      {isProvider && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            {REF_LABEL[channel.type] ?? "Account ID"}
            <Input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder=""
              className="mt-1 h-8 w-44"
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Access token {channel.hasToken && "(leave blank to keep)"}
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="••••••••"
              className="mt-1 h-8 w-56"
            />
          </label>
          <Button size="sm" variant="outline" onClick={save} disabled={pending}>
            <KeyRound className="size-3.5" /> Save
          </Button>
          {saved && <span className="text-xs text-success">Saved.</span>}
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      )}
    </div>
  );
}
