# Customer matching

Customer continuity matters, but **unsafe merging is unacceptable**: wrongly
merging two people leaks one customer's history to another's conversations.
The policy trades duplicates for safety.

## Matching priority (`src/lib/events/matching.ts`)

1. Exact source customer id (`(organisation, sourceSystem, sourceCustomerId)`)
2. Exact normalized email (lowercased, trimmed)
3. Exact normalized phone (digits only; `00`/`+` prefix normalized to `+`; **no
   country-code inference** — a local and an international spelling do not match)
4. Otherwise: create a new customer

Never matched on: name, surname, language, inquiry text, IP address, property
interest.

## On match

- Only **gaps** are filled (missing name/email/phone); existing identity
  fields are never overwritten by inbound values — that would be an implicit
  merge.
- The winning rule is recorded on the customer (`matchReason`) and in the
  timeline (`customer.matched (email exact)`), so every merge decision is
  explainable after the fact.

## Future (not in this release)

A merge-review queue for probable duplicates (same phone in different
formats, same person with two emails) where a human confirms before records
combine. No automatic probabilistic merging.
