from django.conf import settings


def capabilities(request):
    return {"email_enabled": settings.EMAIL_ENABLED, "google_enabled": bool(settings.CONFIG.get("google", {}).get("client_id"))}
