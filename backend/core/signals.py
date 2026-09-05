from django.contrib.auth.signals import user_login_failed, user_logged_out
from django.dispatch import receiver
from allauth.account.signals import user_signed_up, user_logged_in, email_confirmed, password_changed, password_reset
from .models import Event


def record(kind, request, user=None, detail=""):
    if user and not user.is_authenticated:
        user = None
    visit = getattr(request, "visit", None) if request else None
    if user and not visit and user.first_visit_id:
        visit = user.first_visit
    return Event.objects.create(kind=kind, user=user, visit=visit, detail=detail)


@receiver(user_signed_up)
def signup(sender, request, user, **kwargs):
    user.first_visit = getattr(request, "visit", None)
    user.save(update_fields=["first_visit"])
    record("signup", request, user)


@receiver(user_logged_in)
def login(sender, request, user, **kwargs):
    record("login", request, user)


@receiver(user_login_failed)
def failed(sender, request, **kwargs):
    # Deliberately discard attempted credentials and email.
    record("login_failed", request)


@receiver(user_logged_out)
def logout(sender, request, user, **kwargs):
    record("logout", request, user)


@receiver(email_confirmed)
def verified(sender, request, email_address, **kwargs):
    record("email_verified", request, email_address.user)


@receiver(password_changed)
@receiver(password_reset)
def changed(sender, request, user, **kwargs):
    user.must_change_password = False
    user.save(update_fields=["must_change_password"])
    record("password_changed", request, user)
