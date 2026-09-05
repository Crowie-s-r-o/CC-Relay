"""Explicit local-only config generation. Refuses to replace existing configuration."""
import json
import secrets
from pathlib import Path

base = Path(__file__).resolve().parent.parent
(base / ".data").mkdir(mode=0o700, exist_ok=True)
target = base / "config/runtime.json"
with target.open("x") as out:
    target.chmod(0o600)
    json.dump({"development": True, "secret_key": secrets.token_urlsafe(64)}, out)
print("Local configuration created. Email and Google remain disabled until configured.")
