# Operanto Computer program — status and what remains

Status date: **2026-08-07**. One-page recap of where the Computer program
stands, what is on `main`, what is deliberately switched off, and what has
to happen next. This document is a map, not a decision record — each slice
keeps its own doc, listed below.

**In one sentence:** the Computer capability is fully built through the
first browser side effect (C4) and its validation instrument (C4.1),
every part of it is off by default, and the program is **paused pending
human-run pilot evidence** before anything further is considered.

## Where we stand

| Slice | PR / merge | Delivered | State |
|---|---|---|---|
| **C0** — capability ratified | #20 · `fcca431` | Computer as a bounded capability; API-first, computer-capable; R0–R4 risk ladder | docs only |
| **C1** — domain foundation | #21 · `7fab513` | Session/Plan/Step/Action/Snapshot, risk floors, unified approvals, privacy coverage | dormant, no executor |
| **C2** — browser bridge | #22 · `61700a9` | MV3 extension, explicit tab share, session-bound tokens, server-side sanitization, dev-DB guard | flag-gated off |
| **C3** — understanding + guide | #23 · `d3b1811` | Two AI tasks on the existing Intelligence spine, four-class trust taxonomy, deterministic grounding, `/computer` workbench | flag-gated off |
| **C4** — safe single navigation | #24 · `bf51fc2` | ONE approved, path-only, same-origin link opening per fresh observation, then STOP | flag-gated off |
| **C4.1** — validation instrument | #25 · `dd136bc` | Refusal auditing, derived metrics, failure taxonomy, CLI report + internal view | flag-gated off |
| **C4.1 pilot prep** | #26 · `661d92d` | Usefulness-signal control; pilot runbook, 10-case pack, Checkpoint 1 template | ready to run |

`main` is healthy: 24 migrations, 429 unit and 242 integration tests
green, staging schema in sync. **C4.1 and pilot prep added zero
migrations.**

### The capability in one line

```text
OBSERVE → UNDERSTAND → RECOMMEND → HUMAN APPROVES
        → ONE SAFE NAVIGATION → VERIFY → STOP
```

That is the entire browser-side effect surface. There is no loop, no
general click, no typing, no form submission, no upload or download, no
cross-origin navigation, and no query- or fragment-bearing destination.

## What is switched off (and stays off)

Every Computer surface is environment-gated, server-side only, default
**off** — no request input can enable any of them, and each higher flag
requires the ones beneath it.

| Flag | Enables | Default |
|---|---|---|
| `OPERANTO_COMPUTER_BRIDGE_ENABLED` | C2 observation transport | off |
| `OPERANTO_COMPUTER_GUIDE_ENABLED` | C3 understanding (requires bridge) | off |
| `OPERANTO_COMPUTER_NAVIGATION_ENABLED` | C4 navigation (requires guide) | off |
| `OPERANTO_COMPUTER_LIVE_ENABLED` + `OPERANTO_COMPUTER_LIVE_EVAL_VERSION` | live model for Computer tasks | off, and pinned |
| `OPERANTO_COMPUTER_VALIDATION_CAMPAIGN` | C4.1 campaign grouping | unset |

Production and shared staging have **all** of these unset. Permissions
are `computer:read` and `computer:operate` (ADMIN + SUPERVISOR);
approval decisions reuse `approvals:decide`; `computer:approve` and
`computer:admin` were deliberately never created.

## Gates that currently hold

1. **Agent-runtime gate (2026-08-02).** Nothing agentic beyond the
   ratified sequence; Computer slices arrive inside that discipline.
2. **C3 live-eval gate.** A live model for Computer tasks fails closed
   unless the deployment pins the current `COMPUTER_LIVE_EVAL_VERSION`
   after rerunning the live injection fixtures. A changed prompt
   re-closes the gate automatically.
3. **C5 unauthorized.** Multi-step or looped navigation is proposed only;
   no code exists and none may be written without explicit authorization.
4. **R3/R4 unexecutable.** Commits gate through approval; restricted
   actions (money movement, credentials, 2FA, destructive operations) are
   born BLOCKED and have no approval path in any slice.

## What remains — the pilot

The instrument is built; the evidence is not collected. **This step
cannot be delegated to an engineering agent:** every case needs an
authorized human to log into the target application, share a tab from
their own browser, and approve or reject. Approval was deliberately built
to be un-automatable, and driving the extension programmatically would be
exactly the autonomous execution C4 forbids.

Runbook: `docs/operanto-computer-c41-pilot.md`.

1. **Provision an isolated pilot environment** — dedicated preview
   deployment with its **own database branch** (not staging), a
   `c41-pilot` organisation, the Computer flags set there only, the
   extension pointed at it. *Open item: confirm whether the existing
   auto-created preview has its own database before reusing it.*
2. **Phase A (mock) — cases 1–2.** FictionBank and Operanto itself.
   Proves plumbing end to end. If Phase A fails, stop and fix the setup
   before touching real applications.
3. **Phase B (live) — cases 3–10.** Real applications, only after the C3
   live-eval gate is genuinely satisfied. These usefulness ratings are
   the ones that inform the C5 decision. Cases 8–10 are the **contextual**
   ones (conversation + customer/task context driving the
   recommendation), which matter more than "open the obvious link".
4. **Rate honestly.** `USEFUL` only when the recommendation genuinely
   saved working out where to go. A 10/10-useful pilot is a suspicious
   result, not a perfect one.
5. **Produce Checkpoint 1** — structured half from
   `pnpm computer:validation-report --org c41-pilot --campaign c41-pilot-01`,
   narrative half from the case records, **Phase A and B reported
   separately**. Then **STOP** at ~10 cases and review.

Invariants that must read zero throughout: unauthorized side effects,
cross-origin escapes, replay successes, sensitive URL persistence. Any
non-zero value is a stop-and-investigate ahead of everything else.

## Predictions recorded before the pilot

So the pilot confirms or refutes them rather than rationalizing
afterwards: query-bearing detail links (`?id=…`) blocked by design —
likely the top blocker and the most important thing to quantify; SPA
re-render invalidating ephemeral refs; the 10-minute freshness window
being wrong in one direction; repeated accessible names causing ambiguity
refusals; and the two-credential UX proving clumsy.

## Known limitations carried forward (deliberate, not defects)

- **Path-only destinations.** Query/fragment links are rejected to
  preserve the "persisted URLs are origin + pathname only" privacy
  invariant. Supporting them needs a separately reviewed destination
  fingerprint — never persisted raw query values.
- **No artifacts.** Screenshots and `ComputerArtifact` remain deferred;
  semantic capture has been sufficient so far. A screenshot would be the
  repository's first stored binary and needs its storage, retention,
  erasure and access design first.
- **Grounding proves evidence presence, not claim truth.** Reports carry
  `verifies: "EVIDENCE_PRESENCE_ONLY"`; the UI separates verified
  OBSERVED evidence from the model's INTERPRETATION.
- **No operational/procedural memory.** Learning recurring procedures
  (ApplicationMap, ComputerSkill, …) stays a future direction; raw
  governed sessions come first.
- **OPERATOR/AUDITOR have no Computer access**; expansion is a product
  decision.
- `docs/security.md`'s permission matrix is stale relative to
  `src/lib/rbac.ts` (13 of 60+ permissions listed, no AUDITOR column) —
  pre-existing, tracked, not a Computer issue.

## Wider Operanto context

Computer is one execution arm; the rest of the platform is unchanged by
this program. WhatsApp Cloud remains fully built and dormant awaiting the
owner's Meta assets; Growth G1–G2, CRM OI-3 and the OI-4 work queue are
merged and flag-gated as before. The canonical loop is unchanged:

```text
Conversation → Context → Intelligence → Plan
  → Execution (native tool | API connector | Computer | human)
  → Verify → Outcome → Memory
```

## Slice documents

- `docs/operanto-computer-capability.md` — the ADR and all slice addenda
- `docs/operanto-computer-c1.md` … `-c4.md` — domain, bridge, guide, navigation
- `docs/operanto-computer-c4-1.md` — validation method, metrics, taxonomy, C5 review criteria
- `docs/operanto-computer-c41-pilot.md` — pilot runbook and case pack

## The question now open

C0–C4 answered *can this be built safely?* — yes. The open question is
the one the pilot exists to answer:

> **Do people find it useful enough to justify more autonomy?**

Only the product owner authorizes C5, and only on evidence.
