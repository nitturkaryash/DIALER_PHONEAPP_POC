"""Minimal UDP SIP signaling to Issabel/Asterisk (INVITE with digest, ACK, BYE)."""

from __future__ import annotations

import hashlib
import random
import re
import secrets
import socket
import time
from typing import Dict, Optional, Tuple

from config import config
from loguru import logger
from models.issabel import IssabelSipCallSession, SipResponse

CRLF = "\r\n"


def _clean_string(value: object) -> str:
    return str(value or "").strip()


def md5_hex(value: str) -> str:
    return hashlib.md5(value.encode("utf-8")).hexdigest()


def random_tag() -> str:
    return secrets.token_hex(6)


def random_branch() -> str:
    return f"z9hG4bK{secrets.token_hex(8)}"


def random_call_id(host: str) -> str:
    return f"{secrets.token_hex(10)}@{host}"


def _mask_dial_digits(dial_digits: str) -> str:
    value = (dial_digits or "").strip()
    if len(value) <= 4:
        return value
    return f"{'*' * (len(value) - 4)}{value[-4:]}"


def parse_headers(raw_msg: str) -> SipResponse:
    lines = raw_msg.split(CRLF)
    status = lines[0].strip()
    match = re.match(r"^SIP/2.0\s+(\d{3})\s+(.+)$", status)
    if not match:
        raise ValueError(f"Invalid SIP status line: {status}")

    code = int(match.group(1))
    reason = match.group(2).strip()
    headers: Dict[str, str] = {}

    for line in lines[1:]:
        if not line.strip():
            break
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        k = key.strip().lower()
        v = value.strip()
        if k in headers:
            headers[k] = f"{headers[k]}, {v}"
        else:
            headers[k] = v

    return SipResponse(code=code, reason=reason, headers=headers, raw=raw_msg)


def sip_message_body(raw_msg: str) -> str:
    if "\r\n\r\n" not in raw_msg:
        return ""
    return raw_msg.split("\r\n\r\n", 1)[1]


def recv_sip(sock: socket.socket, timeout: float) -> Optional[SipResponse]:
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        sock.settimeout(remaining)
        try:
            data, _addr = sock.recvfrom(65535)
        except socket.timeout:
            return None
        text = data.decode("utf-8", errors="replace")
        if not text.strip():
            continue
        first_line = text.split(CRLF, 1)[0].strip()
        if first_line.startswith("SIP/2.0"):
            return parse_headers(text)


def build_sip_request(
    method: str,
    request_uri: str,
    from_user: str,
    to_user: str,
    domain: str,
    local_ip: str,
    local_port: int,
    cseq: int,
    call_id: str,
    contact_user: str,
    auth_header: Optional[str] = None,
    expires: Optional[int] = None,
    body: Optional[str] = None,
    content_type: str = "application/sdp",
    from_tag_in: Optional[str] = None,
    to_header_value: Optional[str] = None,
) -> Tuple[str, str]:
    branch = random_branch()
    from_tag = from_tag_in if from_tag_in else random_tag()
    to_line = (
        f"To: {to_header_value}"
        if to_header_value is not None
        else f"To: <sip:{to_user}@{domain}>"
    )
    lines = [
        f"{method} {request_uri} SIP/2.0",
        f"Via: SIP/2.0/UDP {local_ip}:{local_port};branch={branch};rport",
        "Max-Forwards: 70",
        f"From: <sip:{from_user}@{domain}>;tag={from_tag}",
        to_line,
        f"Call-ID: {call_id}",
        f"CSeq: {cseq} {method}",
        f"Contact: <sip:{contact_user}@{local_ip}:{local_port};transport=udp>",
        "User-Agent: VoiceAssistant-Issabel/1.0",
    ]

    if expires is not None:
        lines.append(f"Expires: {expires}")
    if auth_header:
        lines.append(auth_header)

    if body is not None:
        blen = len(body.encode("utf-8"))
        lines.append(f"Content-Type: {content_type}")
        lines.append(f"Content-Length: {blen}")
        lines.append("")
        lines.append(body)
    else:
        lines.extend(
            [
                "Content-Length: 0",
                "",
                "",
            ]
        )
    return CRLF.join(lines), from_tag


def parse_digest_challenge(www_auth: str) -> Dict[str, str]:
    digest_idx = www_auth.lower().find("digest")
    if digest_idx == -1:
        raise ValueError("WWW-Authenticate is not Digest")

    challenge = www_auth[digest_idx + len("digest") :].strip()
    pairs = re.findall(r'(\w+)=(".*?"|[^,]+)', challenge)
    result: Dict[str, str] = {}
    for key, value in pairs:
        val = value.strip()
        if val.startswith('"') and val.endswith('"'):
            val = val[1:-1]
        result[key.lower()] = val
    return result


def build_digest_authorization(
    username: str,
    password: str,
    realm: str,
    nonce: str,
    method: str,
    uri: str,
    qop: Optional[str] = None,
    opaque: Optional[str] = None,
    algorithm: str = "MD5",
    auth_header_name: str = "Authorization",
) -> str:
    if algorithm.upper() != "MD5":
        raise ValueError(f"Unsupported digest algorithm: {algorithm}")

    ha1 = md5_hex(f"{username}:{realm}:{password}")
    ha2 = md5_hex(f"{method}:{uri}")

    nc = "00000001"
    cnonce = secrets.token_hex(8)
    if qop:
        response = md5_hex(f"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}")
    else:
        response = md5_hex(f"{ha1}:{nonce}:{ha2}")

    fields = [
        f'username="{username}"',
        f'realm="{realm}"',
        f'nonce="{nonce}"',
        f'uri="{uri}"',
        f'response="{response}"',
        f"algorithm={algorithm}",
    ]
    if opaque:
        fields.append(f'opaque="{opaque}"')
    if qop:
        fields.append(f"qop={qop}")
        fields.append(f"nc={nc}")
        fields.append(f'cnonce="{cnonce}"')

    return f"{auth_header_name}: Digest " + ", ".join(fields)


def choose_qop(qop_header: Optional[str]) -> Optional[str]:
    if not qop_header:
        return None
    choices = [x.strip() for x in qop_header.split(",")]
    if "auth" in choices:
        return "auth"
    return choices[0] if choices else None


def get_local_ip_for_target(target_ip: str, target_port: int) -> Tuple[str, int]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind(("0.0.0.0", 0))
        sock.connect((target_ip, target_port))
        local_ip, local_port = sock.getsockname()
        return local_ip, local_port
    finally:
        sock.close()


def recv_sip_filtered(
    sock: socket.socket,
    deadline: float,
    call_id: str,
) -> Optional[SipResponse]:
    want = call_id.strip().lower()
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        resp = recv_sip(sock, min(remaining, 5.0))
        if resp is None:
            continue
        cid = (resp.headers.get("call-id") or "").strip().lower()
        if cid == want:
            return resp
    return None


def _digest_challenge_for_response(resp: SipResponse) -> Tuple[str, str]:
    if resp.code == 407:
        return (resp.headers.get("proxy-authenticate") or ""), "Proxy-Authorization"
    return (resp.headers.get("www-authenticate") or ""), "Authorization"


def parse_sdp_audio_remote(sdp: str) -> Tuple[str, int, int, bool]:
    """Return (ip, rtp_port, first_payload_type, use_pcma_for_that_pt)."""
    conn_ip = ""
    for line in sdp.splitlines():
        line = line.strip()
        if line.startswith("c=IN IP4 "):
            conn_ip = line.split()[-1].strip()
            break
    rtp_port = 0
    payloads: list[int] = []
    for line in sdp.splitlines():
        line = line.strip()
        if line.startswith("m=audio "):
            parts = line.split()
            if len(parts) >= 4:
                rtp_port = int(parts[1])
                payloads = [int(x) for x in parts[3:] if x.isdigit()]
            break
    if not conn_ip or not rtp_port:
        raise ValueError("SDP answer missing c= or m=audio")

    pt = payloads[0] if payloads else 0
    use_pcma = pt == 8
    return conn_ip, rtp_port, pt, use_pcma


def issabel_invite_until_answered(
    *,
    dial_digits: str,
    dial_timeout: float = 45.0,
    call_id: Optional[str] = None,
    issabel_config: Optional[dict] = None,
) -> IssabelSipCallSession:
    """Send INVITE, handle digest, ACK 200 OK, return session with RTP socket bound."""
    c = issabel_config or {}

    server = _clean_string(c.get("issabel_host")) or config.setting("ISSABEL_SIP_HOST")
    domain = (_clean_string(c.get("issabel_domain")) or config.setting("ISSABEL_SIP_DOMAIN") or server).strip()
    username = _clean_string(c.get("issabel_user")) or config.setting("ISSABEL_SIP_USER")
    login = (_clean_string(c.get("issabel_login")) or config.setting("ISSABEL_SIP_LOGIN") or username).strip()
    password = _clean_string(c.get("issabel_password")) or config.setting("ISSABEL_SIP_PASSWORD")
    try:
        port_val = c.get("issabel_port")
        port = int(port_val) if port_val else config.int_setting("ISSABEL_SIP_PORT", 5060)
    except Exception:
        port = 5060

    if not server or not password or not dial_digits:
        raise ValueError("ISSABEL_SIP_HOST, ISSABEL_SIP_PASSWORD, and dial string are required")

    request_uri = f"sip:{dial_digits}@{domain}"
    local_ip, _ = get_local_ip_for_target(server, port)
    sip_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sip_sock.bind(("0.0.0.0", 0))
    _, signal_local_port = sip_sock.getsockname()
    local_sip_port = int(signal_local_port)

    rtp_port = random.randint(10000, 59998)
    if rtp_port % 2 == 1:
        rtp_port += 1
    sid = random.randint(1, 2**31 - 1)
    sdp = (
        f"v=0{CRLF}"
        f"o=- {sid} {sid} IN IP4 {local_ip}{CRLF}"
        f"s=voiceassistant{CRLF}"
        f"c=IN IP4 {local_ip}{CRLF}"
        f"t=0 0{CRLF}"
        f"m=audio {rtp_port} RTP/AVP 0 8{CRLF}"
        f"a=rtpmap:0 PCMU/8000{CRLF}"
        f"a=rtpmap:8 PCMA/8000{CRLF}"
    )

    rtp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rtp_sock.bind(("0.0.0.0", rtp_port))
    rtp_sock.settimeout(0.05)

    sip_call_id = random_call_id(local_ip)
    log_call_id = (call_id or sip_call_id).strip() or sip_call_id
    cseq = random.randint(1000, 9999)
    deadline = time.monotonic() + float(dial_timeout)
    authed = False
    last_invite_cseq = cseq

    logger.info(
        f"[{log_call_id}] Issabel INVITE start: "
        f"target={server}:{port}, dial={_mask_dial_digits(dial_digits)}, timeout={dial_timeout}s"
    )

    def send_raw(msg: str) -> None:
        sip_sock.sendto(msg.encode("utf-8"), (server, port))

    invite1, from_tag = build_sip_request(
        method="INVITE",
        request_uri=request_uri,
        from_user=username,
        to_user=dial_digits,
        domain=domain,
        local_ip=local_ip,
        local_port=local_sip_port,
        cseq=cseq,
        call_id=sip_call_id,
        contact_user=username,
        auth_header=None,
        expires=None,
        body=sdp,
    )
    send_raw(invite1)
    logger.info(f"[{log_call_id}] Sent initial INVITE cseq={cseq}")

    try:
        while True:
            now = time.monotonic()
            if now >= deadline:
                raise TimeoutError("INVITE timed out waiting for final response")

            resp = recv_sip_filtered(sip_sock, min(deadline, now + 8.0), sip_call_id)
            if resp is None:
                if time.monotonic() >= deadline:
                    raise TimeoutError("INVITE timed out waiting for final response")
                continue

            if resp.code in (401, 407):
                if authed:
                    raise RuntimeError(f"INVITE auth failed (SIP {resp.code})")
                logger.warning(f"[{log_call_id}] SIP auth challenge received: {resp.code} {resp.reason}")
                ch, auth_name = _digest_challenge_for_response(resp)
                if not ch:
                    raise RuntimeError("INVITE digest challenge missing")
                challenge = parse_digest_challenge(ch)
                realm = challenge.get("realm", domain)
                nonce = challenge.get("nonce")
                if not nonce:
                    raise RuntimeError("INVITE digest nonce missing")
                qop = choose_qop(challenge.get("qop"))
                opaque = challenge.get("opaque")
                algorithm = challenge.get("algorithm", "MD5")
                auth = build_digest_authorization(
                    username=login,
                    password=password,
                    realm=realm,
                    nonce=nonce,
                    method="INVITE",
                    uri=request_uri,
                    qop=qop,
                    opaque=opaque,
                    algorithm=algorithm,
                    auth_header_name=auth_name,
                )
                cseq += 1
                last_invite_cseq = cseq
                invite2, _ = build_sip_request(
                    method="INVITE",
                    request_uri=request_uri,
                    from_user=username,
                    to_user=dial_digits,
                    domain=domain,
                    local_ip=local_ip,
                    local_port=local_sip_port,
                    cseq=cseq,
                    call_id=sip_call_id,
                    contact_user=username,
                    auth_header=auth,
                    expires=None,
                    body=sdp,
                    from_tag_in=from_tag,
                )
                send_raw(invite2)
                authed = True
                logger.info(f"[{log_call_id}] Sent authenticated INVITE cseq={cseq}")
                continue

            if 100 <= resp.code < 200:
                logger.debug(f"[{log_call_id}] Provisional SIP response: {resp.code} {resp.reason}")
                continue

            if resp.code == 200:
                logger.info(f"[{log_call_id}] Final SIP response: 200 {resp.reason}")
                to_val = (resp.headers.get("to") or "").strip()
                if not to_val:
                    raise RuntimeError("200 OK missing To header")
                sdp_ans = sip_message_body(resp.raw)
                rhost, rport, pt, use_pcma = parse_sdp_audio_remote(sdp_ans)

                ack, _ = build_sip_request(
                    method="ACK",
                    request_uri=request_uri,
                    from_user=username,
                    to_user=dial_digits,
                    domain=domain,
                    local_ip=local_ip,
                    local_port=local_sip_port,
                    cseq=last_invite_cseq,
                    call_id=sip_call_id,
                    contact_user=username,
                    expires=None,
                    from_tag_in=from_tag,
                    to_header_value=to_val,
                )
                send_raw(ack)
                logger.info(f"[{log_call_id}] Sent ACK; SIP dialog established")

                return IssabelSipCallSession(
                    dial_digits=dial_digits,
                    sip_sock=sip_sock,
                    server_ip=server,
                    server_port=port,
                    request_uri=request_uri,
                    call_id=sip_call_id,
                    from_tag=from_tag,
                    to_header=to_val,
                    last_invite_cseq=last_invite_cseq,
                    username=username,
                    login=login,
                    password=password,
                    domain=domain,
                    local_ip=local_ip,
                    local_sip_port=local_sip_port,
                    rtp_sock=rtp_sock,
                    remote_rtp_host=rhost,
                    remote_rtp_port=rport,
                    payload_type=pt,
                    use_pcma=use_pcma,
                )

            logger.error(f"[{log_call_id}] Final SIP failure response: {resp.code} {resp.reason}")
            raise RuntimeError(f"INVITE failed: SIP {resp.code} {resp.reason}")
    except Exception:
        logger.exception(f"[{log_call_id}] Issabel INVITE flow failed")
        sip_sock.close()
        rtp_sock.close()
        raise


def issabel_send_bye(session: IssabelSipCallSession) -> None:
    """Best-effort BYE to terminate dialog."""
    try:
        bye_cseq = session.last_invite_cseq + 1
        bye, _ = build_sip_request(
            method="BYE",
            request_uri=session.request_uri,
            from_user=session.username,
            to_user=session.dial_digits,
            domain=session.domain,
            local_ip=session.local_ip,
            local_port=session.local_sip_port,
            cseq=bye_cseq,
            call_id=session.call_id,
            contact_user=session.username,
            expires=None,
            from_tag_in=session.from_tag,
            to_header_value=session.to_header,
        )
        session.sip_sock.sendto(bye.encode("utf-8"), (session.server_ip, session.server_port))
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            resp = recv_sip_filtered(session.sip_sock, deadline, session.call_id)
            if resp is None:
                break
            if resp.code == 200:
                break
    except Exception:
        pass
    finally:
        try:
            session.sip_sock.close()
        except Exception:
            pass
