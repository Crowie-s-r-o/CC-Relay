"""Configuration is a mounted JSON file, never project environment variables."""
import json
import sys
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
TESTING = "test" in sys.argv
CONFIG_PATH = BASE_DIR / "config/runtime.json"
if TESTING:
    CONFIG = {"secret_key": "test-only-secret-key-" * 4, "development": True}
elif CONFIG_PATH.exists():
    CONFIG = json.loads(CONFIG_PATH.read_text())
else:
    raise ImproperlyConfigured("Create config/runtime.json from config/example.json; see README.md")

DEBUG = False
DEVELOPMENT = CONFIG.get("development", False)
SECRET_KEY = CONFIG["secret_key"]
if len(SECRET_KEY) < 50 or SECRET_KEY.startswith("REPLACE_"):
    raise ImproperlyConfigured("secret_key must contain at least 50 random characters")
PUBLIC_ORIGIN = CONFIG.get("public_origin", "http://127.0.0.1:8080" if DEVELOPMENT else "https://vibeide.dev")
if not DEVELOPMENT and not PUBLIC_ORIGIN.startswith("https://"):
    raise ImproperlyConfigured("Production requires HTTPS")
ALLOWED_HOSTS = CONFIG.get("allowed_hosts", ["vibeide.dev", "www.vibeide.dev", "localhost", "127.0.0.1"])
if "*" in ALLOWED_HOSTS:
    raise ImproperlyConfigured("Wildcard allowed_hosts is prohibited")
CSRF_TRUSTED_ORIGINS = [PUBLIC_ORIGIN]
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "core.apps.CoreConfig", "allauth", "allauth.account", "allauth.socialaccount",
    "allauth.socialaccount.providers.google", "allauth.mfa", "allauth.headless",
]
MIDDLEWARE = [
    "core.middleware.BoundaryMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "core.middleware.OperatorSecurityMiddleware",
    "core.middleware.AttributionMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "vibeide.urls"
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "DIRS": [BASE_DIR / "templates"],
              "APP_DIRS": True, "OPTIONS": {"context_processors": [
                  "django.template.context_processors.request", "django.contrib.auth.context_processors.auth",
                  "django.contrib.messages.context_processors.messages", "core.context.capabilities"]}}]
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / ".data/db.sqlite3",
                         "OPTIONS": {"timeout": 15, "transaction_mode": "IMMEDIATE"}}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": "redis://127.0.0.1:6379/0"}}
if DEVELOPMENT or TESTING:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
AUTH_USER_MODEL = "core.User"
AUTHENTICATION_BACKENDS = ["django.contrib.auth.backends.ModelBackend", "allauth.account.auth_backends.AuthenticationBackend"]
PASSWORD_HASHERS = ["django.contrib.auth.hashers.Argon2PasswordHasher", "django.contrib.auth.hashers.PBKDF2PasswordHasher"]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*", "password2*"]
ACCOUNT_EMAIL_VERIFICATION = "mandatory"
ACCOUNT_PREVENT_ENUMERATION = "strict"
ACCOUNT_EMAIL_SUBJECT_PREFIX = "[VibeIDE] "
ACCOUNT_LOGIN_ON_EMAIL_CONFIRMATION = False
ACCOUNT_LOGOUT_ON_GET = False
ACCOUNT_SESSION_REMEMBER = False
ACCOUNT_EMAIL_NOTIFICATIONS = True
ACCOUNT_ADAPTER = "core.adapters.AccountAdapter"
ACCOUNT_RATE_LIMITS = {"login": "20/m/ip", "login_failed": "5/5m/key,30/5m/ip", "signup": "5/h/ip",
                       "reset_password": "3/h/key,10/h/ip", "confirm_email": "3/3m/key"}
SOCIALACCOUNT_ADAPTER = "core.adapters.SocialAdapter"
SOCIALACCOUNT_LOGIN_ON_GET = False
SOCIALACCOUNT_EMAIL_AUTHENTICATION = False
SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = False
SOCIALACCOUNT_STORE_TOKENS = False
SOCIALACCOUNT_PROVIDERS = {"google": {"SCOPE": ["profile", "email"], "OAUTH_PKCE_ENABLED": True,
                                      "AUTH_PARAMS": {"access_type": "online"}}}
if CONFIG.get("google", {}).get("client_id") and CONFIG.get("google", {}).get("client_secret"):
    SOCIALACCOUNT_PROVIDERS["google"]["APP"] = CONFIG["google"]
HEADLESS_CLIENTS = ("browser", "app")
HEADLESS_SERVE_SPECIFICATION = False
MFA_ADAPTER = "core.adapters.MFAAdapter"
MFA_SUPPORTED_TYPES = ["totp", "recovery_codes"]
MFA_RECOVERY_CODES_SHOW_ONCE = True
MFA_TOTP_ISSUER = "VibeIDE"
MFA_TRUST_ENABLED = False
LOGIN_URL = "/accounts/login/"
LOGIN_REDIRECT_URL = "/account/"
ACCOUNT_LOGOUT_REDIRECT_URL = "/accounts/login/"
SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_NAME = "vibeide_session" if DEVELOPMENT else "__Host-vibeide_session"
SESSION_COOKIE_AGE = 12 * 60 * 60
SESSION_COOKIE_SECURE = not DEVELOPMENT
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = not DEVELOPMENT
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_NAME = "vibeide_csrf" if DEVELOPMENT else "__Host-vibeide_csrf"
SECURE_SSL_REDIRECT = not DEVELOPMENT
SECURE_REDIRECT_EXEMPT = [r"^health/?$"]
# The in-pod proxy overwrites this header. Gunicorn only binds to loopback.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31536000 if not DEVELOPMENT else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"
DATA_UPLOAD_MAX_MEMORY_SIZE = 32768
DATA_UPLOAD_MAX_NUMBER_FIELDS = 40
FILE_UPLOAD_MAX_MEMORY_SIZE = 0
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
STORAGES = {"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"}}
EMAIL_CONFIG = CONFIG.get("smtp", {})
EMAIL_ENABLED = bool(EMAIL_CONFIG.get("host"))
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend" if EMAIL_ENABLED else "core.mail.UnconfiguredEmailBackend"
EMAIL_HOST = EMAIL_CONFIG.get("host", "")
EMAIL_PORT = EMAIL_CONFIG.get("port", 587)
EMAIL_HOST_USER = EMAIL_CONFIG.get("username", "")
EMAIL_HOST_PASSWORD = EMAIL_CONFIG.get("password", "")
EMAIL_USE_TLS = True
EMAIL_TIMEOUT = 10
DEFAULT_FROM_EMAIL = EMAIL_CONFIG.get("from_email", "VibeIDE <accounts@vibeide.dev>")
TIME_ZONE = "UTC"
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LOGGING = {"version": 1, "disable_existing_loggers": False,
           "handlers": {"console": {"class": "logging.StreamHandler"}},
           "root": {"handlers": ["console"], "level": "WARNING"},
           "loggers": {"django.request": {"handlers": ["console"], "level": "CRITICAL", "propagate": False}}}
