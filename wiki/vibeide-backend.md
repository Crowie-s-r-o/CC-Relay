---
name: VibeIDE Account Backend
description: Independent hosted authentication, operations analytics, private Kubernetes deployment and public launch dependencies.
type: decision
tags:
  - relay
  - authentication
  - security
  - deployment
---

# VibeIDE account backend

The September 5 request adds a separate backend project under `backend/`, an exactly
empty hosted landing file, email and Google authentication support, an initial
administrator, user management and acquisition/activity metrics. Its full operating
guide is [[../backend/README|backend/README.md]]. Related product context:
[[landing-page-build-prompt]], [[core-product-story]] and [[licensing]].

## Deployment record

| Item | Verified value |
| --- | --- |
| Server | `pati@144.76.107.210` |
| Namespace | `vibeide-dev`; namespace names cannot contain dots |
| Deployment | `vibeide`, one replica, Recreate strategy |
| Image | `localhost:5000/vibeide:20260905-5` |
| Runtime | Python 3.12, Django 5.2.17, django-allauth 65.19.2 |
| Service | Private `10.98.39.77:443`, ClusterIP |
| Containers | app, TLS proxy, loopback Redis; 3/3 Ready, zero restarts at final check |
| Storage | 5 GiB local-path PVC `vibeide-data` |
| Configuration | Secret `vibeide-config`, directory-mounted JSON, no environment variables |
| TLS | Secret `vibeide-tls`, internal certificate; public CA certificate is in the local ignored `.data/` directory and remote deployment directory |
| Daily maintenance | `vibeide-maintenance`, 02:17 UTC, seven daily SQLite snapshots and 90-day analytics retention |
| Server manifests | `/home/pati/vibeide-dev-k8s/` |
| Operator | `patrik.kelemen@crowie.io`, active staff and superuser, verified owner email |

The supplied password was passed through stdin, hashed with Argon2, and tested by
logging in over verified private TLS. It is not stored in source or documentation.
The owner must change it and enroll a TOTP authenticator before admin access. No
TOTP secret was created on behalf of the owner. The bootstrap command refuses to
reset an existing account or create a second bootstrap administrator.

> [!important]
> **This is a private deployment, not a live public launch.** `vibeide.dev` resolved
> to Namecheap parking (`192.64.119.73`) during verification. The SSH account can
> deploy Kubernetes workloads but cannot use unattended sudo to install the host
> Nginx virtual host. Public DNS, public TLS and host proxy activation remain
> necessary. The concrete `host-nginx.conf` and internal upstream CA are staged in
> `/home/pati/vibeide-dev-k8s/`. Application-specific Google OAuth and SMTP
> credentials were not supplied; public email signup/recovery and the Google
> button remain disabled until configuration. Existing email/password login works.

> [!note]
> The existing desktop renderer and local task server are unchanged. The service
> supplies allauth browser/native authentication APIs and `/api/v1/me` and
> `/api/v1/events`. Desktop sign-in UI and automatic app-try reporting are future
> integration work. Source-available local execution cannot be protected against
> an owner editing their own client by adding a hosted login check alone.

## Architecture and security decisions

- Use mature Django/allauth account flows rather than new password/OAuth machinery.
  Email signup requires verification. Recovery tokens, MFA, Google state and S256
  PKCE use allauth. Existing email accounts never auto-link to Google on email match.
- Keep the hosted backend independent of Relay's loopback task and provider server.
  No prompts, terminal sessions, provider credentials or local task files are sent.
- Browser sessions and CSRF cookies use Secure/HttpOnly/host-only settings. Unsafe
  browser writes need CSRF. Native custom API requests require X-Session-Token and
  verify the current password session hash, expiry, active status and verified email.
- Admin views use allauth login, mandatory initial password rotation and staff MFA
  enrollment. User mutations require superuser access and the final active admin
  cannot be removed. MFA secrets and provider credentials are hidden from generic
  model administration. MFA secrets are encrypted using the mounted application key.
- Allauth authentication limits and atomic shared Redis request/event limits bound
  abuse. Limits use keyed hashes of IP addresses, not raw IP retention. New visitor
  creation and authenticated telemetry have separate limits. Whole pod replacement
  resets rate counters; a Redis container restart retains its local AOF.
- SQLite is a low-cost one-replica starting point. Immediate write transactions and
  bounded workers prevent unsafe multiwriter scale-out. PostgreSQL is the next step
  before more replicas or sustained write load.
- Containers run as UID/GID 10001, drop all capabilities, use RuntimeDefault seccomp,
  read-only roots, bounded temporary volumes and no service-account token. Redis and
  Gunicorn bind only to pod loopback. The proxy exposes private TLS only.
- Dependencies have pinned versions and hashes; base/sidecar images have digest pins.
  No hostPath or public NodePort was added. No existing cluster workload was changed.

## Analytics contract

The source funnel preserves first-touch source, medium, campaign and referrer
hostname in a signed visitor cookie and database visit. Registration attaches it to
the account. Visitors are deduplicated within each funnel stage, including repeated
download redirects. Cohorts are anchored to the first-visit date; headline counters
are events within the selected 1/7/30/90-day window.

Downloads mean clicks redirected to the allowlisted Relay GitHub release URL,
not completed transfers. Trials are a one-time interest record, with no invented
licensing duration or payment implications. App tries are authenticated client
reports with UUID retry deduplication. Public clients cannot fabricate server event
kinds or assign an event to another user. Referral tags are still self-reported.

Raw analytics and visit links expire after 90 days. Accounts and trial records
remain. Seven daily backups can retain expired analytics for another seven days.
No raw IP, full referring URL, user agent, prompt or transcript is stored.

## Verification and extra pass

- 25 focused backend tests passed on local Python 3.10 and inside the actual Linux
  Python 3.12 image under a read-only filesystem. Coverage includes email signup,
  confirmation, password recovery, CSRF, role escalation, token expiry/password
  invalidation, inactive/unverified accounts, partial authentication, OAuth state,
  S256 PKCE, unsafe redirects, throttling, admin restrictions and funnel arithmetic.
- Dependency audit returned no known vulnerabilities. Production
  `manage.py check --deploy --fail-level WARNING` passed with zero issues.
- Full root `npm test -- --test-reporter=dot` and `npm run release:check` passed;
  release metadata remains v0.2.38. No version or changelog was edited.
- Real Electron browser checks completed email login and TOTP using an isolated
  synthetic local account, then inspected account/admin pages in desktop/mobile,
  light/dark themes. Six screenshots were inspected. Test browser processes closed.
- `scripts/verify-deployment.py` tested the real private service over CA-verified
  TLS: health, zero-byte landing, HSTS, frame policy, hostile Host rejection,
  anonymous API/admin denial, CSRF, operator email login, secure session cookies,
  initial-password gate and logout.
- Daily maintenance ran successfully. A consistent snapshot was copied off-server
  to ignored, mode-0600 `.data/initial-server-backup.sqlite3`; SQLite integrity and
  the single active superuser were verified without printing account data.
- A real Job created from the deployed maintenance CronJob also completed, proving
  its restricted container, Secret mount and PVC access. The temporary Job was
  deleted after verification. The staged host proxy canonicalizes `www` to the
  apex domain so browser CSRF origins and Google callbacks remain consistent.
- The extra pass found that setting ALLOWED_HOSTS alone did not validate the empty
  landing route. Boundary middleware now calls `request.get_host()` explicitly;
  both a focused test and the deployed HTTP check reject a hostile Host.
- Read-only deployment testing found Nginx default temporary directories and the
  new Gunicorn control socket attempted writes outside `/tmp`. All proxy temporary
  paths now use `/tmp`; the unused Gunicorn control socket is disabled.
- App liveness now checks the app/database/cache, not merely the proxy socket.
  Missing-email links on login were replaced by a clear availability message.

## Operational gotchas

The cluster is Kubernetes 1.28.15 with Flannel. Its NetworkPolicy resources are not
evidence of enforced network segmentation. The included policy describes desired
boundaries for a future compatible CNI. The server requires an upgrade before it
can reasonably be called a current, supported hardened platform.

`kubectl port-forward` fails because the server runtime lacks `socat`. Use direct
SSH forwarding to the ClusterIP, as documented in the backend README. No host
package was installed or sudo restriction bypassed. All temporary SSH forwards,
remote port-forward processes and local test servers are stopped after verification;
the intentionally deployed application and scheduled maintenance remain running.

Backups on the same PVC do not survive host/disk failure. Persist off-host encrypted
database and Secret backups before launch, and test restore with matching secrets.
Do not regenerate the application key during deployment: it encrypts MFA material.
The initial self-signed internal transport certificate expires after one year and
needs coordinated rotation with the host proxy's trusted CA.

See [[vibeide-backend-review]] for the adversarial review and launch recommendation.

#relay #authentication #security #deployment
