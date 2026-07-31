# Operanto — User Manual

> **Where conversations become operations.**
> A day-to-day guide for using Operanto: triaging the inbox, working with the AI
> assistant, managing tasks and SOPs, creating content, and reading analytics.

Version 0.1 · Last updated 2026-05-26

For setup/admin topics (install, env, roles, channels) see
[ADMIN_MANUAL.md](ADMIN_MANUAL.md). For product rationale see
[BLUEPRINT.md](BLUEPRINT.md).

---

## 1. Core idea

Operanto treats every customer message as a **latent operation** — a lead, a
task, a content idea, an SOP improvement. The AI detects what a conversation
*is* and suggests the next step; **a human always approves before anything goes
to a customer.** Operanto never auto-sends customer replies.

---

## 2. Getting started

### Logging in

1. Go to the app URL (e.g. `http://localhost:3000`).
2. Sign in with your email and password (credentials are set by your admin —
   there is no self-service signup).
3. If you belong to more than one workspace, pick one on the **Select
   workspace** screen. The workspace switcher (top of the app) lets you change
   later.

> Demo accounts (if seeded) use password `operanto` — e.g.
> `lana@bloomstudio.test`. See [ADMIN_MANUAL.md §8](ADMIN_MANUAL.md#8-demo--seed-data).

### What you can see depends on your role

The left sidebar only shows modules your role can use. If you don't see Team,
Settings, or Automations, your role doesn't grant them. The full role/permission
breakdown is in [ADMIN_MANUAL.md §6](ADMIN_MANUAL.md#6-identity-roles--permissions).

| Role | Day-to-day focus |
|---|---|
| **Owner / Admin** | Everything, including settings, members, channels. |
| **Manager** | Inbox, tasks, SOPs (create), content, QA, reports, automations, channels. |
| **Agent** | Inbox (read/reply/triage), tasks, content, AI actions, reports. |
| **Reviewer** | Read conversations, QA review, reports. |
| **Client viewer** | Reports only. |

---

## 3. The layout

- **Left sidebar** — module navigation: Command, Inbox, Tasks, SOPs, Studio,
  Intelligence, Automations, Team, Settings (filtered by role).
- **Top bar** — workspace switcher.
- **Center** — the active module.
- **Right panel** — context (in the Inbox: AI summary, customer, tags, notes).

---

## 4. Command center

Your home screen ("What needs your attention"). It shows:

- **Stat cards** — open conversations, leads detected, open tasks, overdue tasks.
- **Priority conversations** — the 6 most urgent open threads; click to open.
- **Insights** — AI-surfaced opportunities. On a `content_opportunity` insight,
  if your role can manage content, a **Create post** button sends it to Studio.
- **Open tasks** — your team's next 6 tasks by due date (overdue flagged red).

Use this as your daily starting point, then dive into the Inbox.

---

## 5. Inbox

The unified conversation center.

### Finding conversations

The conversation list supports filters (via the controls / URL):

- **Status** — open, pending, waiting on customer, resolved, archived
- **Channel** — Instagram, Facebook, WhatsApp, email, SMS, web chat, manual
- **Assignee** — e.g. *me* vs. all
- **Search** (`q`) — free-text

### Working a conversation

Open a thread to see the message history (inbound, your outbound replies, and
internal notes are visually distinct). Across the screen you can:

- **Triage** (needs *triage* permission) — change **status**, set **priority**,
  and **assign** to a teammate via the controls under the header.
- **Reply** (needs *reply* permission) — type in the composer at the bottom and
  send. Outbound goes only when you send it.
- **Tag** — add/remove workspace tags in the right panel.
- **Internal notes** — leave a private note for the team (customers never see
  these); shown highlighted in the thread and the right panel.

### The AI panel (right side)

- **AI summary** — click **Analyze** to have AI summarize and classify the
  conversation. It fills in:
  - **Intent** (e.g. *Pricing inquiry*, *Appointment request*, *Complaint*)
  - **Sentiment** (e.g. *Positive*, *Frustrated*, *Angry*)
  - **Lead score** (0–100; ≥70 is flagged as a lead)
- **Create task** — spin off a follow-up task linked to this conversation and
  customer (needs *tasks* permission).
- **Generate content** — turn the conversation into a Studio draft (needs
  *content* permission).
- **Customer** — name, email, phone, language, location.

> **AI drafts are always editable and never auto-sent.** Review, edit, and send
> manually.

---

## 6. Tasks

A Kanban board with columns **To do · In progress · Blocked · Done**.

- **New task** — create directly, set title/description, **priority**, **due
  date**, and **assignee**.
- **From a conversation** — use *Create task* in the Inbox AI panel to link the
  task to that thread and customer.
- **Filter** — by assignee (e.g. *me* vs. everyone).
- Move a task between columns to update its status; overdue due-dates are
  highlighted.

---

## 7. SOPs (Standard Operating Procedures)

Your team's playbook library. Each SOP has a **status** (draft → approved →
archived), a **category**, and a **version**.

- **New SOP** — write one manually (needs *create* permission).
- **Generate with AI** — describe the situation (e.g. "angry refund requests")
  and AI drafts a structured SOP for you to edit.
- **Approve** — owners/admins approve a draft so the team can rely on it
  (managers can create but not approve).
- Open any card to read or edit it. Approved SOPs feed the AI's context so
  replies and other SOPs stay consistent with your policy.

---

## 8. Studio (content)

Turn conversations and insights into on-brand content. A board with columns
**Ideas · Drafts · Review · Approved · Published**.

- **Brand voice** — define tone, language, do's, don'ts, and example phrases.
  AI uses the selected brand voice when generating.
- **Generate content** — from a conversation (Inbox → *Generate content*), from
  a `content_opportunity` insight (Command/Intelligence → *Create post*), or
  manually.
- Each draft records its **channel**, **brand voice**, and its **source**
  (which conversation or insight it came from).
- Move cards across the board as content moves from idea to published. Edit
  freely before approving.

---

## 9. Intelligence (analytics)

Your operational dashboard:

- **Metrics** — open conversations, resolved, leads detected, average first
  response time, overdue tasks.
- **Top intents** — what customers contact you about most.
- **Sentiment mix** — overall mood of conversations.
- **Message volume** — 14-day trend.
- **Agent workload** — open conversations and tasks per teammate.
- **AI insights** — click **Generate insights** (needs *ai:run* permission) to
  have AI surface patterns and opportunities (e.g. "18 leads un-replied >24h",
  "create a shipping-policy post"). Content opportunities can be sent straight
  to Studio.

---

## 10. Automations

Trigger-and-action rules that run your playbook automatically (managers and
above). Each rule = **trigger** + optional **conditions** (all AND-ed) +
**actions**.

**Triggers**
- When a conversation is analyzed by AI
- When a new inbound message arrives
- When a conversation is created

**Conditions** (optional, all must match)
- Intent is …
- Sentiment is …
- Channel is …
- Lead score ≥ …
- Message contains …

**Actions** (one or more)
- Add tag
- Set priority
- Assign to a teammate
- Create a follow-up task

Toggle a rule on/off with its **enabled** switch; the card shows when it
**last ran**. Example: *When analyzed → if intent is pricing_inquiry and lead
score ≥ 70 → set priority High and create a "Follow up on quote" task.*

---

## 11. Team & Settings

- **Team** — view workspace members, their roles, and status. (In this build
  it's a read-only view; member/role changes are made by an admin — see
  [ADMIN_MANUAL.md §6](ADMIN_MANUAL.md#6-identity-roles--permissions).)
- **Settings** — workspace details (name, slug, plan, timezone, default
  language) and **channels** with their connection status and inbound endpoint.
  Web chat works today via a public widget; other channels activate once an
  admin configures credentials.

---

## 12. The end-to-end loop (worked example)

1. A customer DM arrives in the **Inbox** → the customer is created/updated.
2. You click **Analyze** → AI sets intent = *pricing inquiry*, sentiment, and a
   lead score of 82 (flagged as a lead).
3. You click **Draft reply** style action, **edit** the suggestion, and **send**.
4. You create a **follow-up task** from the conversation, assigned with a due
   date.
5. **Intelligence** notices recurring "delivery time?" questions and raises a
   `content_opportunity` **insight**.
6. You click **Create post** → **Studio** generates an on-brand caption you edit
   and save.

Every AI action and important change is logged for audit — nothing is sent
without you.

---

## 13. Tips & FAQ

- **Why can't I see a module?** Your role doesn't grant it (§2).
- **Did my reply get sent automatically?** No — outbound only sends when you
  send it. AI never messages customers on its own.
- **Can I undo AI classification?** Re-run **Analyze**, or just edit the
  conversation's status/priority/tags manually.
- **Is my work isolated from other workspaces?** Yes — you only ever see data
  for the workspace you're in.
- **Where do AI suggestions come from?** Your brand voice, approved SOPs, and
  the conversation context — the AI is told not to invent policy and to flag low
  confidence.

---

## 14. Reference

- Setup & administration: [ADMIN_MANUAL.md](ADMIN_MANUAL.md)
- Product & technical blueprint: [BLUEPRINT.md](BLUEPRINT.md)
</content>
