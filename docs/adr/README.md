# Architecture Decision Records (ADRs) — merchant-sdk

This directory records the **load-bearing architecture decisions** specific to
`@web3settle/merchant-sdk`, the embeddable TypeScript payment SDK that runs in
**untrusted customer browsers**. They are inferred from the code in `src/` so
that future work (human or agent) is guided by the *why*, not just the *what*.
This is part of the [`Discipline.md`](../../Discipline.md) governance charter
adopted across the Web3Settle platform.

## Scope: repo-specific vs platform-wide

- **Platform-wide / cross-cutting** decisions live in the monorepo root at
  [`docs/adr/`](https://github.com/web3settle/web3settle/tree/main/docs/adr)
  (e.g. ADR-0001 non-custodial per-merchant contracts, ADR-0002 Docker-Compose-
  only deployment). They are **not** duplicated here.
- **This directory** holds decisions whose blast radius is the SDK itself: its
  trust boundary in the browser, its signing allow-lists, what it is allowed to
  emit off-device, and how it is packaged and published.

The SDK is a *consumer* of the platform decisions: it exists because the
platform is non-custodial (ADR-0001) — a poisoned contract address sends funds
nobody can claw back, which is the root force behind the trust-boundary and
permit ADRs below.

## What an ADR is

A short, immutable record of one significant decision: the context that forced
it, the decision taken, and the consequences (good and bad) we accepted. ADRs
are **append-only** — we don't rewrite history; we supersede an ADR with a new
one and link them.

## Format

Each ADR uses:

- **Status** — Proposed / Accepted / Superseded (by ADR-NNNN) / Deprecated
- **Context** — the forces and constraints in play
- **Decision** — what we chose
- **Consequences** — what this makes easy, and what it costs us
- **Alternatives considered** — and why they lost
- **Links** — code, PRs, runbooks

> Per [`Discipline.md`](../../Discipline.md) §9, significant decisions should
> also capture consensus participants/outcome where a multi-persona review was
> run.

## Index (merchant-sdk-specific)

| ADR | Title | Status |
|-----|-------|--------|
| [0003](0003-browser-trust-boundary-signed-config.md) | Treat the customer browser as hostile: verify the signed payment-config before building any transaction | Accepted |
| [0004](0004-known-permit-tokens-allowlist.md) | Refuse EIP-2612 permit signatures for tokens outside `KNOWN_PERMIT_TOKENS` | Accepted |
| [0005](0005-telemetry-redaction-no-phone-home.md) | Telemetry is opt-in, never phones home, and redacts PII/secrets before emission | Accepted |

## Numbering

Four digits, monotonically increasing, never reused. To keep numbers globally
unambiguous across the monorepo, this sub-repo **continues** the platform
sequence (platform reserved 0001–0002; the SDK starts at 0003). A given number
is owned by exactly one repo.
