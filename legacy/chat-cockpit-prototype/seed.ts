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
  await prisma.approvalRequest.deleteMany();
  await prisma.toolInvocation.deleteMany();
  await prisma.assistantMessage.deleteMany();
  await prisma.assistantThread.deleteMany();
  await prisma.messageDraft.deleteMany();
  await prisma.conversationContextLink.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.property.deleteMany();
  await prisma.auditLog.deleteMany();
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
  // Pronatona (real-estate) team
  const ardit = await mkUser("ardit@pronatona.test", "Ardit Berisha"); // owner
  const flaka = await mkUser("flaka@pronatona.test", "Flaka Morina"); // manager
  const endrit = await mkUser("endrit@pronatona.test", "Endrit Krasniqi"); // agent
  const rea = await mkUser("rea@pronatona.test", "Rea Hoxha"); // reviewer

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
    data: { workspaceId: bloom.id, name: "Arta Krasniqi", language: "en" },
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
            createdAt: daysAgo(2),
          },
        ],
      },
    },
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

  // ════════════════════════════════════════════════════════════
  // Workspace 3 — Pronatona (real estate, Kosovo) — VERTICAL DEMO
  // ════════════════════════════════════════════════════════════
  const pronatona = await prisma.workspace.create({
    data: {
      name: "Pronatona",
      slug: "pronatona",
      plan: "pro",
      timezone: "Europe/Belgrade",
      defaultLanguage: "sq",
      vertical: "real-estate",
      members: {
        create: [
          { userId: ardit.id, role: "owner" },
          { userId: flaka.id, role: "manager" },
          { userId: endrit.id, role: "agent" },
          { userId: rea.id, role: "reviewer" },
        ],
      },
    },
  });

  const proIg = await prisma.channelAccount.create({
    data: { workspaceId: pronatona.id, type: "instagram", name: "@pronatona", status: "connected" },
  });
  const proWa = await prisma.channelAccount.create({
    data: { workspaceId: pronatona.id, type: "whatsapp", name: "Pronatona WhatsApp", status: "connected" },
  });
  await prisma.channelAccount.create({
    data: { workspaceId: pronatona.id, type: "webchat", name: "Pronatona.com chat", status: "connected" },
  });

  await prisma.brandVoice.create({
    data: {
      workspaceId: pronatona.id,
      name: "Pronatona — professional & warm (Albanian)",
      description: "Trustworthy, clear real-estate tone for Kosovo buyers and sellers.",
      tone: "professional, warm, precise",
      language: "sq",
      dos: ["Confirm facts from the listing", "Offer a viewing", "Be transparent about status"],
      donts: ["Invent availability or price", "Pressure the buyer", "Promise legal outcomes"],
      examplePhrases: ["Faleminderit që na kontaktuat!", "A dëshironi të organizojmë një vizitë?"],
    },
  });

  // ── Properties (source of truth for availability/price/status) ──
  const mkProp = (data: Prisma.PropertyCreateManyInput) => data;
  await prisma.property.createMany({
    data: [
      mkProp({
        workspaceId: pronatona.id,
        code: "PR-1042",
        title: "Bright 3-bedroom apartment in Arbëri",
        type: "apartment",
        listingType: "sale",
        status: "available",
        price: 168000,
        areaSqm: 112,
        bedrooms: 3,
        bathrooms: 2,
        city: "Prishtina",
        district: "Arbëri",
        description: "Modern apartment with balcony, parking, near schools.",
        media: ["https://images.example/pr-1042-1.jpg", "https://images.example/pr-1042-2.jpg"],
        features: ["balcony", "parking", "elevator"],
        assignedAgentUserId: endrit.id,
        publicationStatus: "listed",
        availabilityNote: "Available for viewings this week.",
      }),
      mkProp({
        workspaceId: pronatona.id,
        code: "PR-1050",
        title: "2-bedroom apartment near Prishtina center",
        type: "apartment",
        listingType: "sale",
        status: "available",
        price: 132000,
        areaSqm: 84,
        bedrooms: 2,
        bathrooms: 1,
        city: "Prishtina",
        district: "Qendër",
        features: ["balcony"],
        assignedAgentUserId: endrit.id,
        publicationStatus: "listed",
      }),
      mkProp({
        workspaceId: pronatona.id,
        code: "PR-1102",
        title: "Cozy 3-bedroom apartment in Bregu i Diellit",
        type: "apartment",
        listingType: "sale",
        status: "available",
        price: 149000,
        areaSqm: 96,
        bedrooms: 3,
        bathrooms: 2,
        city: "Prishtina",
        district: "Bregu i Diellit",
        features: ["parking"],
        assignedAgentUserId: flaka.id,
        publicationStatus: "listed",
      }),
      mkProp({
        workspaceId: pronatona.id,
        code: "PR-1033",
        title: "Renovated apartment in Dardania",
        type: "apartment",
        listingType: "sale",
        status: "reserved",
        price: 158000,
        areaSqm: 105,
        bedrooms: 3,
        bathrooms: 2,
        city: "Prishtina",
        district: "Dardania",
        assignedAgentUserId: endrit.id,
        availabilityNote: "Reserved — deposit received, pending contract.",
        publicationStatus: "listed",
      }),
      mkProp({
        workspaceId: pronatona.id,
        code: "PR-1007",
        title: "Family apartment in Ulpiana",
        type: "apartment",
        listingType: "sale",
        status: "sold",
        price: 145000,
        areaSqm: 100,
        bedrooms: 3,
        city: "Prishtina",
        district: "Ulpiana",
        availabilityNote: "Sold in June.",
        publicationStatus: "unlisted",
      }),
      mkProp({
        workspaceId: pronatona.id,
        code: "PR-2001",
        title: "Modern villa with garden in Germia",
        type: "villa",
        listingType: "sale",
        status: "available",
        price: 415000,
        areaSqm: 260,
        bedrooms: 5,
        bathrooms: 3,
        city: "Prishtina",
        district: "Germia",
        features: ["garden", "garage"],
        assignedAgentUserId: flaka.id,
        publicationStatus: "listed",
      }),
    ],
  });
  const pr1042 = await prisma.property.findFirstOrThrow({
    where: { workspaceId: pronatona.id, code: "PR-1042" },
  });

  // ── Customers / leads ──
  const buyerDe = await prisma.customer.create({
    data: {
      workspaceId: pronatona.id,
      name: "Arben Krasniqi",
      email: "arben.k@example.de",
      language: "sq",
      location: "Germany",
      socialHandles: { instagram: "@arben.k", externalId: "ig_arben" } as Prisma.InputJsonValue,
      notes: "Kosovar diaspora buyer based in Germany.",
    },
  });
  const buyerLocal = await prisma.customer.create({
    data: {
      workspaceId: pronatona.id,
      name: "Vlora Gashi",
      phone: "+38344111222",
      language: "sq",
      location: "Prishtina",
    },
  });

  // ── Conversations ──
  const proConv1 = await prisma.conversation.create({
    data: {
      workspaceId: pronatona.id,
      customerId: buyerDe.id,
      channelAccountId: proIg.id,
      channelType: "instagram",
      status: "open",
      priority: "high",
      assignedToUserId: endrit.id,
      intent: "product_inquiry",
      sentiment: "positive",
      leadScore: 82,
      subject: "Availability — Arbëri apartment",
      summary: "Diaspora buyer from Germany asking if the Arbëri apartment (PR-1042) is still available.",
      lastMessageAt: hoursAgo(2),
      lastInboundAt: hoursAgo(2),
      messages: {
        create: [
          {
            workspaceId: pronatona.id,
            direction: "inbound",
            senderType: "customer",
            body: "Përshëndetje, a është ende e lirë banesa në Arbëri? Buxheti im është deri në €170,000.",
            createdAt: hoursAgo(2),
          },
        ],
      },
    },
  });

  await prisma.conversation.create({
    data: {
      workspaceId: pronatona.id,
      customerId: buyerLocal.id,
      channelAccountId: proWa.id,
      channelType: "whatsapp",
      status: "open",
      priority: "normal",
      assignedToUserId: endrit.id,
      intent: "appointment_request",
      sentiment: "neutral",
      leadScore: 68,
      subject: "Viewing request",
      summary: "Local buyer wants to view a 2-bedroom apartment near the center.",
      lastMessageAt: hoursAgo(8),
      lastInboundAt: hoursAgo(8),
      messages: {
        create: [
          {
            workspaceId: pronatona.id,
            direction: "inbound",
            senderType: "customer",
            body: "A mund të organizojmë një vizitë për një banesë me 2 dhoma?",
            createdAt: hoursAgo(8),
          },
        ],
      },
    },
  });

  // ── Opportunities (CRM) with extracted requirements ──
  const oppDe = await prisma.opportunity.create({
    data: {
      workspaceId: pronatona.id,
      title: "Arben Krasniqi — 3-bed apartment, Prishtina",
      stage: "qualified",
      value: 168000,
      currency: "EUR",
      leadScore: 82,
      contactCustomerId: buyerDe.id,
      ownerUserId: endrit.id,
      conversationId: proConv1.id,
      source: "instagram",
      nextAction: "Confirm availability and offer a viewing for PR-1042.",
      lastActivityAt: hoursAgo(2),
      createdByUserId: endrit.id,
      requirements: {
        budgetMin: 120000,
        budgetMax: 170000,
        locations: ["Prishtina", "Arbëri"],
        propertyType: "apartment",
        bedrooms: 3,
        timeline: "Within 3 months",
      } as Prisma.InputJsonValue,
    },
  });
  await prisma.opportunity.create({
    data: {
      workspaceId: pronatona.id,
      title: "Vlora Gashi — 2-bed near center",
      stage: "new",
      value: 132000,
      currency: "EUR",
      leadScore: 68,
      contactCustomerId: buyerLocal.id,
      ownerUserId: endrit.id,
      source: "whatsapp",
      nextAction: "Schedule a viewing.",
      lastActivityAt: hoursAgo(8),
      createdByUserId: endrit.id,
      requirements: {
        budgetMax: 140000,
        locations: ["Prishtina"],
        propertyType: "apartment",
        bedrooms: 2,
        timeline: "Within 6 weeks",
      } as Prisma.InputJsonValue,
    },
  });

  // Link the conversation to the property + opportunity (context panel).
  await prisma.conversationContextLink.createMany({
    data: [
      {
        workspaceId: pronatona.id,
        conversationId: proConv1.id,
        recordType: "property",
        recordId: pr1042.id,
        label: pr1042.code,
      },
      {
        workspaceId: pronatona.id,
        conversationId: proConv1.id,
        recordType: "opportunity",
        recordId: oppDe.id,
        label: oppDe.title,
      },
    ],
  });

  await prisma.task.create({
    data: {
      workspaceId: pronatona.id,
      title: "Send viewing options for PR-1042 to Arben",
      status: "todo",
      priority: "high",
      assignedToUserId: endrit.id,
      createdByUserId: flaka.id,
      dueAt: daysAhead(1),
      linkedConversationId: proConv1.id,
      linkedCustomerId: buyerDe.id,
    },
  });

  // ── A prepared social post + a PENDING approval to publish it ──
  const proDraft = await prisma.contentDraft.create({
    data: {
      workspaceId: pronatona.id,
      title: "PR-1042 — Arbëri apartment (Instagram)",
      channel: "instagram",
      status: "review",
      content:
        "✨ E RE në Arbëri! Banesë moderne me 3 dhoma, 112 m², €168,000.\n\nBallkon, parking, afër shkollave. A dëshironi një vizitë? Na shkruani në DM! 🏡",
      createdByUserId: endrit.id,
    },
  });
  const socialInvocation = await prisma.toolInvocation.create({
    data: {
      workspaceId: pronatona.id,
      toolName: "queue_social_post",
      title: "Publish / queue social post",
      category: "social",
      risk: "write",
      status: "awaiting_approval",
      approvalRequired: true,
      correlationId: "seed-social-1",
      input: { contentDraftId: proDraft.id, scheduledInHours: 24 } as Prisma.InputJsonValue,
    },
  });
  await prisma.approvalRequest.create({
    data: {
      workspaceId: pronatona.id,
      toolInvocationId: socialInvocation.id,
      status: "pending",
      title: "Publish / queue social post",
      summary: "Publish / queue social post — Instagram post for PR-1042, in 24h",
      requestedByUserId: endrit.id,
      expiresAt: daysAhead(2),
    },
  });

  // ── A prepared customer reply + a PENDING send approval ──
  const replyDraft = await prisma.messageDraft.create({
    data: {
      workspaceId: pronatona.id,
      conversationId: proConv1.id,
      channel: "instagram",
      body:
        "Përshëndetje Arben! Po, banesa PR-1042 në Arbëri aktualisht figuron si e disponueshme (€168,000, 112 m², 3 dhoma). A dëshironi t'ju dërgoj fotografi ose të organizojmë një vizitë këtë javë?",
      status: "draft",
      createdByUserId: endrit.id,
    },
  });
  const sendInvocation = await prisma.toolInvocation.create({
    data: {
      workspaceId: pronatona.id,
      toolName: "send_customer_message",
      title: "Send customer message",
      category: "messaging",
      risk: "write",
      status: "awaiting_approval",
      approvalRequired: true,
      correlationId: "seed-send-1",
      input: {
        conversationId: proConv1.id,
        draftId: replyDraft.id,
        body: replyDraft.body,
      } as Prisma.InputJsonValue,
    },
  });
  await prisma.approvalRequest.create({
    data: {
      workspaceId: pronatona.id,
      toolInvocationId: sendInvocation.id,
      status: "pending",
      title: "Send customer message",
      summary: "Send an Instagram reply to Arben confirming PR-1042 availability",
      requestedByUserId: endrit.id,
      expiresAt: daysAhead(2),
    },
  });

  console.log("Seed complete.");
  console.log("  Bloom Studio  → lana@bloomstudio.test   (owner)");
  console.log("  Bloom Studio  → driton@bloomstudio.test (agent)");
  console.log("  Lumea Goods   → elira@lumeagoods.test    (owner)");
  console.log("  Pronatona     → ardit@pronatona.test     (owner, real-estate vertical)");
  console.log("  Pronatona     → endrit@pronatona.test    (agent)");
  console.log("  Password for all: 'operanto'");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
