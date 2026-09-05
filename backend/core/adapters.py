import base64
import hashlib
from cryptography.fernet import Fernet
from django.conf import settings
from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.mfa.adapter import DefaultMFAAdapter


class AccountAdapter(DefaultAccountAdapter):
    def is_open_for_signup(self, request):
        return settings.EMAIL_ENABLED

    def get_client_ip(self, request):
        # Set only by the loopback-only Gunicorn upstream's trusted in-pod proxy.
        return request.META.get("HTTP_X_REAL_IP", request.META.get("REMOTE_ADDR", "unknown"))

    def send_notification_mail(self, *args, **kwargs):
        if settings.EMAIL_ENABLED:
            return super().send_notification_mail(*args, **kwargs)


class SocialAdapter(DefaultSocialAccountAdapter):
    def is_open_for_signup(self, request, sociallogin):
        return any(address.verified for address in sociallogin.email_addresses)


class MFAAdapter(DefaultMFAAdapter):
    def cipher(self):
        key = hashlib.sha256((settings.SECRET_KEY + "/mfa").encode()).digest()
        return Fernet(base64.urlsafe_b64encode(key))

    def encrypt(self, text):
        return self.cipher().encrypt(text.encode()).decode()

    def decrypt(self, encrypted_text):
        return self.cipher().decrypt(encrypted_text.encode()).decode()
