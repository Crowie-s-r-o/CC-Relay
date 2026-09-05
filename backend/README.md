# VibeIDE backend

An independent, self-hosted account and operations service. Django 5.2 LTS and
django-allauth provide email/password, verified email, password reset, Google OAuth,
TOTP, recovery codes, browser sessions and an application authentication API.
No paid authentication or analytics service is required. No project environment
variables are introduced. Configuration is `/app/config/runtime.json`, mounted as a
Kubernetes Secret directory.

## Deployment status

The service is deployed to `pati@144.76.107.210`, namespace `vibeide-dev`, as a private
ClusterIP service. Kubernetes namespace names cannot contain dots. `vibeide.dev` is
the intended public domain. See [the deployment record](../wiki/vibeide-backend.md)
for the actual image, checks and launch blockers.

Public launch still requires DNS, host reverse-proxy installation, a public TLS
certificate, this application's Google OAuth credentials, and SMTP configuration.
The domain currently resolves to a parking service. Existing email/password accounts
work privately. Email signup/recovery stay unavailable until SMTP is configured.
The Google button appears only after both OAuth credentials are configured.

The desktop Relay renderer and local task server have not been changed. This project
provides the account backend and app API for that integration. Existing installed
Relay versions do not yet require a VibeIDE login or automatically report app tries.
The backend does not expose local terminals, prompts, files or provider credentials.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Exactly empty `landing/index.html`, ready for the future landing page |
| `/accounts/login/` | Email login and configured Google login |
| `/accounts/signup/` | Email registration with mandatory verification |
| `/accounts/password/reset/` | Email recovery when configured |
| `/accounts/2fa/` | Authenticator and recovery-code management |
| `/account/` | Account, download and trial actions |
| `/admin/` | User access, account records and download configuration |
| `/admin/metrics/` | User totals, activity, downloads, tries and source funnel |
| `/downloads/latest/` | Counted redirect to the real latest Relay release |
| `/trial/` | CSRF-protected POST, records one trial start per verified account |
| `/_allauth/app/v1/` | Allauth authentication API for native clients |
| `/_allauth/browser/v1/` | Allauth authentication API for same-origin web clients |
| `/api/v1/me` | Authenticated app account and role |
| `/api/v1/events` | Authenticated, validated, idempotent app events |
| `/health` | Database and rate-limit cache readiness |

Browser forms use HttpOnly, Secure, SameSite=Lax cookies and CSRF tokens. Only use
HTTPS in production. Admin login follows the same rate-limited MFA flow as user
login. The initial admin must change the supplied password and enroll a TOTP
authenticator before accessing the dashboard. Keep the generated recovery codes.
No authenticator secret was pre-enrolled for the operator.

## Local setup

Python 3.10+ is supported; deployment uses Python 3.12. From `backend/`:

```sh
python3 -m venv .venv
.venv/bin/pip install --require-hashes -r requirements.txt
.venv/bin/python scripts/dev-config.py
.venv/bin/python manage.py migrate
.venv/bin/python manage.py collectstatic --noinput
.venv/bin/python manage.py runserver 127.0.0.1:8080 --noreload
.venv/bin/python manage.py test core
```

Development still has `DEBUG=False`; it relaxes HTTPS only for local work and uses
an in-memory cache. It must not be exposed publicly. The bootstrap command consumes
`{"email":"...","password":"..."}` from standard input. Supply it from a protected
file or password manager, never a shell argument. It creates only the first admin
and refuses to reset or promote an existing account. It marks the explicitly
provisioned owner address verified and requires a password change on first use.

`scripts/verify-ui.cjs` runs with the root project's Electron executable against a
synthetic local fixture on port 18080. The fixture is `operator@example.test`, the
synthetic password in `core/tests.py`, and an encrypted all-A TOTP test secret.
Never create this fixture in production. The script checks a real login, MFA,
account page, admin page, overflow, mobile layout and light/dark themes. It closes
its own Electron process and writes private captures to `.data/ui/`.

## Google and email configuration

Add these fields to the protected JSON configuration. Preserve `secret_key` exactly:
it also encrypts authenticator secrets. Do not commit the resulting file.

```json
{
  "google": {
    "client_id": "YOUR_APPLICATION_CLIENT_ID",
    "client_secret": "YOUR_APPLICATION_CLIENT_SECRET"
  },
  "smtp": {
    "host": "YOUR_SMTP_HOST",
    "port": 587,
    "username": "YOUR_SMTP_USERNAME",
    "password": "YOUR_SMTP_PASSWORD",
    "from_email": "VibeIDE <accounts@vibeide.dev>"
  }
}
```

Create a Google web application with the exact redirect URI
`https://vibeide.dev/accounts/google/login/callback/`. Publish its consent screen or
add approved test users while testing. Only profile and email scopes are requested.
OAuth uses state and S256 PKCE. Existing email accounts are not automatically linked
to a Google identity merely because the email strings match. Sign in to the existing
account and explicitly connect Google through Connected accounts.

SMTP requires STARTTLS. Configure the sending domain and verify actual message
delivery, then test signup, verification and password recovery with an address you
control. Missing SMTP never writes email tokens to logs and never pretends to send
mail. DNS and provider setup need the owner's external credentials.

Apply configuration using `kubectl create secret generic vibeide-config
--from-file=runtime.json=PROTECTED_FILE --dry-run=client -o yaml | kubectl apply -f -`
with the explicit namespace and kubeconfig on the server. Use secure stdin or a
0600 temporary file, remove it afterwards, and restart `deployment/vibeide`. Do not
run `provision-secrets.py` again to change settings. It refuses to rotate existing
secrets.

## App integration contract

1. POST JSON `{"email":"...","password":"..."}` to
   `/_allauth/app/v1/auth/login`. Follow the returned authentication flows if email
   verification or MFA is required. Store the latest `meta.session_token` in the
   operating system credential store, not localStorage or renderer state.
2. Send `X-Session-Token` to `/api/v1/me`. Cookie-only calls to the custom app API
   intentionally return 401. The API checks session expiry, the password session
   hash, active status, verified primary email, first-password change, and staff
   MFA enrollment. Tokens represent server sessions, not self-contained JWTs.
3. Use allauth's documented provider redirect/token flow for native Google sign-in.
   Open Google in the system browser and follow allauth's returned flow. No provider
   client secret belongs in a desktop binary. Test the final native callback route
   when implementing the desktop client, using the real OAuth client.
4. POST `{"kind":"app_try","idempotency_key":"UUID"}` to `/api/v1/events` for an
   intentional app try. `trial_started` is also accepted and starts only one trial
   record per account. Reuse the UUID after a timeout. Arbitrary event names, user
   IDs and server-generated funnel events are never accepted from the client.
5. DELETE `/_allauth/app/v1/auth/session` to log out, then erase the local token.
   Disabling a user or changing their password also invalidates access.

The API can protect server resources. A source-available local desktop app can be
modified by its owner, so local execution cannot be made unbypassable by a hosted
login check. Entitlements or paid trial enforcement are not invented here.

## Analytics semantics

- First-touch acquisition uses a signed HttpOnly visitor cookie for up to 90 days.
  Store only bounded `utm_source`, `utm_medium`, `utm_campaign` and referrer hostname.
  No full referrer URL, raw IP address, user agent, prompt or transcript is retained.
- Registration attaches that visit to the user. Native authenticated events reuse
  the saved source. First-touch source does not change on a later campaign visit.
- The funnel is a visitor cohort: first seen within the selected window, including
  its subsequent conversions. Counts are distinct per stage, so repeat clicks do
  not multiply visitors or signups. Headline totals are events within the window.
- Download numbers mean redirects, not completed bytes or installations. Attribution
  is user-reported and can be spoofed. App tries are authenticated client reports.
  Public browsing is not a bot-filtered or consent-management analytics service.
- Daily maintenance deletes analytics and visit links older than 90 days, clears
  expired sessions and keeps seven consistent daily database snapshots. Accounts
  and trial starts survive analytics retention. Backup copies can retain deleted
  analytics for up to seven additional days.

## Deployment and recovery

The Claude `/k8s-init` command supplies server and registry coordinates. This setup
uses a valid namespace name, Secret/config directory mounts, a private TLS service,
restricted containers and a PVC instead of exposing an unauthenticated NodePort or
mounting host directories. No global server or cluster configuration is changed.

```sh
.venv/bin/python scripts/provision-secrets.py  # first deployment only
./build-and-push.sh UNIQUE_RELEASE_TAG
```

Builds use `docker buildx --platform linux/amd64`; dependency versions and hashes and
base/sidecar image digests are pinned. Images are transferred over SSH to the
existing server registry. The registry tag must be unique per deployment. The
script renders manifests to `~/vibeide-dev-k8s/`, applies them and waits for rollout.
Migrations run in a restricted init container. SQLite requires one replica and
Recreate deployment. For sustained high write volume, migrate to PostgreSQL before
scaling replicas. Redis listens only on pod loopback, uses atomic rate counters,
and survives a container restart via AOF in emptyDir; a whole pod replacement resets
rate counters. The 64 MiB cache fails closed when full.

The host needs a new Nginx virtual host for `vibeide.dev`, using its existing TLS
infrastructure and proxying to `https://SERVICE_CLUSTER_IP:443`. The included
`host-nginx.conf` is a concrete installation template. Install the private upstream
CA from the `vibeide-tls` Secret's `tls.crt`, enable upstream certificate verification
and forward the actual client IP. Public HTTP must redirect to HTTPS. Do not expose
the private self-signed certificate as the public website certificate.

Read-only private check from a workstation, with port forwarding over SSH:

```sh
ssh -N -L 18443:10.98.39.77:443 pati@144.76.107.210
curl --cacert .data/internal-ca.crt --connect-to vibeide.dev:443:127.0.0.1:18443 https://vibeide.dev/health
```

Close the tunnel when finished. The CA is public trust material, not the private key.
The service IP is from this deployment; check it after recreating the Service.
Use direct SSH forwarding here: the server lacks `socat`, which its Kubernetes
runtime requires for `kubectl port-forward`.

Before an upgrade, run `python manage.py maintain` in the app container and copy the
new backup off the server through SSH into protected storage. The daily snapshots
share the database PVC and do not protect against disk/node loss. Back up both the
database and runtime secrets in encrypted off-host storage. Losing the application
secret prevents decrypting MFA data. Monitor CronJob failures and PVC usage.

To restore, scale the deployment to zero, restore a verified SQLite snapshot onto
the same PVC using a restricted maintenance pod, preserve the matching Secret, and
scale back to one. Verify `PRAGMA integrity_check` before resuming. An image rollback
alone does not reverse migrations. Current initial migrations are additive; future
schema changes must define backup and restore compatibility explicitly.

The existing Kubernetes 1.28 cluster is outside upstream support, and Flannel does
not enforce the supplied NetworkPolicy. Upgrade the cluster and adopt a
policy-capable CNI before claiming network isolation. The application workload has
no Kubernetes API token, no host mounts, no root, no Linux capabilities and no
public database/cache port. These controls reduce risk but do not make shared-host
compromise or volumetric denial of service impossible.

## References

- [django-allauth Google provider](https://docs.allauth.org/en/latest/socialaccount/providers/google.html)
- [allauth rate limits](https://docs.allauth.org/en/latest/common/rate_limits.html)
- [allauth headless API](https://docs.allauth.org/en/latest/headless/api.html)
- [allauth MFA configuration](https://docs.allauth.org/en/latest/mfa/configuration.html)
- [Kubernetes namespace names](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/)
