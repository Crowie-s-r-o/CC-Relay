---
name: VibeIDE Backend Security Review
description: Adversarial review of hosted identity, operator access, analytics and the private deployment.
type: review
tags:
  - relay
  - review
  - security
---

# VibeIDE backend security review

## Executive Summary

**Ticket confidence: Medium**

The backend and private deployment are verified. Public launch and installed-client
login are incomplete. [[vibeide-backend]] records the live state and concrete
external launch requirements. This review was performed directly in the current
session, without delegated agents, using the review-crowie workflow.

## Quality Panel (RAG)

| Area | Rating | Evidence |
| --- | --- | --- |
| Functional correctness | Green | `core/tests.py`: 25 checks on both local Python and the actual Linux image. Live TLS login/logout and initial-password guard passed. |
| Regression risk (UI / backend / contracts) | Green | New independent `backend/` project; Relay source and desktop packaging unchanged. Full Node suite and release check passed. |
| Gap risk (edge cases, error handling, completeness) | Amber | Missing public DNS/TLS/proxy activation, Google OAuth and SMTP credentials. Live provider/email delivery tests remain necessary. Desktop client does not consume the API yet. |
| Code quality (maintainability as safety) | Green | Password, OAuth, MFA and recovery flows stay in pinned allauth. Custom code handles bounded telemetry, explicit permission checks and deployment boundaries. |
| Unit tests | Green | Meaningful adversarial tests cover authentication stages, password invalidation, expiry, inactive/unverified users, duplicate telemetry and exact cohort counts. |
| Performance & scalability | Amber | Single-node SQLite and one replica; bounded request/visitor/event creation and 90-day cleanup reduce load, but not a large-scale load or volumetric DDoS test. |

## Top 3 Risks

1. **Shared legacy cluster.** `k8s/networkpolicy.yaml` is unenforced under Flannel.
   Kubernetes 1.28.15 and node-wide compromise remain outside namespace protections.
2. **Public integration dependencies.** `vibeide/settings.py`, `host-nginx.conf` and
   `core/context.py` deliberately leave unavailable providers/SMTP closed. DNS and
   public proxy/certificate setup require external changes. Real Google and email
   delivery have not been claimed as tested.
3. **Single disk and capacity.** `k8s/pvc.yaml` and `maintain.py` use one local-path
   volume; daily local snapshots cannot cover a lost node. The initial off-server
   snapshot was verified, but ongoing encrypted off-server automation is outstanding.

## Top Improvements

- Activate and verify DNS, public TLS, SMTP and Google using app-specific credentials.
- Upgrade the cluster and enable actual policy enforcement, then probe isolation.
- Add recurring encrypted off-server database/Secret backup and restoration checks;
  migrate SQLite to PostgreSQL before scaling writers or replicas.

## Recommendation

**Ship with Mitigations: private deployment only.** Public activation remains blocked
by the items above. Do not describe installed Relay clients as login-gated or claim
completed downloads/installs from redirect metrics.

## Confirmed Issues

All code issues found in scope were fixed: missing Host validation on the zero-byte
landing route, proxy temp paths on the read-only root, Gunicorn's unused control
socket path, proxy-only app liveness, and unavailable recovery links on login.
Each has focused or actual deployment/browser evidence in [[vibeide-backend]].

## Suspected Issues & Edge Cases

- Real email delivery can fail after account creation; the unverified account must
  complete the existing resend/verification flow once SMTP is restored.
- Incoming source tags and authenticated app tries can still be fabricated by their
  senders. The dashboard labels this limitation; these are not billing evidence.
- Rate counters survive a Redis container restart but reset on pod replacement.

## Regression Risks

There are no edits to the local app execution path. Authentication becomes a separate
server-side contract for a later client integration. Existing local CLI credentials
and open tasks retain their current behavior.

## Performance Risks

Argon2 is intentionally expensive; two worker processes and HTTP/authentication
throttles bound simultaneous work. Dashboard output is capped at 100 source groups
and 50 recent events, but SQL aggregates still scan the retained window. SQLite
write serialization and a single node limit throughput and availability. Network
bandwidth exhaustion cannot be solved by application rate limits alone.

## Test Gaps

**Adequate unit tests: Yes for the implemented backend contracts.** Remaining gaps
are real external integrations: Google consent/client setup, actual SMTP delivery,
public browser TLS, eventual desktop callbacks/credential storage, sustained load,
policy-capable CNI enforcement and an operator-led disaster recovery exercise.

## Positive Improvements

The backend has mature verified-email/OAuth/MFA flows, password-hash session
revocation, explicit role gates, no account auto-link by matching email, no generic
client event forgery, atomic trial/event deduplication, auditable admin changes,
private TLS, non-root restricted containers, no host mounts or Kubernetes token,
and a documented distinction between observed metrics and inferred outcomes.

#relay #review #security
