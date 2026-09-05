import io
import json
import re
import uuid
from datetime import timedelta
from unittest.mock import patch
from django.conf import settings
from django.contrib.auth import SESSION_KEY, BACKEND_SESSION_KEY, HASH_SESSION_KEY
from django.core import mail, signing
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.management import call_command, CommandError
from django.db import IntegrityError, transaction
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from allauth.account.models import EmailAddress
from allauth.mfa.models import Authenticator
from .adapters import MFAAdapter
from .models import Download, Event, Trial, User, Visit

PASSWORD = "Synthetic-Fixture-739!long"


class BackendTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("person@example.test", PASSWORD)
        EmailAddress.objects.create(user=self.user, email=self.user.email, verified=True, primary=True)

    def token(self, user=None):
        user = user or self.user
        client = Client()
        client.force_login(user, backend="django.contrib.auth.backends.ModelBackend")
        return client.session.session_key

    def test_empty_landing_and_security_headers(self):
        response = self.client.get("/")
        self.assertEqual(response.content, b"")
        self.assertEqual(response["X-Frame-Options"], "DENY")
        self.assertIn("frame-ancestors 'none'", response["Content-Security-Policy"])
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertTrue(response.cookies["vibeide_visit"]["httponly"])

    def test_first_touch_is_sticky_and_does_not_store_referrer_query(self):
        self.client.get("/?utm_source=community&utm_campaign=launch", HTTP_REFERER="https://example.test/path?secret=hidden")
        self.client.get("/?utm_source=changed")
        visit = Visit.objects.get()
        self.assertEqual((visit.source, visit.referrer_host), ("community", "example.test"))
        self.assertEqual(Event.objects.filter(kind="visit").count(), 1)

    def test_forged_visit_cookie_is_ignored(self):
        self.client.cookies["vibeide_visit"] = "tampered"
        self.assertEqual(self.client.get("/").status_code, 200)

    def test_host_validation_and_safe_login_redirect(self):
        self.assertEqual(self.client.get("/", HTTP_HOST="evil.example").status_code, 400)
        response = self.client.post("/accounts/login/", {"login": self.user.email, "password": PASSWORD,
                                                       "next": "https://evil.example/steal"})
        self.assertEqual(response["Location"], "/account/")

    def test_email_casefold_constraint(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user("PERSON@EXAMPLE.TEST", PASSWORD)

    def test_password_is_argon2(self):
        self.assertTrue(self.user.password.startswith("argon2$"))
        self.assertTrue(self.user.check_password(PASSWORD))

    def test_browser_csrf_enforced(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        self.assertEqual(client.post("/trial/").status_code, 403)
        self.assertEqual(client.post("/accounts/login/", {"login": self.user.email, "password": PASSWORD}).status_code, 403)

    def test_normal_browser_login_and_logout_are_recorded(self):
        self.client.get("/")
        response = self.client.post("/accounts/login/", {"login": self.user.email, "password": PASSWORD})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.get("/account/").status_code, 200)
        self.assertTrue(Event.objects.filter(kind="login", user=self.user).exists())
        self.client.post("/accounts/logout/")
        self.assertEqual(self.client.get("/account/").status_code, 302)

    def test_unconfigured_signup_and_recovery_fail_closed(self):
        response = self.client.post("/accounts/signup/", {"email": "new@example.test", "password1": PASSWORD, "password2": PASSWORD})
        self.assertNotEqual(response.status_code, 500)
        self.assertFalse(User.objects.filter(email="new@example.test").exists())
        self.assertEqual(self.client.get("/accounts/password/reset/").status_code, 503)

    @override_settings(EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_signup_cannot_escalate_and_requires_verification(self):
        self.client.get("/?utm_source=launch")
        response = self.client.post("/accounts/signup/", {"email": "new@example.test", "password1": PASSWORD,
            "password2": PASSWORD, "is_staff": "true", "is_superuser": "true"})
        self.assertEqual(response.status_code, 302)
        user = User.objects.get(email="new@example.test")
        self.assertFalse(user.is_staff or user.is_superuser)
        self.assertEqual(user.first_visit.source, "launch")
        self.assertFalse(EmailAddress.objects.get(user=user).verified)
        self.assertEqual(len(mail.outbox), 1)
        self.assertNotIn(SESSION_KEY, self.client.session)

    @override_settings(EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_email_confirmation_and_password_recovery(self):
        self.client.post("/accounts/signup/", {"email": "new@example.test", "password1": PASSWORD, "password2": PASSWORD})
        confirmation = re.search(r"/accounts/confirm-email/[^\s]+", mail.outbox[0].body).group()
        self.client.post(confirmation)
        self.assertTrue(EmailAddress.objects.get(email="new@example.test").verified)
        self.assertNotIn(SESSION_KEY, self.client.session)
        self.client.post("/accounts/password/reset/", {"email": self.user.email})
        reset = re.search(r"/accounts/password/reset/key/[^\s]+", mail.outbox[-1].body).group()
        response = self.client.get(reset)
        self.assertEqual(response.status_code, 302)
        response = self.client.post(response["Location"], {"password1": "Reset-Fixture-936!long", "password2": "Reset-Fixture-936!long"})
        self.assertEqual(response.status_code, 302)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Reset-Fixture-936!long"))

    def test_token_api_rejects_cookie_only_unknown_expired_and_password_changed(self):
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/api/v1/me").status_code, 401)
        self.assertEqual(self.client.get("/api/v1/me", HTTP_X_SESSION_TOKEN="bad").status_code, 401)
        token = self.token()
        self.assertEqual(self.client.get("/api/v1/me", HTTP_X_SESSION_TOKEN=token).status_code, 200)
        self.user.set_password("A-different-fixture-892!")
        self.user.save()
        self.assertEqual(self.client.get("/api/v1/me", HTTP_X_SESSION_TOKEN=token).status_code, 401)
        from django.contrib.sessions.models import Session
        token = self.token()
        Session.objects.filter(session_key=token).update(expire_date=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.client.get("/api/v1/me", HTTP_X_SESSION_TOKEN=token).status_code, 401)

    def test_token_rejects_disabled_unverified_and_partial_session(self):
        token = self.token()
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.client.get("/api/v1/me", HTTP_X_SESSION_TOKEN=token).status_code, 401)
        self.user.is_active = True
        self.user.save()
        EmailAddress.objects.filter(user=self.user).update(verified=False)
        self.assertEqual(self.client.get("/api/v1/me", HTTP_X_SESSION_TOKEN=self.token()).status_code, 403)
        from django.contrib.sessions.backends.db import SessionStore
        session = SessionStore()
        session["account_login"] = {"user_pk": str(self.user.pk)}
        session.save()
        self.assertEqual(self.client.get("/api/v1/me", HTTP_X_SESSION_TOKEN=session.session_key).status_code, 401)

    def test_headless_login_returns_valid_session_token(self):
        response = self.client.post("/_allauth/app/v1/auth/login", json.dumps({"email": self.user.email, "password": PASSWORD}), content_type="application/json")
        self.assertEqual(response.status_code, 200, response.content)
        token = response.json()["meta"]["session_token"]
        self.assertEqual(self.client.get("/api/v1/me", HTTP_X_SESSION_TOKEN=token).json()["email"], self.user.email)

    def test_event_authentication_validation_and_retries(self):
        body = {"kind": "app_try", "idempotency_key": str(uuid.uuid4()), "user_id": 999}
        self.assertEqual(self.client.post("/api/v1/events", json.dumps(body), content_type="application/json").status_code, 401)
        token = self.token()
        for status in (201, 200):
            response = self.client.post("/api/v1/events", json.dumps(body), content_type="application/json", HTTP_X_SESSION_TOKEN=token)
            self.assertEqual(response.status_code, status)
        self.assertEqual(Event.objects.get(kind="app_try").user, self.user)
        body["kind"] = "signup"
        self.assertEqual(self.client.post("/api/v1/events", json.dumps(body), content_type="application/json", HTTP_X_SESSION_TOKEN=token).status_code, 400)

    def test_trial_starts_only_once(self):
        self.client.force_login(self.user)
        self.client.post("/trial/")
        self.client.post("/trial/")
        self.assertEqual(Trial.objects.count(), 1)
        self.assertEqual(Event.objects.filter(kind="trial_started").count(), 1)

    def test_admin_requires_role_password_change_and_mfa(self):
        self.assertEqual(self.client.get("/admin/metrics/").status_code, 302)
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/admin/metrics/").status_code, 302)
        self.user.is_staff = self.user.is_superuser = self.user.must_change_password = True
        self.user.save()
        self.assertEqual(self.client.get("/admin/metrics/")["Location"], "/accounts/password/change/")
        self.user.must_change_password = False
        self.user.save()
        self.assertIn("totp", self.client.get("/admin/metrics/")["Location"])
        Authenticator.objects.create(user=self.user, type="totp", data={"secret": MFAAdapter().encrypt("A" * 32)})
        self.assertEqual(self.client.get("/admin/metrics/").status_code, 200)

    def test_download_destination_allowlist_and_counter(self):
        Download.objects.create(slug="latest", name="Latest", url="https://github.com/Crowie-s-r-o/CC-Relay/releases/latest")
        self.assertEqual(self.client.get("/downloads/latest/").status_code, 302)
        self.assertEqual(Event.objects.filter(kind="download_redirect").count(), 1)
        for url in ("https://evil.test/", "https://github.com.evil.test/Crowie-s-r-o/CC-Relay/releases/latest", "javascript:alert(1)"):
            with self.assertRaises(ValidationError):
                Download(url=url).clean()

    def test_funnel_distinct_counts_and_escaping(self):
        user = User.objects.create_superuser("operator@example.test", PASSWORD)
        Authenticator.objects.create(user=user, type="totp", data={"secret": MFAAdapter().encrypt("A" * 32)})
        self.client.force_login(user)
        visit = Visit.objects.create(source="<script>alert(1)</script>")
        self.user.first_visit = visit
        self.user.save()
        Event.objects.bulk_create([Event(kind="download_redirect", visit=visit) for _ in range(3)])
        Trial.objects.create(user=self.user)
        response = self.client.get("/admin/metrics/?days=invalid")
        row = list(response.context["cohort"])[0]
        self.assertEqual((row["visitors"], row["signups"], row["downloads"], row["trials"]), (1, 1, 1, 1))
        self.assertNotContains(response, "<script>alert(1)</script>")

    def test_mfa_secret_encrypted(self):
        adapter = MFAAdapter()
        value = adapter.encrypt("test-secret")
        self.assertNotIn("test-secret", value)
        self.assertEqual(adapter.decrypt(value), "test-secret")

    def test_login_rate_limit_and_failed_event(self):
        for _ in range(6):
            response = self.client.post("/accounts/login/", {"login": self.user.email, "password": "wrong"})
        self.assertContains(response, "Too many failed login attempts")
        response = self.client.post("/accounts/login/", {"login": self.user.email, "password": PASSWORD})
        self.assertNotIn(SESSION_KEY, self.client.session)
        self.assertContains(response, "Too many failed login attempts")
        statuses = [self.client.post("/accounts/login/", {"login": self.user.email, "password": "wrong"}).status_code for _ in range(15)]
        self.assertIn(429, statuses)
        self.assertTrue(Event.objects.filter(kind="login_failed").exists())

    def test_google_login_get_does_not_initiate_oauth(self):
        from allauth.socialaccount.models import SocialApp
        SocialApp.objects.create(provider="google", name="Synthetic", client_id="fixture.apps.googleusercontent.com", secret="fixture")
        response = self.client.get("/accounts/google/login/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Location", response)

    def test_bootstrap_never_resets_account(self):
        data = json.dumps({"email": "operator@example.test", "password": PASSWORD})
        with patch("sys.stdin", io.StringIO(data)):
            call_command("bootstrap_admin", stdout=io.StringIO())
        user = User.objects.get(email="operator@example.test")
        self.assertTrue(user.is_superuser and user.must_change_password)
        with patch("sys.stdin", io.StringIO(data)), self.assertRaises(CommandError):
            call_command("bootstrap_admin", stdout=io.StringIO())

    def test_google_uses_state_pkce_and_rejects_unsolicited_callback(self):
        from urllib.parse import parse_qs, urlsplit
        from allauth.socialaccount.models import SocialApp
        SocialApp.objects.create(provider="google", name="Synthetic", client_id="fixture.apps.googleusercontent.com", secret="fixture")
        response = self.client.post("/accounts/google/login/")
        query = parse_qs(urlsplit(response["Location"]).query)
        self.assertTrue(query["state"])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertTrue(query["code_challenge"])
        response = self.client.get("/accounts/google/login/callback/?code=forged&state=wrong")
        self.assertNotEqual(response.status_code, 500)
        self.assertNotIn(SESSION_KEY, self.client.session)

    @override_settings(SECURE_SSL_REDIRECT=True, SESSION_COOKIE_SECURE=True, CSRF_COOKIE_SECURE=True)
    def test_https_enforcement(self):
        self.assertEqual(self.client.get("/accounts/login/").status_code, 301)
        response = self.client.get("/accounts/login/", secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/health").status_code, 200)
