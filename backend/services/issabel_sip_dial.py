"""Issabel outbound dial-string helpers (shared with issabel_sip_sanity CLI)."""

from __future__ import annotations

import re
from typing import Optional

from config import config

__all__ = [
    "digits_only",
    "issabel_dial_prefix_digits",
    "issabel_dial_prefix_digits_script_default",
    "issabel_assume_country_code_body",
    "issabel_strip_leading_cc_body",
    "sip_dial_user_for_issabel",
]


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def issabel_dial_prefix_digits(default_if_unset: str = "3680") -> str:
    """Digits prepended to the national number for the SIP Request-URI user part.

    If ``ISSABEL_SIP_DIAL_PREFIX`` is unset, uses ``default_if_unset`` (sanity script: 3680).
    Set env to empty to disable prefixing.
    """
    raw = config.optional_setting("ISSABEL_SIP_DIAL_PREFIX")
    if raw is None:
        return re.sub(r"\D", "", default_if_unset)
    return re.sub(r"\D", "", raw.strip())


def issabel_dial_prefix_digits_script_default(default: str = "3680") -> str:
    """Alias for scripts that pass DEFAULT_DIAL_PREFIX when env is unset."""
    return issabel_dial_prefix_digits(default_if_unset=default)


def issabel_assume_country_code_body(body: str) -> str:
    """Optional prepend CC to 10-digit locals; unset env = off."""
    b = digits_only(body)
    if not b:
        return b
    if len(b) == 11 and b.startswith("0") and len(b) > 1 and b[1] in "6789":
        b = b[1:]
    if len(b) != 10 or b[0] not in "6789":
        return b

    raw_flag = config.optional_setting("ISSABEL_DIAL_ASSUME_COUNTRY_CODE")
    if raw_flag is None:
        return b
    s = raw_flag.strip().lower()
    if s in {"", "0", "off", "false", "no"}:
        return b

    cc = re.sub(r"\D", "", raw_flag.strip()) or "91"
    if b.startswith(cc):
        return b
    return f"{cc}{b}"


def issabel_strip_leading_cc_body(body: str) -> str:
    """Strip 91 from +91 mobiles before access prefix (3680+national)."""
    b = digits_only(body)
    if not b or len(b) != 12 or not b.startswith("91") or b[2] not in "6789":
        return b

    raw = config.optional_setting("ISSABEL_DIAL_STRIP_LEADING_CC")
    if raw is not None:
        s = raw.strip().lower()
        if s in {"", "0", "off", "false", "no"}:
            return b

    cc = re.sub(r"\D", "", raw.strip()) if (raw and raw.strip()) else "91"
    if not cc or not b.startswith(cc):
        return b
    rest = b[len(cc) :]
    if len(rest) == 10 and rest[0] in "6789":
        return rest
    return b


def sip_dial_user_for_issabel(raw: str, prefix_digits: Optional[str] = None) -> str:
    """SIP user part for Request-URI: digits only; optional PBX outbound prefix prepended."""
    pfx = prefix_digits if prefix_digits is not None else issabel_dial_prefix_digits()
    body = digits_only(raw)
    body = issabel_assume_country_code_body(body)
    body = issabel_strip_leading_cc_body(body)
    if not body:
        return ""
    if pfx and body.startswith(pfx):
        return body
    return f"{pfx}{body}" if pfx else body
