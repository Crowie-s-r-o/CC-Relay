import uuid
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.db.models.functions import Lower


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        user = self.model(email=email.strip().lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.update(is_staff=True, is_superuser=True)
        return self.create_user(email, password, **extra)


class User(AbstractUser):
    username = None
    email = models.EmailField(unique=True)
    must_change_password = models.BooleanField(default=False)
    first_visit = models.ForeignKey("Visit", null=True, blank=True, on_delete=models.SET_NULL, related_name="users")
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []
    objects = UserManager()

    class Meta:
        constraints = [models.UniqueConstraint(Lower("email"), name="unique_email_casefold")]

    def save(self, *args, **kwargs):
        self.email = self.email.strip().lower()
        super().save(*args, **kwargs)


class Visit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    source = models.CharField(max_length=100, default="direct", db_index=True)
    medium = models.CharField(max_length=100, blank=True)
    campaign = models.CharField(max_length=100, blank=True)
    referrer_host = models.CharField(max_length=253, blank=True)


class Event(models.Model):
    KINDS = [(v, v.replace("_", " ")) for v in ["visit", "signup", "email_verified", "login", "login_failed", "download_redirect", "trial_started", "app_try", "logout", "password_changed"]]
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    kind = models.CharField(max_length=32, choices=KINDS, db_index=True)
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    visit = models.ForeignKey(Visit, null=True, blank=True, on_delete=models.SET_NULL)
    detail = models.CharField(max_length=100, blank=True)
    idempotency_key = models.UUIDField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "idempotency_key"], name="unique_user_event_request")]


class Trial(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    started_at = models.DateTimeField(auto_now_add=True)


class Download(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=100)
    url = models.URLField(max_length=500)
    enabled = models.BooleanField(default=True)

    def clean(self):
        from django.core.exceptions import ValidationError
        from urllib.parse import urlsplit
        parsed = urlsplit(self.url)
        if (parsed.scheme != "https" or parsed.netloc != "github.com" or
                not parsed.path.startswith("/Crowie-s-r-o/CC-Relay/releases/") or parsed.username or parsed.fragment):
            raise ValidationError({"url": "Use an HTTPS release URL in the Crowie-s-r-o/CC-Relay GitHub repository."})

    def __str__(self):
        return self.name
