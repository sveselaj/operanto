"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Share2, Loader2 } from "lucide-react";
import type { IntegrationStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { integrationStatusVariant } from "@/lib/labels";
import { pushToCrmAction } from "@/app/[workspace]/opportunities/ops-actions";

/** Push the opportunity (contact + deal) to the CRM via the Integration Hub. */
export function PushToCrmButton({
  slug,
  opportunityId,
  last,
}: {
  slug: string;
  opportunityId: string;
  last: { provider: string; status: IntegrationStatus } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await pushToCrmAction(slug, opportunityId);
            if (res.ok) router.refresh();
            else alert(res.error);
          })
        }
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
        Push to CRM
      </Button>
      {last && (
        <Badge variant={integrationStatusVariant[last.status]}>
          {last.provider}: {last.status}
        </Badge>
      )}
    </div>
  );
}
