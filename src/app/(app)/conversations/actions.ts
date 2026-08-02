"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ConversationPriority } from "@prisma/client";
import { requireOrg } from "@/lib/org-context";
import {
  CONVERSATION_PRIORITIES,
  createManualConversation,
} from "@/lib/services/conversations";

export type CreateConversationResult = { error: string } | null;

export async function createConversationAction(
  _prev: CreateConversationResult,
  formData: FormData,
): Promise<CreateConversationResult> {
  const ctx = await requireOrg();

  const priorityRaw = String(formData.get("priority") ?? "");
  const priority = CONVERSATION_PRIORITIES.find((p) => p === priorityRaw);

  let conversationId: string;
  try {
    const conversation = await createManualConversation(ctx, {
      subject: String(formData.get("subject") ?? ""),
      customerId: String(formData.get("customerId") ?? "") || undefined,
      counterpartName: String(formData.get("counterpartName") ?? ""),
      priority: priority as ConversationPriority | undefined,
      assignedMembershipId:
        String(formData.get("assignedMembershipId") ?? "") || undefined,
      initialMessage: String(formData.get("initialMessage") ?? ""),
    });
    conversationId = conversation.id;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not create the conversation",
    };
  }
  revalidatePath("/conversations");
  redirect(`/conversations/${conversationId}`);
}
