import json
import uuid
from datetime import timedelta
from functools import wraps
from django.conf import settings
from django.contrib.auth import get_user
from django.contrib.auth.decorators import login_required
from django.db import connection, transaction
from django.db.models import Count, Q
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST
from allauth.account.models import EmailAddress
from allauth.headless import app_settings
from allauth.mfa.models import Authenticator
from .models import Download, Event, Trial, User, Visit
from .signals import record


@require_GET
def health(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    from django.core.cache import cache
    cache.get("health")
    return JsonResponse({"status": "ok"})


@require_GET
def landing(request):
    return HttpResponse((settings.BASE_DIR / "landing/index.html").read_bytes(), content_type="text/html")


@login_required
@require_GET
def account(request):
    return render(request, "account.html", {"downloads": Download.objects.filter(enabled=True),
                                            "trial": Trial.objects.filter(user=request.user).first()})


def start_trial(user, request):
    with transaction.atomic():
        trial, created = Trial.objects.get_or_create(user=user)
        if created:
            record("trial_started", request, user)
    return trial, created


@login_required
@require_POST
def trial(request):
    if not EmailAddress.objects.filter(user=request.user, verified=True, email__iexact=request.user.email).exists():
        return HttpResponse("Verify your email first.", status=403)
    start_trial(request.user, request)
    return redirect("account")


@require_GET
def download(request, slug):
    target = get_object_or_404(Download, slug=slug, enabled=True)
    target.full_clean()
    record("download_redirect", request, request.user, target.slug)
    return redirect(target.url)


def token_required(view):
    @csrf_exempt
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        token = request.headers.get("X-Session-Token", "")
        if not token or len(token) > 256:
            return JsonResponse({"error": "authentication_required"}, status=401)
        session = app_settings.TOKEN_STRATEGY.lookup_session(token)
        if session is None:
            return JsonResponse({"error": "authentication_required"}, status=401)
        token_request = HttpRequest()
        token_request.session = session
        # Django verifies the session's password hash, expiry, and active user.
        user = get_user(token_request)
        if not user.is_authenticated:
            return JsonResponse({"error": "authentication_required"}, status=401)
        if user.must_change_password:
            return JsonResponse({"error": "password_change_required"}, status=403)
        if user.is_staff and not Authenticator.objects.filter(user=user, type="totp").exists():
            return JsonResponse({"error": "mfa_setup_required"}, status=403)
        if not EmailAddress.objects.filter(user=user, email__iexact=user.email, verified=True).exists():
            return JsonResponse({"error": "email_verification_required"}, status=403)
        request.user = user
        return view(request, *args, **kwargs)
    return wrapper


@token_required
@require_GET
def me(request):
    return JsonResponse({"id": request.user.pk, "email": request.user.email,
                         "role": "admin" if request.user.is_staff else "user",
                         "trial_started": Trial.objects.filter(user=request.user).exists()})


@token_required
@require_POST
def event(request):
    from django.core.cache import cache
    key = f"events:{request.user.pk}"
    if not cache.add(key, 1, 3600):
        try:
            if cache.incr(key) > 120:
                return JsonResponse({"error": "rate_limited"}, status=429)
        except ValueError:
            if not cache.add(key, 1, 3600):
                return JsonResponse({"error": "rate_limited"}, status=429)
    if request.content_type != "application/json":
        return JsonResponse({"error": "json_required"}, status=415)
    try:
        body = json.loads(request.body)
        if not isinstance(body, dict) or body.get("kind") not in ("trial_started", "app_try"):
            raise ValueError
        key = uuid.UUID(body["idempotency_key"])
    except (ValueError, KeyError, TypeError):
        return JsonResponse({"error": "invalid_event"}, status=400)
    if body["kind"] == "trial_started":
        _, created = start_trial(request.user, request)
    else:
        with transaction.atomic():
            _, created = Event.objects.get_or_create(user=request.user, idempotency_key=key,
                defaults={"kind": "app_try", "visit_id": request.user.first_visit_id, "detail": "client_reported"})
    return JsonResponse({"recorded": created}, status=201 if created else 200)


def dashboard(request):
    # Wrapped with AdminSite.admin_view at URL registration.
    from django.contrib import admin
    try:
        days = int(request.GET.get("days", 30))
        if days not in (1, 7, 30, 90):
            raise ValueError
    except ValueError:
        days = 30
    since = timezone.now() - timedelta(days=days)
    events = Event.objects.filter(created_at__gte=since)
    counts = dict(events.values("kind").annotate(n=Count("id")).values_list("kind", "n"))
    visits = Visit.objects.filter(created_at__gte=since)
    cohort = visits.values("source", "medium", "campaign").annotate(
        visitors=Count("id", distinct=True),
        signups=Count("users", distinct=True),
        downloads=Count("id", filter=Q(event__kind="download_redirect"), distinct=True),
        trials=Count("users", filter=Q(users__trial__isnull=False), distinct=True),
    ).order_by("-visitors")[:100]
    context = {**admin.site.each_context(request), "title": "Acquisition & activity", "days": days,
               "total_users": User.objects.count(), "new_users": User.objects.filter(date_joined__gte=since).count(),
               "active_users": User.objects.filter(is_active=True).count(), "counts": counts,
               "cohort": cohort, "recent": events.select_related("user", "visit").order_by("-created_at")[:50],
               "email_enabled": settings.EMAIL_ENABLED,
               "google_enabled": bool(settings.CONFIG.get("google", {}).get("client_id"))}
    return render(request, "admin/dashboard.html", context)
