from __future__ import annotations

import base64
from secrets import compare_digest


def basic_auth_matches(auth_header: str, expected_user: str, expected_token: str) -> bool:
    scheme, _, raw = auth_header.partition(" ")
    if scheme.lower() != "basic" or not raw:
        return False

    try:
        decoded = base64.b64decode(raw.strip(), validate=True).decode("utf-8")
        user, token = decoded.split(":", 1)
    except Exception:
        return False

    return compare_digest(user, expected_user) and compare_digest(token, expected_token)
