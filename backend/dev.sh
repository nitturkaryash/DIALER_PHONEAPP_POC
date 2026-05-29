#!/usr/bin/env bash
# Listen on all interfaces so Expo Go on your phone can reach the API.
cd "$(dirname "$0")"
exec ./venv/bin/uvicorn api:app --reload --host 0.0.0.0 --port 8000
