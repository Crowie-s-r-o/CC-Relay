import hashlib
import hmac
from urllib.parse import urlsplit
from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect
from allauth.mfa.models import Authenticator
from .models import Event, Visit


def client_ip(request):
    return request.META.get("HTTP_X_REAL_IP", request.META.get("REMOTE_ADDR", "unknown"))


def limited(request, scope, limit, seconds):
    """Atomic Redis increment across workers; no raw IP stored."""
    digest = hmac.new(settings.SECRET_KEY.encode(), client_ip(request).encode(), hashlib.sha256).hexdigest()
    key = f"limit:{scope}:{digest}"
    if cache.add(key, 1, seconds):
        return False
    try:
        return cache.incr(key) > limit
    except ValueError:
        return not cache.add(key, 1, seconds)


class BoundaryMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.get_host()  # Enforce ALLOWED_HOSTS even on the empty landing page.
        if request.path != "/health":
            if limited(request, "request", 240, 60):
                response = JsonResponse({"error": "rate_limited"}, status=429)
                response["Retry-After"] = "60"
                return response
            if request.method == "POST" and request.path.startswith(("/accounts/", "/_allauth/")):
                if limited(request, "auth", 20, 60):
                    response = JsonResponse({"error": "rate_limited"}, status=429)
                    response["Retry-After"] = "60"
                    return response
        response = self.get_response(request)
        response["Content-Security-Policy"] = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                                                "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
                                                "form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'")
        response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        if not request.path.startswith("/static/"):
            response["Cache-Control"] = "no-store"
        return response


class OperatorSecurityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not settings.EMAIL_ENABLED and request.path in (
            "/accounts/password/reset/", "/_allauth/app/v1/auth/password/request",
            "/_allauth/browser/v1/auth/password/request",
        ):
            return HttpResponse("Password recovery is not available yet. Contact the administrator.", status=503)
        if request.user.is_authenticated and request.path.startswith(("/admin/", "/account/", "/trial/")):
            if request.user.must_change_password:
                return redirect("account_change_password")
            if request.user.is_staff and not Authenticator.objects.filter(user=request.user, type="totp").exists():
                return redirect("mfa_activate_totp")
        return self.get_response(request)


class AttributionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.visit = None
        cookie_name = "vibeide_visit" if settings.DEVELOPMENT else "__Host-vibeide_visit"
        raw = request.COOKIES.get(cookie_name)
        if raw:
            try:
                visit_id = signing.loads(raw, salt="visit", max_age=90 * 86400)
                request.visit = Visit.objects.filter(pk=visit_id).first()
            except (signing.BadSignature, ValueError, TypeError):
                pass
        created = False
        if (request.visit is None and request.method == "GET" and request.path in ("/", "/accounts/login/", "/accounts/signup/")
                and not limited(request, "new-visit", 30, 3600)):
            try:
                referrer = urlsplit(request.META.get("HTTP_REFERER", "")).hostname or ""
            except ValueError:
                referrer = ""
            if referrer in settings.ALLOWED_HOSTS:
                referrer = ""
            request.visit = Visit.objects.create(
                source=request.GET.get("utm_source", "")[:100] or referrer[:100] or "direct",
                medium=request.GET.get("utm_medium", "")[:100], campaign=request.GET.get("utm_campaign", "")[:100],
                referrer_host=referrer[:253],
            )
            Event.objects.create(kind="visit", visit=request.visit)
            created = True
        response = self.get_response(request)
        if created:
            response.set_cookie(cookie_name, signing.dumps(str(request.visit.pk), salt="visit"), max_age=90 * 86400,
                                secure=not settings.DEVELOPMENT, httponly=True, samesite="Lax")
        return response
