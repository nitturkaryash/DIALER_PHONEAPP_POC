"""Application lifecycle management for FastAPI startup and shutdown."""
from __future__ import annotations

from contextlib import asynccontextmanager

from loguru import logger

from config import config
from db.mongo import close_mongo, init_mongo
from services.auth_service import ensure_seed_user


@asynccontextmanager
async def lifespan(_app):
    """Run startup work before serving requests and always clean up on exit."""
    logger.info("Starting up Voice Callback API...")
    light_api_mode = config.bool_setting("LIGHT_API_MODE", False)

    await init_mongo()
    logger.info("MongoDB connected.")

    try:
        await ensure_seed_user()
        logger.info("Seed user check complete.")

        if light_api_mode:
            logger.info("LIGHT_API_MODE enabled. Skipping outbound/knowledge service startup.")
            yield
        else:
            from services import knowledge_ingestion_service, outbound_call_service

            async with outbound_call_service.service_lifespan():
                logger.info("Outbound call service ready.")
                async with knowledge_ingestion_service.service_lifespan():
                    logger.info("Knowledge ingestion service ready.")
                    yield
    finally:
        await close_mongo()
        logger.info("MongoDB disconnected. Shutdown complete.")
