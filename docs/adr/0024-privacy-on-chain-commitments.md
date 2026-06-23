# ADR-0024 — Privacy: on-chain carries commitments, not content

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0022 (responsibility boundaries — Zone A/B data we protect, Zone C exposure we minimize); ADR-0023 (foreign-agent conformance — data-handling requirements declared there, specified here); ADR-0018 (composite content envelope — `specUri` / `inputs` payload, the main on-chain content surface); ADR-0008 amendment (settlement-as-receipt: on-chain = recorded fact); ADR-0006 (web topology — RPC proxy, consent-gated analytics); ADR-0020 (R2 artifacts, hosted preview/report).

## Context

Alex (2026-06-23): *"how do we protect the sensitive data of users who will use our services?"*

The honest current answer — verified against the code — is that **anything a user puts into a task is effectively public**:

- **`specUri` and `resultUri` are written ON-CHAIN, public and permanent.** The task brief and the result are inlined as `data:text/plain,{...}` or JSON directly into `TaskCreated` / `TaskCompleted` calldata (`TaskEscrowV2.sol` lines ~160, ~198; envelope per ADR-0018). Any block explorer reads them forever. There is no deletion mechanism on a public ledger.
- **R2 artifacts are public-by-hash.** `GET /api/artifacts/:sha256` requires no auth; the sha256 is unpredictable but the protection is secret-by-obscurity, not access control. No encryption. 30-day TTL. 10 MB cap, mime-whitelisted (`worker-gateway/.../artifacts.ts`).
- **LLM providers (OpenAI / Anthropic) see raw content.**
- **Foreign agents receive raw task content** (`specUri` / `inputs`) — third parties processing user data on their own hosts.
- **No formal privacy posture, no encryption of user content.**

What is already good: RPC proxy hides `ALCHEMY_KEY` (browsers never see it); analytics is consent-gated and anonymous (`$process_person_profile:false`, random `run_id`); previews/reports are `noindex` + CSP-sandboxed; content-addressing gives end-to-end integrity; 1 MB request cap; no secrets in logs; report rendering HTML-escapes untrusted LLM output.

For a public demo on Base mainnet this is acceptable and even appropriate (the whole point is a *visible* settlement artifact). For real users with sensitive briefs it is not, and it interacts badly with the law: **on-chain data cannot be erased**, so putting erasure-eligible personal data on-chain is a structural GDPR/right-to-be-forgotten violation, not a fixable bug.

## Decision

Adopt one unifying principle: **the public ledger carries proof, not content.**

1. **On-chain = commitments, off-chain = content.** Replace inlined `data:...,{brief}` / `{result}` in `specUri` / `resultUri` with a **hash-commitment** on-chain; keep the actual content off-chain. The chain records *that* the work happened and *its commitment* (settlement-as-receipt, ADR-0008), not the content. This is the single highest-leverage change and it also makes the system GDPR-shaped: erasure-eligible data never lands somewhere it cannot be erased.

2. **Off-chain content is encrypted.** Task content and artifacts are stored encrypted at rest, with keys shared only among the parties to the task (client, executor, and any evaluator). Content-addressing of the **ciphertext** preserves the integrity/verifiability property. R2's current plaintext-public-by-hash storage is the gap this closes.

3. **Least-privilege agent envelope.** A (foreign) agent receives only the data its sub-task needs, not the whole brief. The ADR-0018 `inputs` channel is scoped to least-privilege; redaction / field-level access is the default. The less a foreign host sees, the smaller the leak surface (ties to ADR-0023 Zone-C minimization).

4. **Declared data handling, contractually accepted (Zone C).** Foreign agents declare and accept data-handling terms in their manifest (ADR-0023 Layer 2.5): no retention beyond the task, no secondary use, declared sub-processors / LLM provider. Sage cannot technically enforce this on a foreign host, so it (a) requires the declaration, (b) bounds exposure via 2+3, (c) treats violations as dispute/reputation events.

5. **Provider-level handling for sensitive data.** Use zero-retention / no-training API tiers for OpenAI / Anthropic where available; self-hosted models are an option for first-party (Zone A) agents handling sensitive content.

6. **Explicit retention & deletion off-chain; never erasure-eligible data on-chain.** Off-chain content carries an explicit TTL and a deletion path. On-chain carries only commitments + settlement facts (addresses, amounts, hashes, timestamps, status) which are non-erasable *by design and disclosed as such*.

7. **A stated privacy posture.** A clear, public statement of what is public (on-chain settlement facts) vs private (content, encrypted off-chain), retention windows, and sub-processors — before any real (non-demo) users.

The current demo (plaintext on-chain, public-by-hash R2) remains acceptable **for the demo** and is explicitly labeled as such; this ADR governs the path to real-user data.

## Rationale

- **It is the natural shape of a settlement protocol.** "Record the fact, not the content" is exactly ADR-0008's settlement-as-receipt. Privacy and the existing positioning point the same way.
- **On-chain permanence makes content placement irreversible.** The only safe rule is to never put erasable-required data there. A hash-commitment gives auditability without the liability.
- **Defense in depth across the trust boundary.** Encryption (2) + least-privilege (3) + declarations (4) mean a foreign host sees the minimum, encrypted where it doesn't need plaintext, under stated terms — the strongest posture achievable when you don't control the host (ADR-0022 Zone C).
- **Verifiability is preserved.** Content-addressing the ciphertext keeps the integrity guarantee that makes the artifact trustworthy.
- **It is a differentiator.** "Private-by-construction settlement" — public proof, encrypted off-chain content, least-privilege agent envelopes — is an angle most agent-payment neighbours ignore (they either dump content on-chain or don't address it).

## Alternatives considered

### Option A — Keep content on-chain, rely on the chain being "just hashes anyway"
- Pros: zero work; maximally transparent/auditable; matches current demo.
- Cons: false premise — current `specUri`/`resultUri` carry *plaintext*, not hashes; permanent public exposure of user briefs; structural GDPR violation; unacceptable for sensitive data.
- Rejected because: it is the very problem this ADR exists to fix.

### Option B — Off-chain content, but plaintext public-by-hash (today's R2 model, extended to all content)
- Pros: simple; content-addressed; already implemented for artifacts.
- Cons: secret-by-obscurity is not access control; anyone who learns a hash reads the content; no party-scoped confidentiality; still unacceptable for sensitive data.
- Rejected because: it protects nothing once a hash leaks.

### Option C — On-chain commitments + encrypted off-chain content + least-privilege envelope (chosen)
- Pros: auditable without exposure; GDPR-shaped; confidential to the parties; verifiable via ciphertext addressing; differentiating.
- Cons: real engineering (key management, encrypted storage, envelope scoping, retention/deletion); demo must be clearly separated from the real-user path.
- Rejected because: nothing — this is the decision.

## Consequences

**Положительные:**
- User briefs and results stop being permanently public; the chain keeps only proof.
- Right-to-erasure becomes achievable (off-chain deletion + non-personal on-chain commitments).
- Foreign-host exposure is minimized and encrypted, under declared terms.
- Sage gains a "private-by-construction" angle consistent with its positioning.

**Отрицательные / компромиссы:**
- Key management is now a first-class problem (who holds keys, how the evaluator gets scoped access, rotation, recovery). This is the hard part.
- The demo's appeal partly *is* that you can read everything on a block explorer; the real-user path deliberately gives that up, so the two paths diverge and must be clearly labeled.
- Encrypted, party-scoped artifacts complicate the hosted preview/report feature (ADR-0020) — public preview only makes sense for content the parties chose to publish.
- Engineering cost across contracts (commitment in `specUri`/`resultUri`), gateway (encrypted R2, access control), envelope (ADR-0018 scoping), and SDK (encrypt/decrypt helpers).

**Что потребует дальнейшего решения:**
- The key-management scheme (per-task symmetric key wrapped to party keys? threshold? KMS?) — likely its own ADR.
- Whether commitments use plain sha256 or a richer scheme (encrypt-then-hash, Merkle for multi-part).
- How evaluators (ADR-0020) get scoped decryption without breaking least-privilege.
- The public privacy statement / Terms (legal-review territory; separate from this internal ADR) before real users.
- Smaller hardening already noted in the 2026-06-09 review: R2 access logging, key rotation for Fly secrets, dispute-timeout so `Disputed` funds don't freeze (cross-refs ADR-0017).

## Implementation notes

Staged, each independently shippable:
1. **Separate demo vs real-user path explicitly** — label the current plaintext-on-chain flow as demo-only; gate any real-user intake behind the new model.
2. **Least-privilege envelope** (ADR-0018 scoping) — lowest-cost first step; reduce what each worker receives.
3. **Encrypted off-chain content + commitments on-chain** — the core change; touches `TaskEscrow*` payload conventions, gateway R2 path, `@sage/core` encrypt/decrypt helpers, and the `specUri`/`resultUri` encoding.
4. **Key management** — the gating hard problem; own ADR.
5. **Provider zero-retention tiers + data-handling declarations** (ADR-0023 manifest) — config + conformance.
6. **Retention/deletion + access logging + key rotation** — operational hardening.

## References

- ADR-0022 (responsibility zones); ADR-0023 (data-handling declarations / Zone-C minimization).
- ADR-0008 amendment (settlement-as-receipt: recorded fact); ADR-0018 (content envelope); ADR-0006 (RPC proxy, consent-gated analytics); ADR-0020 (R2 artifacts, preview/report).
- `packages/contracts/src/TaskEscrowV2.sol` (`specUri`/`resultUri`); `apps/worker-gateway/src/artifacts.ts`, `preview.ts`, `report.ts`; `apps/demo-agents/src/shared/sse.ts` (5-min TTL).
- `docs/architecture/security-checklist.md`; 2026-06-09 code review (`docs/reviews/2026-06-09-code-review.md`).
