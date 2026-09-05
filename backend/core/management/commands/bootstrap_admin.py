import json
import sys
from django.contrib.auth.password_validation import validate_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from allauth.account.models import EmailAddress
from core.models import Download, User


class Command(BaseCommand):
    help = "Create the first admin from JSON on stdin. Never resets an existing account."

    def handle(self, **options):
        data = json.load(sys.stdin)
        email = data["email"].strip().lower()
        with transaction.atomic():
            if User.objects.filter(email__iexact=email).exists():
                raise CommandError("Account already exists; no changes made")
            if User.objects.filter(is_superuser=True).exists():
                raise CommandError("An administrator already exists; use the admin interface")
            validate_password(data["password"], User(email=email))
            user = User.objects.create_superuser(email, data["password"], must_change_password=True)
            EmailAddress.objects.create(user=user, email=email, verified=True, primary=True)
            Download.objects.get_or_create(slug="latest", defaults={"name": "Download the latest release", "url": "https://github.com/Crowie-s-r-o/CC-Relay/releases/latest"})
        self.stdout.write("Administrator created. Password change and two-factor setup required on first use.")
