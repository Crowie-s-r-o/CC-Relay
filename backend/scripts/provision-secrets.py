"""First deployment only. Random secrets stay out of source, command arguments and stdout."""
import base64
import json
import secrets
import subprocess
from pathlib import Path
from datetime import datetime, timedelta, timezone
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

base = Path(__file__).resolve().parent.parent
remote = "pati@144.76.107.210"
kubectl = "kubectl --kubeconfig=$HOME/.kube/config"
subprocess.run(["ssh", "-o", "BatchMode=yes", remote, f"{kubectl} apply -f -"], input=(base / "k8s/namespace.yaml").read_bytes(), check=True)
for name in ("vibeide-config", "vibeide-tls"):
    check = subprocess.run(["ssh", "-o", "BatchMode=yes", remote, f"{kubectl} -n vibeide-dev get secret {name} -o name"], capture_output=True)
    if check.returncode == 0:
        raise SystemExit(f"{name} already exists; refusing to rotate production secrets")
    if b"NotFound" not in check.stderr:
        raise SystemExit("Cannot establish secret absence; no changes made")
config = json.loads((base / "config/example.json").read_text())
config["secret_key"] = secrets.token_urlsafe(64)
key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "vibeide.dev internal transport")])
now = datetime.now(timezone.utc)
cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("vibeide.dev"), x509.DNSName("localhost")]), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .sign(key, hashes.SHA256()))
cert_pem = cert.public_bytes(serialization.Encoding.PEM)
key_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
items = []
for name, data, kind in [
    ("vibeide-config", {"runtime.json": json.dumps(config).encode()}, "Opaque"),
    ("vibeide-tls", {"tls.crt": cert_pem, "tls.key": key_pem}, "kubernetes.io/tls"),
]:
    items.append({"apiVersion": "v1", "kind": "Secret", "type": kind,
                  "metadata": {"name": name, "namespace": "vibeide-dev", "labels": {"app": "vibeide"}},
                  "data": {k: base64.b64encode(v).decode() for k, v in data.items()}})
subprocess.run(["ssh", "-o", "BatchMode=yes", remote, f"{kubectl} create -f -"],
               input=json.dumps({"apiVersion": "v1", "kind": "List", "items": items}).encode(), check=True)
(base / ".data").mkdir(mode=0o700, exist_ok=True)
(base / ".data/internal-ca.crt").write_bytes(cert_pem)
print("Runtime secrets created; public internal CA saved in .data/internal-ca.crt. No private key retained locally.")
