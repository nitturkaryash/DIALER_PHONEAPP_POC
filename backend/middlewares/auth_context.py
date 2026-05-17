from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from services.auth_service import decode_access_token, get_user_by_id


class AuthContextMiddleware(BaseHTTPMiddleware):
    """Attach an authenticated user to request.state when a bearer token is present.

    The middleware stays non-blocking. Protected routes must still enforce auth with a
    route-level dependency such as ``utils.jwt_auth.current_user``.
    """

    async def dispatch(self, request: Request, call_next):
        request.state.user = None
        request.state.user_id = None

        auth = (request.headers.get("authorization") or "").strip()
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
            if token:
                try:
                    payload = decode_access_token(token)
                    user = await get_user_by_id(payload.get("sub", ""))
                    if user:
                        request.state.user = user
                        request.state.user_id = user.get("id")
                except Exception:
                    # Keep middleware non-blocking; route-level auth decides.
                    pass

        return await call_next(request)

