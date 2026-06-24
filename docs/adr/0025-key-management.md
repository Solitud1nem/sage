# ADR-0025 — Key management: per-subtask DEK, ECIES-wrapped to party keys

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0024 (privacy: on-chain commitments not content — names key management as "the gating hard problem"; this ADR resolves it); ADR-0023 (foreign-agent conformance — least-privilege / Zone-C minimization the envelope realises); ADR-0022 (responsibility zones — Sage-the-protocol must not become a trusted reader); ADR-0018 (composite content envelope — `specUri` / `inputs` / `resultUri`, the payload this encrypts); ADR-0008 amendment (settlement-as-receipt: chain records the fact + commitment, not content); ADR-0001 (CREATE3 deterministic identity); ADR-0017 (arbitration — disputes need the evaluator to read content).

## Context

ADR-0024 decided the principle — **the public ledger carries proof, not content** — and explicitly deferred the hard part: *"The key-management scheme (per-task symmetric key wrapped to party keys? threshold? KMS?) — likely its own ADR."* This is that ADR.

The constraints that key management must satisfy in Sage:

- **No trusted reader.** The whole posture of ADR-0022/0024 is that Sage-the-protocol (gateway, R2, indexer) never sees plaintext. Any scheme that hands a Sage-operated component the decryption key — a KMS, a key-escrow, a gateway re-wrap service — re-introduces exactly the trusted reader the model exists to remove. The gateway and R2 must see **ciphertext only**.
- **Parties are EVM accounts.** Client (task creator), executor (agent), and any evaluator are all addressed by EVM accounts and already hold secp256k1 keys. They sign on-chain; their pubkeys are recoverable from any signature they have produced.
- **Evaluators are assigned dynamically.** Per ADR-0017/0019/0020 an evaluator (`evaluates`-step) judges a specific sub-task and must read *that sub-task's* content to render a verdict — but per least-privilege (ADR-0024 §3) it must read **only** that sub-task, not the whole run.
- **Foreign executors process sub-tasks on their own hosts** (ADR-0023 Zone C). A foreign executor of sub-task X should not be able to read sub-task Y. The smaller what a foreign host sees, the smaller the leak.
- **Content is content-addressed** (ADR-0020) — integrity/verifiability comes from addressing the artifact by its sha256. Encryption must preserve this.
- **Recovery is not a requirement.** Task content is ephemeral (TTL-bounded off-chain, ADR-0024 §6). Losing a key loses access to that task's content — acceptable, and far preferable to standing up a recovery oracle that becomes a trusted reader.

Two decisions shape the SDK surface and whether the on-chain registry changes; both were taken with Alex 2026-06-24 and are recorded below as the chosen options.

## Decision

Adopt an **envelope encryption** scheme:

1. **Per-sub-task data-encryption key (DEK).** Each unit of content (one sub-task's `spec` / `inputs` / `result`) is encrypted under a freshly generated random 256-bit DEK with **AES-256-GCM** (AEAD: confidentiality + integrity, random 96-bit nonce per encryption). One DEK per sub-task, **not** one per run — so a foreign executor or evaluator scoped to sub-task X is cryptographically unable to read sub-task Y.

2. **Ciphertext is content-addressed; the commitment is `sha256(ciphertext)`.** The artifact is stored and fetched by the hash of its ciphertext (R2 path unchanged in shape, ADR-0020). The on-chain `specUri` / `resultUri` carry that hash-commitment (a `sage://sha256/<hex>` reference), never the content. Integrity/verifiability is preserved end-to-end: the puller checks the hash before decrypting.

3. **DEK is ECIES-wrapped to each party's key (v1: reuse the secp256k1 wallet key).** For each party that must read a sub-task, the DEK is wrapped using ECIES over secp256k1: ephemeral-static ECDH against the party's wallet pubkey → HKDF → KEK → AES-256-GCM-wrap of the DEK. **v1 reuses the existing on-chain wallet key** (zero new PKI; pubkey recovered from any signature the party has produced — executors have signed txs, the client signs `TaskCreated`). The crypto-hygiene caveat (a signing key now also decrypts) is accepted for v1 and documented; **v2 migrates to a dedicated X25519 encryption key published in the agent manifest** (clean signing≠encryption separation), without changing the envelope shape — only the wrap primitive and key source.

4. **Wrapped-DEK envelope lives next to the ciphertext, off-chain.** The artifact carries `{ alg, nonce, ciphertext-hash, wraps: { <party-address>: <wrapped-DEK> } }`. On-chain stays minimal: commitment + settlement facts only. The gateway/R2 store and serve this blob without ever holding a key that decrypts it.

5. **Evaluator scoped access by re-wrap at assignment.** When an evaluator is assigned to a sub-task, the party that holds the DEK (the client — author of the content) wraps **that sub-task's DEK** to the evaluator's key and adds it to that artifact's `wraps`. The evaluator thereby decrypts only the sub-task(s) it evaluates — least-privilege preserved across the referee boundary (ADR-0022 Zone B).

6. **No recovery, no escrow, no KMS.** Keys are held only by the parties. Per-task DEKs are ephemeral; long-lived wallet/enc keys rotate at the party's discretion (old ciphertexts remain decryptable with the old key until their TTL expires). There is deliberately no path by which Sage can recover or read content.

The demo path (plaintext on-chain, public-by-hash R2) is unaffected and stays demo-only per ADR-0024 §M13.4.1; this scheme governs the real-user path.

## Rationale

- **No trusted reader, by construction.** Only client/executor/(scoped)evaluator ever hold a DEK; gateway, R2, and indexer see ciphertext + opaque wrapped blobs. This is the only scheme on the table that keeps the Zone A/B/C trust model intact — KMS/threshold/escrow all create a reader Sage operates.
- **Reuse of on-chain identity = ship today, zero PKI.** secp256k1 ECDH against keys the parties already hold means no registry change, no key-distribution problem, no new rotation surface for v1. Pubkeys are already recoverable from the signatures these accounts produce.
- **Per-sub-task DEK makes least-privilege cryptographic, not procedural.** ADR-0024 §3 / ADR-0023 Zone-C want a foreign host to see the minimum. Per-run keys make that a delivery-layer promise an attacker can bypass by reading the run blob; per-sub-task keys make it a property of the math.
- **Ciphertext addressing keeps the integrity guarantee** that makes the artifact trustworthy (ADR-0020) — verify-then-decrypt, content-addressed as before.
- **Recovery-free is the honest fit.** Content is ephemeral and TTL-bounded; a recovery oracle would be a permanent trusted reader guarding throwaway data — a bad trade. Lost key = lost ephemeral content, disclosed as such.
- **Migration path is clean.** v1→v2 (X25519 enc-key in manifest) changes only the wrap primitive + key source; the envelope, DEK, addressing, and re-wrap flow are unchanged, so v2 is additive.

## Alternatives considered

### Option A — Gateway/KMS-held keys (server-side envelope)
- Pros: trivial recovery; simple evaluator access (gateway re-wraps on demand); no client-side crypto.
- Cons: the gateway becomes able to decrypt all content — exactly the trusted reader ADR-0022/0024 exist to eliminate; a single compromise exposes every task.
- Rejected because: it defeats the entire privacy posture; "Sage cannot read your content" is the property we are buying.

### Option B — Per-run DEK (one key per task)
- Pros: simplest — one key, one wrap per party; one re-wrap for an evaluator.
- Cons: any party with access reads the whole run; a foreign executor of one sub-task can read every other sub-task's content; least-privilege degrades to a delivery-layer convention, not a cryptographic boundary.
- Rejected because: it contradicts ADR-0024 §3 / ADR-0023 Zone-C minimization, which is most of the point of encrypting at all.

### Option C — Dedicated X25519 encryption keys from day one
- Pros: clean signing≠encryption separation (best hygiene); modern curve.
- Cons: new PKI — agents must generate, publish (AgentRegistryV2 / manifest change), and rotate a second key; ad-hoc clients with no registry entry need a separate key-distribution path; more to build before any privacy ships.
- Deferred (not rejected) to **v2**: the v1 envelope is designed so adopting X25519 changes only the wrap primitive and key source. We take the hygiene caveat now to ship the structural win (content off-chain, encrypted, least-privilege) sooner.

### Option D — Threshold / MPC key splitting
- Pros: no single party holds a full key; flexible policies.
- Cons: heavy machinery; needs a quorum of online participants to decrypt (breaks the simple client/executor read path); large engineering and operational surface for a property we don't need.
- Rejected because: disproportionate to the problem; the party set per task is small and known.

## Consequences

**Положительные:**
- Real-user content stops being public; the chain keeps only commitment + settlement facts (GDPR-shaped, ADR-0024).
- Sage-the-protocol provably cannot read user content — a concrete "private-by-construction" angle, not a policy promise.
- Least-privilege becomes cryptographic: a foreign executor sees only its sub-task; an evaluator sees only what it judges.
- Verifiability preserved via ciphertext addressing.
- v1 ships with no registry change and no new key infrastructure.

**Отрицательные / компромиссы:**
- v1 reuses the signing key for decryption — a documented hygiene compromise, resolved in v2.
- Per-sub-task keys mean more DEKs and more wrap operations (O(sub-tasks × parties)); negligible at demo/early scale, noted for later.
- No recovery: a lost key permanently loses that task's content (acceptable — ephemeral, TTL-bounded).
- Re-wrap-at-assignment requires the client (DEK holder) to be reachable when an evaluator is added; if disputes can assign evaluators after the client goes offline, the executor (also a DEK holder) must be able to perform the re-wrap — to be confirmed in implementation against the ADR-0017 dispute flow.
- Encrypted, party-scoped artifacts complicate the public preview/report feature (ADR-0020): hosted preview only applies to content the parties explicitly chose to publish (publish = store an additional plaintext or world-readable copy).

**Что потребует дальнейшего решения:**
- v2 X25519 enc-key: where it is published (AgentRegistryV2 field vs off-chain manifest), and rotation policy.
- Exact ECIES construction details (HKDF salt/info domain-separation, nonce discipline) — pin to a vetted library, not hand-rolled.
- Who performs the evaluator re-wrap in the dispute path when the client is offline (client vs executor vs a pre-authorized wrap at task creation for the declared evaluator).
- Whether the commitment is plain `sha256(ciphertext)` or binds plaintext too (encrypt-then-hash is already plaintext-independent; revisit only if a plaintext binding is needed for a specific verification).
- Ad-hoc (non-registered) client key distribution under v2.

## Implementation notes

Not built in this ADR (design-only, per the privacy track decision 2026-06-24). When implemented (ADR-0024 §M13.4.3), staged:

1. **`@sage/core` crypto helpers** — `encryptContent(plaintext, recipientPubkeys[]) → { ciphertext, envelope }`, `decryptContent(ciphertext, envelope, privkey)`, `rewrapDEK(envelope, dekHolderPrivkey, newRecipientPubkey)`. Built on a vetted ECIES-secp256k1 + AES-256-GCM library; no hand-rolled crypto.
2. **Pubkey recovery helper** — recover a party's secp256k1 pubkey from a known on-chain signature (or a one-time "publish pubkey" handshake) for parties whose pubkey isn't yet observed.
3. **Envelope format** — `{ v, alg: "ecies-secp256k1+aes-256-gcm", nonce, ciphertextSha256, wraps: { <addr>: <wrappedDEK> } }`, stored beside the ciphertext in R2.
4. **`specUri` / `resultUri` encoding** — `sage://sha256/<hex>` commitment reference (replaces inlined `data:...`), ADR-0018 envelope updated; gateway R2 path serves ciphertext + envelope.
5. **Evaluator re-wrap hook** — in the plan-runner at `evaluates`-assignment, the DEK holder re-wraps the judged sub-task's DEK to the evaluator key.
6. **Demo/real-user gate** (ADR-0024 §M13.4.1) — keep the plaintext demo path explicitly labeled; route real-user intake through the encrypted path.

## References

- ADR-0024 (privacy principle; names key management as the deferred hard problem); ADR-0023 (Zone-C minimization / conformance); ADR-0022 (responsibility zones / no trusted reader); ADR-0018 (content envelope); ADR-0020 (R2 artifacts, content-addressing, preview/report); ADR-0017 (arbitration / evaluator reads content).
- `packages/contracts/src/TaskEscrowV2.sol` (`specUri`/`resultUri`); `apps/worker-gateway/src/artifacts.ts`; `packages/core` (future encrypt/decrypt helpers); `apps/demo-agents/src/parent/` (plan-runner, evaluator assignment).
- `TASKS.md` Milestone 13 §13.4 (privacy track); `docs/architecture/security-checklist.md`.
