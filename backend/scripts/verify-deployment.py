"""Verify through a TLS-checked local SSH tunnel. Credentials enter on stdin only."""
import http.client
import json
import re
import ssl
import sys
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlencode

base = Path(__file__).resolve().parent.parent
credentials = json.load(sys.stdin)
context = ssl.create_default_context(cafile=base / ".data/internal-ca.crt")
cookies = SimpleCookie()


def request(method, path, data=None, extra=None):
    headers = {"Host": "vibeide.dev", "Cookie": "; ".join(f"{k}={v.value}" for k, v in cookies.items())}
    if data is not None:
        headers.update({"Content-Type": "application/x-www-form-urlencoded", "Origin": "https://vibeide.dev"})
        data = urlencode(data)
    headers.update(extra or {})
    connection = http.client.HTTPSConnection("localhost", 18443, context=context, timeout=15)
    connection.request(method, path, data, headers)
    response = connection.getresponse()
    body = response.read()
    for name, value in response.getheaders():
        if name.lower() == "set-cookie":
            cookies.load(value)
    result = response.status, dict(response.getheaders()), body
    connection.close()
    return result


def csrf(body):
    return re.search(rb'name="csrfmiddlewaretoken" value="([^"]+)"', body).group(1).decode()


assert request("GET", "/health")[0] == 200
status, headers, body = request("GET", "/")
assert status == 200 and body == b""
assert "max-age=31536000" in headers["Strict-Transport-Security"]
assert headers["X-Frame-Options"] == "DENY"
assert request("GET", "/", extra={"Host": "untrusted.example"})[0] == 400
assert request("GET", "/api/v1/me")[0] == 401
assert request("GET", "/admin/metrics/")[0] == 302
assert request("POST", "/trial/", {})[0] == 403
status, _, body = request("GET", "/accounts/login/")
assert status == 200
status, _, _ = request("POST", "/accounts/login/", {"login": credentials["email"], "password": credentials["password"], "csrfmiddlewaretoken": csrf(body)})
assert status == 302, "Operator email login failed"
cookie = cookies["__Host-vibeide_session"]
assert cookie["secure"] and cookie["httponly"] and cookie["samesite"] == "Lax"
status, headers, _ = request("GET", "/admin/metrics/")
assert status == 302 and headers["Location"] == "/accounts/password/change/"
_, _, body = request("GET", "/accounts/logout/")
assert request("POST", "/accounts/logout/", {"csrfmiddlewaretoken": csrf(body)})[0] == 302
assert request("GET", "/api/v1/me")[0] == 401
print("Verified private TLS, empty landing, headers, host rejection, anonymous API/admin denial, CSRF, operator email login, secure cookies, first-password gate and logout.")
