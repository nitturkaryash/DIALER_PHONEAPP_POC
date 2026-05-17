"""Default system prompt text from SYSTEM_PROMPT_FILE (shared by campaign validation and bot)."""

from __future__ import annotations

from config import config
from loguru import logger


def load_system_prompt_text() -> str:
    path = config.system_prompt_path
    try:
        if path.exists():
            return path.read_text(encoding="utf-8").strip()
    except Exception as exc:
        logger.warning(f"Failed to read system prompt from {path}: {exc}")
    return ""
