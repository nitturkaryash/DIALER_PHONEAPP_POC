from __future__ import annotations

import asyncio
import math
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from google import genai
from google.genai import types as genai_types

from config import config
from db.mongo import get_db

_temporary_knowledge: dict[str, dict[str, Any]] = {}


def _env_int(name: str, default: int) -> int:
    return config.int_setting(name, default)


def _env_float(name: str, default: float) -> float:
    return config.float_setting(name, default)


def _embedding_model() -> str:
    return config.setting("KNOWLEDGE_EMBED_MODEL", "gemini-embedding-2-preview")


def _gemini_api_key() -> str:
    return config.setting("GEMINI_API_KEY")


def _extract_embedding_values(resp: Any) -> list[float]:
    if resp is None:
        raise RuntimeError("Embedding response is empty")
    if hasattr(resp, "embeddings") and resp.embeddings:
        first = resp.embeddings[0]
        if hasattr(first, "values") and first.values:
            return [float(v) for v in first.values]
    if hasattr(resp, "embedding") and resp.embedding is not None:
        emb = resp.embedding
        if hasattr(emb, "values") and emb.values:
            return [float(v) for v in emb.values]
    if isinstance(resp, dict):
        embeddings = resp.get("embeddings")
        if embeddings and isinstance(embeddings, list):
            values = embeddings[0].get("values") if isinstance(embeddings[0], dict) else None
            if values:
                return [float(v) for v in values]
        embedding = resp.get("embedding")
        if isinstance(embedding, dict) and embedding.get("values"):
            return [float(v) for v in embedding["values"]]
    raise RuntimeError("Could not parse embedding vector")


def _embed_query_sync(query: str, *, model: str, api_key: str) -> list[float]:
    client = genai.Client(api_key=api_key)
    resp = client.models.embed_content(
        model=model,
        contents=[query],
        config=genai_types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
    )
    return _extract_embedding_values(resp)


async def embed_query(query: str) -> list[float]:
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required for knowledge retrieval")
    model = _embedding_model()
    timeout = max(5.0, _env_float("KNOWLEDGE_QUERY_EMBED_TIMEOUT_SECS", 15.0))
    return await asyncio.wait_for(
        asyncio.to_thread(_embed_query_sync, query, model=model, api_key=api_key),
        timeout=timeout,
    )


async def search_knowledge_chunks(campaign_id: str, query: str, *, top_k: int | None = None) -> list[dict]:
    query_clean = (query or "").strip()
    if not campaign_id or not query_clean:
        return []

    limit = max(1, min(8, top_k or _env_int("KNOWLEDGE_TOP_K", 4)))
    vector = await embed_query(query_clean)
    db = get_db()
    # Cosine-only retrieval mode (no Atlas vector index dependency).
    return await _fallback_cosine_search(db, campaign_id, vector, limit)


def register_temporary_knowledge(chunks: list[dict], *, ttl_secs: int = 3600) -> dict:
    token = uuid4().hex
    expires_at = datetime.utcnow() + timedelta(seconds=max(60, int(ttl_secs or 3600)))
    _temporary_knowledge[token] = {
        "chunks": chunks,
        "expires_at": expires_at,
    }
    return {
        "token": token,
        "expires_at": expires_at.isoformat() + "Z",
    }


async def search_temporary_knowledge(token: str, query: str, *, top_k: int | None = None) -> list[dict]:
    query_clean = (query or "").strip()
    if not token or not query_clean:
        return []

    row = _temporary_knowledge.get(token)
    if not row:
        return []

    expires_at = row.get("expires_at")
    if expires_at and datetime.utcnow() >= expires_at:
        _temporary_knowledge.pop(token, None)
        return []

    limit = max(1, min(8, top_k or _env_int("KNOWLEDGE_TOP_K", 4)))
    vector = await embed_query(query_clean)
    docs = row.get("chunks") if isinstance(row.get("chunks"), list) else []
    scored: list[dict] = []
    for d in docs:
        emb = d.get("embedding")
        if not isinstance(emb, list):
            continue
        score = _cosine_similarity(vector, emb)
        scored.append(
            {
                "doc_id": d.get("doc_id"),
                "chunk_no": d.get("chunk_no"),
                "page_start": d.get("page_start"),
                "page_end": d.get("page_end"),
                "content_preview": d.get("content_preview"),
                "score": score,
            }
        )
    scored.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
    return scored[:limit]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for i in range(n):
        x = float(a[i])
        y = float(b[i])
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


async def _fallback_cosine_search(db, campaign_id: str, query_vector: list[float], limit: int) -> list[dict]:
    projection = {
        "_id": 0,
        "doc_id": 1,
        "chunk_no": 1,
        "page_start": 1,
        "page_end": 1,
        "content_preview": 1,
        "embedding": 1,
    }
    docs = await db.knowledge_chunks.find({"campaign_id": campaign_id}, projection).to_list(length=5000)
    scored: list[dict] = []
    for d in docs:
        emb = d.get("embedding")
        if not isinstance(emb, list):
            continue
        score = _cosine_similarity(query_vector, emb)
        scored.append(
            {
                "doc_id": d.get("doc_id"),
                "chunk_no": d.get("chunk_no"),
                "page_start": d.get("page_start"),
                "page_end": d.get("page_end"),
                "content_preview": d.get("content_preview"),
                "score": score,
            }
        )
    scored.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
    return scored[:limit]


def format_chunks_for_tool(chunks: list[dict], *, max_chars_per_chunk: int | None = None) -> str:
    if not chunks:
        return ""
    max_chars = max(200, min(2200, max_chars_per_chunk or _env_int("KNOWLEDGE_MAX_CHUNK_CHARS", 650)))
    lines: list[str] = []
    for idx, chunk in enumerate(chunks, start=1):
        start = chunk.get("page_start")
        end = chunk.get("page_end")
        loc = f"pages {start}-{end}" if start and end else "pages unknown"
        score = float(chunk.get("score") or 0.0)
        preview = str(chunk.get("content_preview") or "").strip()
        if len(preview) > max_chars:
            preview = preview[:max_chars].rstrip() + " ..."
        lines.append(f"[Snippet {idx} | {loc} | score={score:.3f}] {preview}")
    return "\n".join(lines).strip()
