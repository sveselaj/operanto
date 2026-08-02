# Operanto conversation workflows (Slice 3)

Third runtime slice: a customer request in a conversation becomes trackable
operational work without losing context. Narrowly scoped by design — no
workflow engine, approvals, automations, escalations, reminders, AI, or
channel work. Builds on `docs/operanto-conversations-foundation.md`.

## Data model (migration `20260802092135_task_conversation_link`, additive)

One nullable column: `Task.conversationId` (FK, indexed, cascade with its
conversation), mirroring the existing `Task.opportunityId` linkage. No other
schema change.

## Behaviour

- **Create a task from a conversation** (detail page → Tasks section): title,
  optional due date, optional assignee. The conversation must pass the
  caller's record-level access; the assignee must be an ACTIVE membership of
  the same organisation.
- **Timeline**: `task.created`, `task.completed`, and `task.reopened`
  activities are anchored to the conversation (and its customer), so task
  progress reads inline in the conversation timeline and the customer's
  cross-conversation timeline.
- **Visibility**: linked tasks render in the conversation detail, in the
  customer-context panel (`openTasks` now covers opportunity- and
  conversation-linked work), and in the Tasks list with a link back to the
  conversation.
- **Scoping**: `taskAccessWhere` gains one rung — operators also see tasks
  hanging off conversations assigned to them. Cross-tenant conversation ids
  are rejected before any write.
- **Privacy**: creating follow-up work for a restricted customer is blocked
  (Art. 18 halts new processing, not only messages). Erasure redacts titles
  and descriptions of conversation-linked tasks exactly as it does for
  opportunity-linked ones.
- **Audit hardening**: `task.created` audit metadata now carries ids only —
  previously it stored the title, which is free text that erasure has to
  redact everywhere else while audit rows live forever.

## Tests

Integration: create-from-conversation with timeline + id-only audit,
restriction block, cross-tenant rejection, operator conversation-rung
scoping (positive and negative), erasure of conversation-task titles,
context-panel inclusion. E2E: the Nagelista flow now creates a task from the
conversation, completes it, sees both timeline entries, and finds the task in
the Tasks list.

## Deferred (by the approved plan)

Workflow definitions/instances, approvals, escalation rules, reminders and
notifications, task dependencies, automations, AI-suggested tasks.
