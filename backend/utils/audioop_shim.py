"""Minimal ``audioop`` replacement for Python 3.13+ (stdlib module removed)."""

from __future__ import annotations

from typing import Any, Optional

import numpy as np


def ulaw2lin(fragment: bytes, width: int) -> bytes:
    out: list[int] = []
    for c in fragment:
        c = (~c) & 0xFF
        sign = c & 0x80
        exponent = (c >> 4) & 0x07
        mantissa = c & 0x0F
        sample = ((mantissa << 4) + 0x08) << (exponent + 3)
        sample -= 0x84
        if sign:
            sample = -sample
        sample = max(-32768, min(32767, sample))
        out.append(sample)
    arr = np.array(out, dtype=np.int16)
    if width == 2:
        return arr.tobytes()
    raise ValueError(f"unsupported width {width}")


def lin2ulaw(fragment: bytes, width: int) -> bytes:
    if width != 2:
        raise ValueError("lin2ulaw expects width 2")
    samples = np.frombuffer(fragment, dtype=np.int16).astype(np.int32)
    out = bytearray(len(samples))
    for i, sample in enumerate(samples):
        if sample < 0:
            sample = -sample
            sign = 0x80
        else:
            sign = 0x00
        if sample > 32635:
            sample = 32635
        sample += 0x84
        exponent = 7
        exp_mask = 0x4000
        while sample & exp_mask == 0 and exponent > 0:
            exponent -= 1
            exp_mask >>= 1
        mantissa = (sample >> (exponent + 3)) & 0x0F
        ulaw = ~(sign | (exponent << 4) | mantissa) & 0xFF
        out[i] = ulaw
    return bytes(out)


def alaw2lin(fragment: bytes, width: int) -> bytes:
    out: list[int] = []
    for c in fragment:
        c ^= 0x55
        sign = c & 0x80
        exponent = (c >> 4) & 0x07
        mantissa = c & 0x0F
        if exponent:
            sample = (0x100 | (mantissa << 4)) << (exponent - 1)
        else:
            sample = (mantissa << 4) | 0x08
        if sign:
            sample = -sample
        sample = max(-32768, min(32767, sample))
        out.append(sample)
    arr = np.array(out, dtype=np.int16)
    if width == 2:
        return arr.tobytes()
    raise ValueError(f"unsupported width {width}")


def lin2alaw(fragment: bytes, width: int) -> bytes:
    if width != 2:
        raise ValueError("lin2alaw expects width 2")
    samples = np.frombuffer(fragment, dtype=np.int16).astype(np.int32)
    out = bytearray(len(samples))
    for i, sample in enumerate(samples):
        if sample < 0:
            sample = -sample
            sign = 0x00
        else:
            sign = 0x80
        if sample > 32635:
            sample = 32635
        if sample >= 256:
            exponent = 7
            exp_mask = 0x4000
            while (sample & exp_mask) == 0 and exponent > 0:
                exponent -= 1
                exp_mask >>= 1
            mantissa = (sample >> (exponent + 4)) & 0x0F
            alaw = sign | (exponent << 4) | mantissa
        else:
            alaw = sign | (sample >> 4)
        out[i] = alaw ^ 0x55
    return bytes(out)


def ratecv(
    fragment: bytes,
    width: int,
    nchannels: int,
    inrate: int,
    outrate: int,
    state: Optional[Any],
) -> tuple[bytes, Optional[Any]]:
    if width != 2 or nchannels != 1:
        raise ValueError("ratecv shim expects 16-bit mono")
    if inrate == outrate:
        return fragment, state
    x = np.frombuffer(fragment, dtype=np.int16).astype(np.float64)
    if len(x) == 0:
        return b"", state
    new_len = max(1, int(len(x) * outrate / inrate))
    xi = np.linspace(0.0, len(x) - 1.0, num=len(x))
    xnew = np.linspace(0.0, len(x) - 1.0, num=new_len)
    y = np.interp(xnew, xi, x).astype(np.int16)
    return y.tobytes(), state
