from __future__ import annotations

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from config import config


_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


def _mongo_uri() -> str:
    return config.setting("MONGO_URI", "mongodb://localhost:27017")


def _mongo_db_name() -> str:
    return config.setting("MONGO_DB_NAME", "voice_assistant")


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("MongoDB is not initialized. Call init_mongo() during app startup.")
    return _db


async def init_mongo() -> None:
    global _client, _db
    if _db is not None:
        return

    db_name = _mongo_db_name()
    client = AsyncIOMotorClient(_mongo_uri())
    db = client[db_name]
    try:
        await db.command("ping")
        await ensure_indexes(db)
    except Exception:
        client.close()
        raise

    _client = client
    _db = db
    logger.info(f"MongoDB initialized: db={db_name}")


async def close_mongo() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
    _client = None
    _db = None


async def ensure_indexes(db: AsyncIOMotorDatabase | None = None) -> None:
    if db is None:
        db = get_db()
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.users.create_index([("created_at", -1)])

    await db.campaigns.create_index([("user_id", 1), ("created_at", -1)])
    await db.campaigns.create_index("id", unique=True)
    await db.campaigns.create_index([("status", 1)])
    await db.campaigns.create_index([("user_id", 1), ("knowledge_status", 1), ("updated_at", -1)])

    await db.campaign_contacts.create_index([("campaign_id", 1), ("sequence_no", 1)], unique=True)
    await db.campaign_contacts.create_index([("campaign_id", 1), ("state", 1), ("sequence_no", 1)])
    await db.campaign_contacts.create_index([("user_id", 1), ("created_at", -1)])

    await db.call_sessions.create_index([("call_id", 1)], unique=True)
    await db.call_sessions.create_index([("campaign_contact_id", 1), ("attempt_no", 1)])
    await db.call_sessions.create_index([("user_id", 1), ("created_at", -1)])
    await db.call_sessions.create_index([("status", 1)])

    await db.collected_params.create_index([("campaign_id", 1), ("created_at", -1)])
    await db.collected_params.create_index([("user_id", 1), ("created_at", -1)])
    await db.collected_params.create_index([("call_id", 1)])
    await db.collected_params.create_index([("call_id", 1), ("user_id", 1)])

    await db.conversation_events.create_index([("call_id", 1), ("created_at", 1)])
    await db.conversation_events.create_index([("user_id", 1), ("created_at", -1)])

    await db.knowledge_docs.create_index([("campaign_id", 1), ("created_at", -1)])
    await db.knowledge_docs.create_index([("user_id", 1), ("created_at", -1)])
    await db.knowledge_docs.create_index([("status", 1), ("updated_at", -1)])
    await db.knowledge_docs.create_index("id", unique=True)

    await db.knowledge_chunks.create_index([("campaign_id", 1), ("doc_id", 1), ("chunk_no", 1)], unique=True)
    await db.knowledge_chunks.create_index([("campaign_id", 1), ("created_at", -1)])
    await db.knowledge_chunks.create_index("doc_id")

    await db.knowledge_jobs.create_index([("campaign_id", 1), ("created_at", -1)])
    await db.knowledge_jobs.create_index([("status", 1), ("updated_at", -1)])
    await db.knowledge_jobs.create_index("id", unique=True)

    await db.gemini_voice_previews.create_index("id", unique=True)
    await db.gemini_voice_previews.create_index("voice_name")
    await db.gemini_voice_previews.create_index([("updated_at", -1)])

    await db.refresh_tokens.create_index([("token", 1)], unique=True)
    await db.refresh_tokens.create_index([("expires_at", 1)], expireAfterSeconds=0)

    await db.user_outbound_config.create_index([("user_id", 1)], unique=True)
