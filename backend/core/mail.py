from django.core.mail.backends.base import BaseEmailBackend


class UnconfiguredEmailBackend(BaseEmailBackend):
    """Do not leak reset/verification secrets into logs or pretend mail was delivered."""
    def send_messages(self, email_messages):
        raise RuntimeError("Outgoing email is not configured")
