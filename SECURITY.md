# Security Policy

Web3Settle operates a non-custodial payment gateway that moves real customer
funds on public blockchains. We take security reports seriously and respond
quickly. Thank you in advance for practising responsible disclosure.

## Reporting a vulnerability

**Do not open a public GitHub issue, discussion, or pull request for security
problems.** Public disclosure before a fix is published puts merchants and end
users at risk.

Preferred channel:

- **Email:** [security@web3settle.com](mailto:security@web3settle.com)
- **PGP:** available on request; reply to our first message with your public key
  and we will send ours. Optional but appreciated for high-severity reports.

Alternative channel (if you cannot email):

- **GitHub Private Vulnerability Reporting** on any of our repositories:
  `Security` tab → `Report a vulnerability`.

Please include, at minimum:

1. A description of the issue and the affected component (repo, file, version
   or commit SHA).
2. A concrete proof-of-concept or exploit scenario, including the expected and
   actual result.
3. The impact you believe the issue has (data exposure, privilege escalation,
   funds at risk, denial of service, etc.).
4. Any suggested mitigation.
5. Your name / handle and how you would like to be credited, if at all.

Reports in any language are accepted; English is fastest for us to triage.

## Our response commitment

We aim for the following SLA, measured from the time the report reaches
`security@web3settle.com`:

| Severity | Acknowledgement | First assessment | Fix / mitigation |
|---|---|---|---|
| Critical (funds at risk, auth bypass, RCE) | ≤ 24 hours | ≤ 72 hours | Emergency patch or mitigation ≤ 7 days |
| High | ≤ 48 hours | ≤ 5 business days | Patch in next release (≤ 30 days) |
| Medium | ≤ 5 business days | ≤ 10 business days | Patch in next scheduled release |
| Low / informational | ≤ 10 business days | Best effort | Rolled into the backlog |

Severity is assessed on CVSS 3.1 with business-context adjustments (we consider
"funds movable by an unauthorised party" critical regardless of CVSS base).

You will receive updates at least every 7 days until the report is closed. If
we go silent for longer than that, please assume the message was lost and
re-send.

## Coordinated disclosure

- We prefer coordinated disclosure: we publish an advisory (GitHub Security
  Advisory, CVE where applicable, and a note in the relevant `CHANGELOG.md`)
  at the same time as, or shortly after, the fix is released.
- We aim to disclose within **90 days** of the report, or sooner once a fix
  is widely deployed. Extensions are negotiated if the fix requires coordinated
  rollout across multiple hosts.
- We will credit the reporter in the advisory unless they ask to remain
  anonymous. Hall of fame on request.

## Scope

**In scope** — report any issue you find in:

- All first-party repositories under the `web3settle` GitHub organisation:
  - `gateway-core-backend` (C# APIs + background workers)
  - `gateway-backoffice-portal`, `merchant-portal`, `merchant-integration-demo`
  - `merchant-sdk` (`@web3settle/merchant-sdk`)
  - `smart-contracts` (EVM, Solana, TRON)
  - `gateway-infra` (Docker, Kubernetes, deploy scripts)
  - `www-web3settle-com` (marketing site)
- Deployed production services under `*.web3settle.com` and the public
  Merchant Payment API (`/api/*` on the payment endpoint).
- Deployed smart contracts on Ethereum mainnet, Polygon, Base, Tron mainnet,
  and Solana mainnet-beta once addresses are published in
  `smart-contracts/DEPLOYMENTS.md`.

**Out of scope** — please do not report:

- Findings that require physical access to a user's device, or rely on a
  pre-compromised browser / OS / wallet.
- Social-engineering of our staff, customers, or partners.
- Issues in third-party dependencies that we have not modified (please report
  those upstream; we will track and backport fixes).
- Theoretical cryptographic weaknesses in well-reviewed primitives
  (secp256k1, Ed25519, SHA-256, AES-GCM) unless you have a concrete attack.
- Denial-of-service from volumetric traffic against public endpoints — we
  already rate-limit and expect upstream filtering; a proof-of-concept flood
  is not useful and may violate the safe harbor below.
- Missing low-impact security headers on the marketing site when the
  underlying content is static.
- Self-XSS, tab-nabbing, or clickjacking on pages without authenticated
  actions.
- Reports generated exclusively by automated scanners with no manual validation.

If you are unsure, err on the side of reporting. We would rather triage a
duplicate than miss something real.

## Safe harbor

If you make a good-faith effort to comply with this policy while researching
and reporting a vulnerability, we commit:

- Not to pursue or support legal action (including under the Computer Misuse
  Act 1990, the DMCA, the Computer Fraud and Abuse Act, or equivalents in
  your jurisdiction) against you.
- Not to contact law enforcement on the basis of the research itself.
- To work with you to understand and resolve the issue.

Good-faith testing means:

- Only using your own accounts or test accounts we have issued to you.
- Not accessing, modifying, or destroying data that does not belong to you
  beyond what is necessary to demonstrate the issue, and deleting any such
  data as soon as the proof is captured.
- Stopping and contacting us as soon as you identify the issue — don't keep
  probing.
- Respecting user privacy and not publicly disclosing the issue until we have
  released a fix or agreed to publication.
- Staying within the law of your jurisdiction.

This safe harbor does not authorise testing against infrastructure you know or
should know is operated by third parties (payment processors, cloud providers,
wallet vendors). Their own programs govern testing of their services.

## Bug bounty

We do not currently operate a paid bug bounty program. For sufficiently
impactful reports, we may offer acknowledgement in our Hall of Fame, a signed
thank-you note, Web3Settle-branded merchandise, or a discretionary reward —
but this is not guaranteed and should not be your motivation.

## Ongoing security practices

Visible in the repositories:

- **Static analysis.** `smart-contracts` CI runs Slither and Mythril on every
  PR. Findings and triage live in `smart-contracts/Audits/`.
- **Dependency auditing.** Every Node repo runs `npm audit --audit-level=high`
  and `actions/dependency-review-action@v4` on every PR. CI fails on high-
  severity advisories. The .NET solution uses the Microsoft Security Advisory
  feed via `dotnet list package --vulnerable` in CI.
- **Secret scanning.** Every Node repo runs TruffleHog (verified-only) on PR
  diffs. The `.gitignore` in `gateway-core-backend` excludes
  `appsettings.Production.json` and `.env*`.
- **Code scanning.** CodeQL runs security-and-quality queries on every PR.
- **Pinned toolchains.** `pragma solidity 0.8.24;` (no floating caret) in
  first-party contracts; `TreatWarningsAsErrors` on the .NET solution.
- **Secrets at runtime.** Production secrets come from HashiCorp Vault via
  the External Secrets Operator — see `gateway-infra/docs/VAULT_BOOTSTRAP.md`.
  Backend services fail-fast on startup if required secrets are missing or
  below minimum length.
- **Smart-contract audits.** A third-party audit by a reputable firm is
  tracked as a pre-sale milestone. The in-tree internal audit report lives at
  `smart-contracts/Audits/AUDIT_INTERNAL_SLITHER.md`; the automated companion
  is `smart-contracts/Audits/SLITHER_AUTOMATED_2026-04-16.md`.

## Changes to this policy

We version this document via the repository. Material changes will be called
out in the root `CHANGELOG.md`. Check the file's `git log` for the latest
revision.

---

_Last reviewed: 2026-04-17. Contact: security@web3settle.com._
