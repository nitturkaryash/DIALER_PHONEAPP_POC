"""
Redis client singleton with graceful fallback.

If REDIS_URL is not set or the server is unreachable, get_redis() returns None
and callers should treat this as a cache miss / no-op (degraded but functional).
"""
import os
from loguru import logger

_client = None
_initialized = False


def get_redis():
    """Return a connected redis.Redis client, or None if unavailable."""
    global _client, _initialized

    if _initialized:
        return _client

    _initialized = True
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        logger.info("REDIS_URL not set; cache disabled")
        return None

    try:
        import redis  # type: ignore

        client = redis.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=False,
            health_check_interval=30,
        )
        client.ping()
        _client = client
        logger.info("Redis client connected")
    except Exception as exc:
        logger.warning(f"Redis unavailable, cache disabled: {exc}")
        _client = None

    return _client
