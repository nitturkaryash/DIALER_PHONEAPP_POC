from __future__ import annotations

import socket
from dataclasses import dataclass
from typing import Dict

from pipecat.runner.types import RunnerArguments


@dataclass
class IssabelRunnerArguments(RunnerArguments):
    """Pipecat runner args when using Issabel RTP transport directly."""

    call_id: str = ""


@dataclass
class SipResponse:
    code: int
    reason: str
    headers: Dict[str, str]
    raw: str


@dataclass
class IssabelSipCallSession:
    """Open SIP dialog + RTP socket after 200 OK (before BYE)."""

    dial_digits: str
    sip_sock: socket.socket
    server_ip: str
    server_port: int
    request_uri: str
    call_id: str
    from_tag: str
    to_header: str
    last_invite_cseq: int
    username: str
    login: str
    password: str
    domain: str
    local_ip: str
    local_sip_port: int
    rtp_sock: socket.socket
    remote_rtp_host: str
    remote_rtp_port: int
    payload_type: int
    use_pcma: bool
