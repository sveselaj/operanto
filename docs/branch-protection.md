# Branch protection — recommended settings

Not applied. Enabling required status checks is the moment a repository stops
accepting direct pushes to `main`, so it is the owner's call — and it should be
made when the CI check names are stable, which they now are.

Apply the same settings to **both** `sveselaj/operanto` and
`sveselaj/pronatona`.

## Exact required check names

These are the job `name:` values, which is what GitHub matches on:

| Repository | Required checks |
|---|---|
| operanto | `Lint, typecheck, unit tests, build` · `Migrations apply to a clean database` |
| pronatona | `Lint, typecheck, unit tests, build` · `Migrations apply to a clean database` |

Vercel also reports `Vercel` and `Vercel Preview Comments`. Requiring the
`Vercel` deployment check is reasonable; do **not** require
`Vercel Agent Review`, which reports `skipping` and would block every merge.

## Click path (GitHub web UI)

Repository → **Settings** → **Branches** → **Add branch ruleset** (or *Add
classic branch protection rule*) → target `main`, then enable:

- ☑ **Require a pull request before merging**
  - Required approvals: **1** — set this once a second reviewer exists. With a
    single maintainer, leave at 0 and rely on CI; a rule that forces you to
    approve your own work teaches people to click through it.
  - ☑ Dismiss stale pull request approvals when new commits are pushed
- ☑ **Require status checks to pass before merging**
  - ☑ **Require branches to be up to date before merging**
  - Add the check names from the table above
- ☑ **Require conversation resolution before merging**
- ☑ **Block force pushes**
- ☑ **Restrict deletions** (block deleting `main`)
- ☐ **Do not allow bypassing the above settings** — leave **unchecked** so an
  administrator retains emergency access. With a single maintainer and no
  on-call rotation, locking yourself out of your own `main` during an incident
  is the larger risk. Revisit when the team grows.

## Equivalent via the API

```sh
gh api -X PUT repos/sveselaj/operanto/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -F "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=Lint, typecheck, unit tests, build" \
  -f "required_status_checks[contexts][]=Migrations apply to a clean database" \
  -F "enforce_admins=false" \
  -F "required_pull_request_reviews[required_approving_review_count]=0" \
  -F "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -F "required_conversation_resolution=true" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false" \
  -F "restrictions=null"
```

Repeat with `sveselaj/pronatona`.

## Before enabling

Both workflows must have completed at least once on `main`, otherwise the
required checks will not appear in the picker. As of 2026-07-31 both have run
successfully on their CI branches; merge the CI pull requests first so a run
exists on `main`, then apply protection.
