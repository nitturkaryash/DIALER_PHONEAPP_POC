# Voice Callback Backend

Cleaned backend with one active runtime path:

- `api.py`: unified FastAPI entrypoint for Exotel voice, outbound calls, health, and runtime status
- Exotel WebSocket transport for telephony audio
- Outbound calling through Exotel or LiveKit SIP, with `.env`-based provider selection

## Active Flow

1. `uvicorn api:app --reload` starts the unified API.
2. Exotel streams audio to `/exotel/voice`.
3. The Exotel transport converts that stream into a Pipecat transport.
4. The main callback bot runs either:
   - `RUNTIME_FLAG=legacy`: STT -> LLM or scripted agent -> Sarvam TTS
   - `RUNTIME_FLAG=google-live`: Gemini Live audio-to-audio over websocket
5. `/api/calls/outbound` creates outbound calls through Exotel or LiveKit SIP.

## Main Components

- `services/callback_bot_service.py`: main Pipecat callback bot
- `services/exotel_transport_service.py`: Exotel media transport
- `services/exotel_gateway_service.py`: Exotel route handling and session tracking
- `services/outbound_call_service.py`: outbound call orchestration
- `routes/`: thin FastAPI routers

## Setup

This project currently needs Python `>=3.10,<3.14`. On this machine, use `python3.11`.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` with the provider keys you actually use:

- `SARVAM_API_KEY`
- `DEEPGRAM_API_KEY` or `GEMINI_API_KEY` for STT
- one LLM key: `GROQ_API_KEY` or `GEMINI_API_KEY` or `OPENAI_API_KEY`
- Exotel keys for Exotel inbound/outbound
- LiveKit keys if you want the LiveKit SIP path

To force SIP outbound even when Exotel is configured, set:

```bash
OUTBOUND_PROVIDER=livekit
```

Supported values:

- `auto`: prefer Exotel when configured, otherwise LiveKit SIP
- `livekit` or `sip`: always use LiveKit SIP
- `exotel`: always use Exotel

To enable Google Live audio-to-audio for calls, set:

```bash
RUNTIME_FLAG=google-live
```

This keeps the old path available by switching back to:

```bash
RUNTIME_FLAG=legacy
```

## Gemini Voice Collection

Seed the backend collection from the checked-in JSON file with:

```bash
python scripts/seed_gemini_voice_previews.py
```

Use `--replace` if you want to clear the existing `gemini_voice_previews` collection first:

```bash
python scripts/seed_gemini_voice_previews.py --replace
```

## Run

```bash
uvicorn api:app --reload
```

This is the only backend startup command. Exotel voice handling, Pipecat bot execution, outbound Exotel calls, and LiveKit SIP fallback all run from this process.

## Main Routes

- `GET /api/health`
- `GET /api/runtime/status`
- `GET /api/runtime/prompt`
- `POST /api/runtime/prompt`
- `WS /exotel/voice`
- `GET /exotel/health`
- `GET /exotel/debug`
- `POST /exotel-webhook`
- `POST /api/calls/outbound`
- `GET /api/calls/{call_id}/status`

## Notes

- `handle_extracted_parameters` validates and logs collected answers; calendar event creation is disabled in the current bot implementation.
- Business hours and prompt file are configurable through `.env`.
- `/api/calls/outbound` respects `OUTBOUND_PROVIDER`. If it is `auto`, Exotel is preferred when configured.
