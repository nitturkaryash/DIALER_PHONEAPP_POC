from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types as genai_types
from loguru import logger
from pypdf import PdfReader, PdfWriter

from config import config
from db.mongo import get_db

_job_queue: asyncio.Queue[str] = asyncio.Queue()
_worker_task: asyncio.Task | None = None
_stop_event = asyncio.Event()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _env_int(name: str, default: int) -> int:
    return config.int_setting(name, default)


def _chunk_size_pages() -> int:
    # Gemini embedding PDF limit is 6 pages per request.
    return max(1, min(6, _env_int("KNOWLEDGE_PDF_PAGES_PER_CHUNK", 6)))


def _ingestion_timeout_secs() -> float:
    try:
        return max(10.0, config.float_setting("KNOWLEDGE_EMBED_TIMEOUT_SECS", 45.0))
    except Exception:
        return 45.0


def _embedding_model() -> str:
    return config.setting("KNOWLEDGE_EMBED_MODEL", "gemini-embedding-2-preview")


def _gemini_api_key() -> str:
    return config.setting("GEMINI_API_KEY")


def _split_pdf_chunks(pdf_bytes: bytes, *, pages_per_chunk: int) -> list[dict[str, Any]]:
    reader = PdfReader(BytesIO(pdf_bytes))
    total_pages = len(reader.pages)
    chunks: list[dict[str, Any]] = []
    if total_pages == 0:
        return chunks

    for start in range(0, total_pages, pages_per_chunk):
        end = min(total_pages, start + pages_per_chunk)
        writer = PdfWriter()
        text_parts: list[str] = []
        for idx in range(start, end):
            page = reader.pages[idx]
            writer.add_page(page)
            try:
                extracted = (page.extract_text() or "").strip()
            except Exception:
                extracted = ""
            if extracted:
                text_parts.append(extracted)

        out = BytesIO()
        writer.write(out)
        preview = "\n".join(text_parts).strip()
        chunks.append(
            {
                "chunk_no": len(chunks) + 1,
                "page_start": start + 1,
                "page_end": end,
                "pdf_bytes": out.getvalue(),
                "content_preview": preview[:1800],
            }
        )
    return chunks


def _extract_embedding_values(resp: Any) -> list[float]:
    # SDK response shapes vary by model/version, so this parser is intentionally defensive.
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

    raise RuntimeError("Could not parse embedding values from response")


def _embed_pdf_chunk_sync(pdf_bytes: bytes, *, model: str, api_key: str) -> list[float]:
    client = genai.Client(api_key=api_key)
    part = genai_types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf")

    attempts = [
        lambda: client.models.embed_content(
            model=model,
            contents=[part],
            config=genai_types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
        ),
        lambda: client.models.embed_content(
            model=model,
            contents=[
                genai_types.Content(
                    role="user",
                    parts=[part],
                )
            ],
            config=genai_types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
        ),
    ]

    last_error: Exception | None = None
    for attempt in attempts:
        try:
            return _extract_embedding_values(attempt())
        except Exception as exc:
            last_error = exc
            continue
    raise RuntimeError(f"Gemini PDF embedding failed: {last_error}")


async def _embed_pdf_chunk(pdf_bytes: bytes) -> list[float]:
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required for PDF embedding")
    model = _embedding_model()
    return await asyncio.wait_for(
        asyncio.to_thread(_embed_pdf_chunk_sync, pdf_bytes, model=model, api_key=api_key),
        timeout=_ingestion_timeout_secs(),
    )


async def embed_pdf_bytes_for_search(pdf_bytes: bytes) -> tuple[list[dict[str, Any]], int]:
    chunks = _split_pdf_chunks(pdf_bytes, pages_per_chunk=_chunk_size_pages())
    if not chunks:
        raise RuntimeError("Uploaded PDF has no readable pages.")

    rows: list[dict[str, Any]] = []
    for chunk in chunks:
        vector = await _embed_pdf_chunk(chunk["pdf_bytes"])
        rows.append(
            {
                "doc_id": None,
                "chunk_no": chunk["chunk_no"],
                "page_start": chunk["page_start"],
                "page_end": chunk["page_end"],
                "content_preview": chunk["content_preview"],
                "embedding": vector,
            }
        )
    return rows, max(chunk["page_end"] for chunk in chunks)


async def enqueue_knowledge_job(job_id: str) -> None:
    if not job_id:
        return
    await _job_queue.put(job_id)


async def _set_job_status(job_id: str, status: str, *, error: str | None = None) -> None:
    db = get_db()
    await db.knowledge_jobs.update_one(
        {"id": job_id},
        {"$set": {"status": status, "error": error, "updated_at": _utcnow()}},
    )


async def _set_doc_status(doc_id: str, status: str, *, error: str | None = None, page_count: int | None = None) -> None:
    db = get_db()
    payload: dict[str, Any] = {"status": status, "updated_at": _utcnow(), "error": error}
    if page_count is not None:
        payload["page_count"] = page_count
    await db.knowledge_docs.update_one({"id": doc_id}, {"$set": payload})


async def _update_campaign_knowledge_status(campaign_id: str, status: str) -> None:
    db = get_db()
    await db.campaigns.update_one(
        {"id": campaign_id},
        {"$set": {"knowledge_source": "pdf_embedding", "knowledge_status": status, "updated_at": _utcnow()}},
    )


async def _process_job(job_id: str) -> None:
    db = get_db()
    job = await db.knowledge_jobs.find_one({"id": job_id})
    if not job:
        return
    doc_id = str(job.get("doc_id") or "")
    if not doc_id:
        await _set_job_status(job_id, "failed", error="Missing doc_id")
        return

    doc = await db.knowledge_docs.find_one({"id": doc_id})
    if not doc:
        await _set_job_status(job_id, "failed", error="Knowledge document not found")
        return

    campaign_id = str(doc.get("campaign_id") or "")
    if not campaign_id:
        await _set_job_status(job_id, "failed", error="Missing campaign_id")
        return

    await _set_job_status(job_id, "processing")
    await _set_doc_status(doc_id, "processing")
    await _update_campaign_knowledge_status(campaign_id, "processing")

    pdf_bytes = b""
    raw_pdf = doc.get("raw_pdf")
    if raw_pdf is not None:
        try:
            pdf_bytes = bytes(raw_pdf)
        except Exception:
            pdf_bytes = b""
    if not pdf_bytes:
        upload_path = str(doc.get("upload_path") or "").strip()
        if upload_path:
            try:
                pdf_bytes = Path(upload_path).read_bytes()
            except Exception:
                pdf_bytes = b""
    if not pdf_bytes:
        await _set_job_status(job_id, "failed", error="Missing PDF bytes/upload file")
        await _set_doc_status(doc_id, "failed", error="Missing PDF bytes/upload file")
        await _update_campaign_knowledge_status(campaign_id, "failed")
        return

    upload_path = str(doc.get("upload_path") or "").strip()
    try:
        chunks = _split_pdf_chunks(pdf_bytes, pages_per_chunk=_chunk_size_pages())
        if not chunks:
            raise RuntimeError("Uploaded PDF has no readable pages.")

        await db.knowledge_chunks.delete_many({"doc_id": doc_id})
        rows = []
        for chunk in chunks:
            vector = await _embed_pdf_chunk(chunk["pdf_bytes"])
            rows.append(
                {
                    "doc_id": doc_id,
                    "campaign_id": campaign_id,
                    "chunk_no": chunk["chunk_no"],
                    "page_start": chunk["page_start"],
                    "page_end": chunk["page_end"],
                    "content_preview": chunk["content_preview"],
                    "embedding": vector,
                    "created_at": _utcnow(),
                }
            )

        if rows:
            await db.knowledge_chunks.insert_many(rows)

        await _set_doc_status(
            doc_id,
            "ready",
            page_count=max(chunk["page_end"] for chunk in chunks),
            error=None,
        )
        unset_doc = {"raw_pdf": "", "upload_path": "", "file_size_bytes": ""}
        await db.knowledge_docs.update_one({"id": doc_id}, {"$unset": unset_doc})
        await _set_job_status(job_id, "ready", error=None)
        await _update_campaign_knowledge_status(campaign_id, "ready")
        logger.info(f"Knowledge ingestion complete ({campaign_id=}, {doc_id=}, chunks={len(rows)})")
    except Exception as exc:
        err = str(exc)[:1200]
        await _set_doc_status(doc_id, "failed", error=err)
        await _set_job_status(job_id, "failed", error=err)
        await _update_campaign_knowledge_status(campaign_id, "failed")
        logger.warning(f"Knowledge ingestion failed for {doc_id}: {exc}")
    finally:
        if upload_path:
            try:
                p = Path(upload_path)
                if p.exists():
                    p.unlink()
            except Exception:
                pass


async def _worker_loop() -> None:
    logger.info("Knowledge ingestion worker started")
    while not _stop_event.is_set():
        try:
            job_id = await asyncio.wait_for(_job_queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue

        try:
            await _process_job(job_id)
        except Exception as exc:
            logger.error(f"Unhandled error in knowledge ingestion worker ({job_id=}): {exc}")
        finally:
            _job_queue.task_done()
    logger.info("Knowledge ingestion worker stopped")


async def _requeue_pending_jobs() -> None:
    db = get_db()
    cursor = db.knowledge_jobs.find({"status": {"$in": ["queued", "processing"]}}).sort("created_at", 1)
    async for row in cursor:
        jid = str(row.get("id") or "")
        if jid:
            await _job_queue.put(jid)


@asynccontextmanager
async def service_lifespan():
    global _worker_task
    _stop_event.clear()
    await _requeue_pending_jobs()
    _worker_task = asyncio.create_task(_worker_loop(), name="knowledge-ingestion")
    try:
        yield
    finally:
        _stop_event.set()
        if _worker_task and not _worker_task.done():
            _worker_task.cancel()
            with suppress(asyncio.CancelledError):
                await _worker_task
        _worker_task = None
