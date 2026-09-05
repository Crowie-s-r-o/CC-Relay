import sqlite3
from datetime import timedelta
from pathlib import Path
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone
from core.models import Event, Visit


class Command(BaseCommand):
    help = "Prune 90-day analytics, expire sessions, and retain seven consistent daily database snapshots."

    def handle(self, **options):
        cutoff = timezone.now() - timedelta(days=90)
        Event.objects.filter(created_at__lt=cutoff).delete()
        Visit.objects.filter(created_at__lt=cutoff).delete()
        call_command("clearsessions", verbosity=0)
        backup_dir = settings.BASE_DIR / ".data/backups"
        backup_dir.mkdir(mode=0o700, exist_ok=True)
        target = backup_dir / (timezone.now().strftime("%Y-%m-%d") + ".sqlite3")
        with sqlite3.connect(settings.DATABASES["default"]["NAME"]) as source:
            with sqlite3.connect(target) as destination:
                source.backup(destination)
                if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise RuntimeError("Backup integrity check failed")
        target.chmod(0o600)
        for old in sorted(backup_dir.glob("*.sqlite3"))[:-7]:
            old.unlink()
        self.stdout.write("Maintenance and database backup completed")
