/**
 * Operanto seed — realistic demo data for the launch niche
 * (beauty/aesthetics + boutique ecommerce on Instagram/WhatsApp).
 *
 * Idempotent: wipes tenant data and recreates it. All demo accounts use the
 * password "operanto".
 */
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PASSWORD = "operanto";
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const daysAhead = (d: number) => new Date(Date.now() + d * 86_400_000);

async function main() {
  console.log("Seeding Operanto…");

  // ── Clean (child → parent) ────────────────────────────────
  await prisma.auditLog.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.syncJob.deleteMany();
  await prisma.consent.deleteMany();
  await prisma.automation.deleteMany();
  await prisma.qAReview.deleteMany();
  await prisma.aIAction.deleteMany();
  await prisma.contentDraft.deleteMany();
  await prisma.insight.deleteMany();
  await prisma.brandVoice.deleteMany();
  await prisma.task.deleteMany();
  await prisma.sOP.deleteMany();
  await prisma.internalNote.deleteMany();
  await prisma.conversationTag.deleteMany();
  await prisma.message.deleteMany();
  await prisma.messageTemplate.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.channelAccount.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();

  const hash = await bcrypt.hash(PASSWORD, 10);
  const mkUser = (email: string, name: string) =>
    prisma.user.create({ data: { email, name, passwordHash: hash } });

  // ── Users ─────────────────────────────────────────────────
  const lana = await mkUser("lana@bloomstudio.test", "Lana Berisha"); // owner (salon)
  const marko = await mkUser("marko@bloomstudio.test", "Marko Ilić"); // manager
  const driton = await mkUser("driton@bloomstudio.test", "Driton Krasniqi"); // agent
  const rina = await mkUser("rina@bloomstudio.test", "Rina Hoxha"); // reviewer
  const elira = await mkUser("elira@lumeagoods.test", "Elira Gashi"); // owner (ecommerce)
  const blerim = await mkUser("blerim@lumeagoods.test", "Blerim Demiri"); // agent (both)

  // ════════════════════════════════════════════════════════════
  // Workspace 1 — Bloom Studio (beauty/aesthetics)
  // ════════════════════════════════════════════════════════════
  const bloom = await prisma.workspace.create({
    data: {
      name: "Bloom Studio",
      slug: "bloom-studio",
      plan: "pro",
      timezone: "Europe/Belgrade",
      defaultLanguage: "en",
      dataRetentionDays: 365,
      members: {
        create: [
          { userId: lana.id, role: "owner" },
          { userId: marko.id, role: "manager" },
          { userId: driton.id, role: "agent" },
          { userId: rina.id, role: "reviewer" },
        ],
      },
    },
  });

  const bloomIg = await prisma.channelAccount.create({
    data: { workspaceId: bloom.id, type: "instagram", name: "@bloomstudio", status: "connected" },
  });
  const bloomWa = await prisma.channelAccount.create({
    data: { workspaceId: bloom.id, type: "whatsapp", name: "Bloom WhatsApp", status: "connected" },
  });
  await prisma.channelAccount.create({
    data: { workspaceId: bloom.id, type: "webchat", name: "Website chat", status: "connected" },
  });

  const bloomTags = await Promise.all(
    [
      ["Pricing", "#6366f1"],
      ["Booking", "#16a34a"],
      ["Complaint", "#dc2626"],
      ["VIP", "#d97706"],
    ].map(([name, color]) =>
      prisma.tag.create({ data: { workspaceId: bloom.id, name, color } }),
    ),
  );
  const tag = (name: string) => bloomTags.find((t) => t.name === name)!;

  const brandVoiceBloom = await prisma.brandVoice.create({
    data: {
      workspaceId: bloom.id,
      name: "Bloom — warm & professional",
      description: "Friendly, reassuring, premium beauty studio tone.",
      tone: "warm, confident, concise",
      language: "en",
      dos: ["Greet by name", "Offer a clear next step", "Mention booking link"],
      donts: ["Be pushy", "Over-promise results", "Use heavy jargon"],
      examplePhrases: ["So happy you reached out!", "Let's get you booked in ✨"],
    },
  });

  // Customers + conversations
  const c1 = await prisma.customer.create({
    data: {
      workspaceId: bloom.id,
      name: "Sara Mehmeti",
      language: "en",
      socialHandles: { instagram: "@sara.m" } as Prisma.InputJsonValue,
    },
  });
  const conv1 = await prisma.conversation.create({
    data: {
      workspaceId: bloom.id,
      customerId: c1.id,
      channelAccountId: bloomIg.id,
      channelType: "instagram",
      status: "open",
      priority: "high",
      assignedToUserId: driton.id,
      handling: "ai",
      intent: "pricing_inquiry",
      sentiment: "positive",
      leadScore: 82,
      subject: "Hydrafacial pricing",
      summary: "Wants pricing for a hydrafacial; ready to book this week. Hot lead.",
      lastMessageAt: hoursAgo(1),
      lastInboundAt: hoursAgo(1),
      tags: { create: [{ tagId: tag("Pricing").id }] },
      messages: {
        create: [
          {
            workspaceId: bloom.id,
            direction: "inbound",
            senderType: "customer",
            body: "Hi! How much is a hydrafacial? Looking to book this week 😊",
            createdAt: hoursAgo(1),
          },
        ],
      },
    },
  });

  const c2 = await prisma.customer.create({
    data: {
      workspaceId: bloom.id,
      name: "Arta Krasniqi",
      language: "en",
      phone: "+383 49 111 222",
      phoneNormalized: "+38349111222",
    },
  });
  const conv2 = await prisma.conversation.create({
    data: {
      workspaceId: bloom.id,
      customerId: c2.id,
      channelAccountId: bloomWa.id,
      channelType: "whatsapp",
      status: "pending",
      priority: "urgent",
      assignedToUserId: driton.id,
      intent: "complaint",
      sentiment: "frustrated",
      leadScore: 20,
      subject: "Late for appointment",
      summary: "Upset her last appointment started 25 min late. Wants acknowledgement.",
      lastMessageAt: hoursAgo(3),
      lastInboundAt: hoursAgo(3),
      tags: { create: [{ tagId: tag("Complaint").id }] },
      messages: {
        create: [
          {
            workspaceId: bloom.id,
            direction: "inbound",
            senderType: "customer",
            body: "My appointment yesterday started 25 minutes late. Not the first time.",
            createdAt: hoursAgo(3),
          },
        ],
      },
    },
  });

  const c3 = await prisma.customer.create({
    data: { workspaceId: bloom.id, name: "Diellza Berisha", language: "en" },
  });
  await prisma.conversation.create({
    data: {
      workspaceId: bloom.id,
      customerId: c3.id,
      channelAccountId: bloomIg.id,
      channelType: "instagram",
      status: "open",
      priority: "normal",
      assignedToUserId: marko.id,
      intent: "appointment_request",
      sentiment: "happy",
      leadScore: 74,
      subject: "Saturday availability",
      summary: "Asking about Saturday availability for balayage.",
      lastMessageAt: hoursAgo(6),
      lastInboundAt: hoursAgo(6),
      tags: { create: [{ tagId: tag("Booking").id }, { tagId: tag("VIP").id }] },
      messages: {
        create: [
          {
            workspaceId: bloom.id,
            direction: "inbound",
            senderType: "customer",
            body: "Do you have any spots this Saturday for balayage?",
            createdAt: hoursAgo(6),
          },
        ],
      },
    },
  });

  const c4 = await prisma.customer.create({
    data: { workspaceId: bloom.id, name: "Nita Shala", language: "en" },
  });
  await prisma.conversation.create({
    data: {
      workspaceId: bloom.id,
      customerId: c4.id,
      channelType: "instagram",
      channelAccountId: bloomIg.id,
      status: "resolved",
      priority: "low",
      assignedToUserId: driton.id,
      intent: "service_inquiry",
      sentiment: "neutral",
      leadScore: 40,
      summary: "Asked whether you offer lash lifts. Answered — yes.",
      lastMessageAt: daysAgo(2),
      messages: {
        create: [
          {
            workspaceId: bloom.id,
            direction: "inbound",
            senderType: "customer",
            body: "Do you do lash lifts?",
            createdAt: daysAgo(2),
          },
          {
            workspaceId: bloom.id,
            direction: "outbound",
            senderType: "agent",
            senderUserId: driton.id,
            body: "We do! They're €45 and take about 45 minutes. Want me to book you in?",
            status: "read",
            statusUpdatedAt: daysAgo(2),
            createdAt: daysAgo(2),
          },
        ],
      },
    },
  });

  // MediaSync — consent (one opted-out to demo the send gate)
  await prisma.consent.createMany({
    data: [
      {
        workspaceId: bloom.id,
        customerId: c1.id,
        channelType: "instagram",
        status: "opted_in",
        source: "inbound_message",
      },
      {
        workspaceId: bloom.id,
        customerId: c2.id,
        channelType: "whatsapp",
        status: "opted_out",
        source: "keyword_stop",
        reason: "Customer replied STOP",
      },
    ],
  });

  // MediaSync — reusable outbound templates
  await prisma.messageTemplate.createMany({
    data: [
      {
        workspaceId: bloom.id,
        name: "Booking confirmation",
        channelType: "whatsapp",
        category: "utility",
        language: "en",
        body: "Hi {{name}}, your {{service}} is booked for {{date}} at {{time}}. See you soon! ✨",
        variables: ["name", "service", "date", "time"],
        status: "approved",
        createdByUserId: lana.id,
        approvedByUserId: lana.id,
      },
      {
        workspaceId: bloom.id,
        name: "Re-engagement",
        channelType: "whatsapp",
        category: "marketing",
        language: "en",
        body: "Hi {{name}}, it's been a while — want to book your next visit?",
        variables: ["name"],
        status: "draft",
        createdByUserId: marko.id,
      },
    ],
  });

  // SOPs
  const sopRefund = await prisma.sOP.create({
    data: {
      workspaceId: bloom.id,
      title: "Handling complaints about late appointments",
      description: "How to respond when a client is upset about waiting.",
      category: "Customer service",
      status: "approved",
      version: 1,
      createdByUserId: marko.id,
      approvedByUserId: lana.id,
      body: [
        "1. Acknowledge and apologize sincerely within the first reply.",
        "2. Do not make excuses; state what happened briefly.",
        "3. Offer a concrete gesture (priority booking or small discount).",
        "4. Confirm the next appointment time in writing.",
        "5. Log the incident and flag if it repeats for the same client.",
      ].join("\n"),
    },
  });
  await prisma.sOP.create({
    data: {
      workspaceId: bloom.id,
      title: "Responding to Instagram pricing inquiries",
      description: "Fast, on-brand pricing replies that drive bookings.",
      category: "Sales",
      status: "approved",
      version: 2,
      createdByUserId: lana.id,
      approvedByUserId: lana.id,
      body: [
        "1. Reply within 1 hour during business hours.",
        "2. Greet by name and thank them.",
        "3. Give the price range and what's included.",
        "4. Always end with the booking link and a soft CTA.",
      ].join("\n"),
    },
  });

  // Tasks
  await prisma.task.createMany({
    data: [
      {
        workspaceId: bloom.id,
        title: "Follow up with Sara about hydrafacial booking",
        status: "todo",
        priority: "high",
        assignedToUserId: driton.id,
        createdByUserId: marko.id,
        dueAt: daysAhead(1),
        linkedConversationId: conv1.id,
        linkedCustomerId: c1.id,
      },
      {
        workspaceId: bloom.id,
        title: "Call Arta to apologize for the late appointment",
        status: "in_progress",
        priority: "urgent",
        assignedToUserId: driton.id,
        createdByUserId: marko.id,
        dueAt: hoursAgo(2), // overdue
        linkedConversationId: conv2.id,
        linkedCustomerId: c2.id,
        linkedSopId: sopRefund.id,
      },
      {
        workspaceId: bloom.id,
        title: "Prepare weekly performance report",
        status: "todo",
        priority: "normal",
        assignedToUserId: marko.id,
        createdByUserId: lana.id,
        dueAt: daysAhead(3),
      },
    ],
  });

  // Insights
  await prisma.insight.createMany({
    data: [
      {
        workspaceId: bloom.id,
        type: "common_question",
        title: "Pricing is your #1 inbound question",
        description: "37 of this week's 143 Instagram DMs asked about price.",
        priority: "high",
        sourceData: { count: 37, channel: "instagram" } as Prisma.InputJsonValue,
      },
      {
        workspaceId: bloom.id,
        type: "performance_issue",
        title: "18 leads not followed up within 24h",
        description: "Consider an automation to create follow-up tasks automatically.",
        priority: "urgent",
      },
      {
        workspaceId: bloom.id,
        type: "content_opportunity",
        title: "Create a post explaining your pricing",
        description: "Recurring pricing questions suggest a pinned pricing post + FAQ.",
        priority: "normal",
      },
    ],
  });

  await prisma.contentDraft.create({
    data: {
      workspaceId: bloom.id,
      title: "Hydrafacial pricing explainer",
      channel: "instagram",
      status: "idea",
      brandVoiceId: brandVoiceBloom.id,
      sourceConversationId: conv1.id,
      content: "Draft: a carousel explaining what a hydrafacial includes and the price.",
      createdByUserId: lana.id,
    },
  });

  // Automations (Bloom Studio)
  await prisma.automation.createMany({
    data: [
      {
        workspaceId: bloom.id,
        name: "Tag pricing inquiries",
        trigger: "conversation_analyzed",
        enabled: true,
        conditions: [{ field: "intent", value: "pricing_inquiry" }] as Prisma.InputJsonValue,
        actions: [{ type: "add_tag", tagId: tag("Pricing").id }] as Prisma.InputJsonValue,
        createdByUserId: lana.id,
      },
      {
        workspaceId: bloom.id,
        name: "Escalate complaints",
        trigger: "conversation_analyzed",
        enabled: true,
        conditions: [{ field: "intent", value: "complaint" }] as Prisma.InputJsonValue,
        actions: [
          { type: "set_priority", priority: "urgent" },
          { type: "add_tag", tagId: tag("Complaint").id },
        ] as Prisma.InputJsonValue,
        createdByUserId: lana.id,
      },
      {
        workspaceId: bloom.id,
        name: "Follow up hot leads",
        trigger: "conversation_analyzed",
        enabled: true,
        conditions: [{ field: "leadScoreGte", value: 80 }] as Prisma.InputJsonValue,
        actions: [{ type: "create_task", title: "Follow up — hot lead" }] as Prisma.InputJsonValue,
        createdByUserId: marko.id,
      },
      {
        workspaceId: bloom.id,
        name: "Flag pricing mentions on new messages",
        trigger: "inbound_message",
        enabled: true,
        conditions: [{ field: "messageContains", value: "price" }] as Prisma.InputJsonValue,
        actions: [{ type: "add_tag", tagId: tag("Pricing").id }] as Prisma.InputJsonValue,
        createdByUserId: lana.id,
      },
    ],
  });

  // ════════════════════════════════════════════════════════════
  // Workspace 2 — Lumea Goods (boutique ecommerce)
  // ════════════════════════════════════════════════════════════
  const lumea = await prisma.workspace.create({
    data: {
      name: "Lumea Goods",
      slug: "lumea-goods",
      plan: "free",
      timezone: "Europe/Belgrade",
      defaultLanguage: "en",
      members: {
        create: [
          { userId: elira.id, role: "owner" },
          { userId: blerim.id, role: "agent" },
        ],
      },
    },
  });

  const lumeaIg = await prisma.channelAccount.create({
    data: { workspaceId: lumea.id, type: "instagram", name: "@lumeagoods", status: "connected" },
  });
  await prisma.channelAccount.create({
    data: { workspaceId: lumea.id, type: "webchat", name: "Website chat", status: "connected" },
  });

  const lumeaTag = await prisma.tag.create({
    data: { workspaceId: lumea.id, name: "Custom order", color: "#6366f1" },
  });

  await prisma.brandVoice.create({
    data: {
      workspaceId: lumea.id,
      name: "Lumea — playful & crafted",
      tone: "playful, artisanal, personal",
      language: "en",
      dos: ["Celebrate craft", "Ask for a reference photo", "Confirm timelines"],
      donts: ["Sound corporate", "Promise impossible deadlines"],
      examplePhrases: ["Ooh, love this idea!", "Send us a pic and we'll quote you ✨"],
    },
  });

  const lc1 = await prisma.customer.create({
    data: { workspaceId: lumea.id, name: "Teuta Rama", language: "en" },
  });
  const lconv1 = await prisma.conversation.create({
    data: {
      workspaceId: lumea.id,
      customerId: lc1.id,
      channelAccountId: lumeaIg.id,
      channelType: "instagram",
      status: "open",
      priority: "high",
      assignedToUserId: blerim.id,
      intent: "product_inquiry",
      sentiment: "positive",
      leadScore: 88,
      subject: "Custom name necklace",
      summary: "Wants a custom gold name necklace as a gift; needs it in 2 weeks.",
      lastMessageAt: hoursAgo(2),
      lastInboundAt: hoursAgo(2),
      tags: { create: [{ tagId: lumeaTag.id }] },
      messages: {
        create: [
          {
            workspaceId: lumea.id,
            direction: "inbound",
            senderType: "customer",
            body: "Can you make a custom name necklace in gold? Need it before the 10th 🙏",
            createdAt: hoursAgo(2),
          },
        ],
      },
    },
  });

  const lc2 = await prisma.customer.create({
    data: { workspaceId: lumea.id, name: "Bekim Luma", language: "en" },
  });
  await prisma.conversation.create({
    data: {
      workspaceId: lumea.id,
      customerId: lc2.id,
      channelAccountId: lumeaIg.id,
      channelType: "instagram",
      status: "pending",
      priority: "normal",
      assignedToUserId: blerim.id,
      intent: "delivery_question",
      sentiment: "neutral",
      leadScore: 55,
      subject: "Shipping time",
      summary: "Asking how long shipping takes to Germany.",
      lastMessageAt: hoursAgo(20),
      lastInboundAt: hoursAgo(20),
      messages: {
        create: [
          {
            workspaceId: lumea.id,
            direction: "inbound",
            senderType: "customer",
            body: "How long does shipping to Germany usually take?",
            createdAt: hoursAgo(20),
          },
        ],
      },
    },
  });

  await prisma.task.create({
    data: {
      workspaceId: lumea.id,
      title: "Send quote for Teuta's custom name necklace",
      status: "todo",
      priority: "high",
      assignedToUserId: blerim.id,
      createdByUserId: elira.id,
      dueAt: daysAhead(1),
      linkedConversationId: lconv1.id,
      linkedCustomerId: lc1.id,
    },
  });

  await prisma.insight.create({
    data: {
      workspaceId: lumea.id,
      type: "content_opportunity",
      title: "Recurring shipping-time questions",
      description: "Several customers ask about delivery times — create a shipping FAQ post.",
      priority: "normal",
    },
  });

  await prisma.sOP.create({
    data: {
      workspaceId: lumea.id,
      title: "Quoting a custom order from a photo",
      description: "Turn a vague custom request into a structured quote.",
      category: "Sales",
      status: "approved",
      version: 1,
      createdByUserId: elira.id,
      approvedByUserId: elira.id,
      body: [
        "1. Ask for a reference photo and desired material.",
        "2. Confirm size, personalization text, and deadline.",
        "3. Provide price + production time in one message.",
        "4. Create a task to follow up if no reply in 48h.",
      ].join("\n"),
    },
  });

  console.log("Seed complete.");
  console.log("  Bloom Studio  → lana@bloomstudio.test  (owner)");
  console.log("  Bloom Studio  → driton@bloomstudio.test (agent)");
  console.log("  Lumea Goods   → elira@lumeagoods.test   (owner)");
  console.log("  blerim@lumeagoods.test belongs to Lumea; password for all: 'operanto'");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
