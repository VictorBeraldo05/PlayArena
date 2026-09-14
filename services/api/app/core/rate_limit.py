from __future__ import annotations

from collections import deque
from threading import Lock
from time import monotonic

from fastapi import HTTPException, Request, status

from app.core.config import settings


class InMemoryRateLimiter:
    """Small per-process limiter that avoids persisting IP addresses or PII."""

    def __init__(self) -> None:
        self._windows: dict[str, deque[float]] = {}
        self._lock = Lock()

    def allow(self, key: str, limit: int, window_seconds: int) -> bool:
        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            entries = self._windows.setdefault(key, deque())
            while entries and entries[0] <= cutoff:
                entries.popleft()
            if len(entries) >= limit:
                return False
            entries.append(now)
            if len(self._windows) > 10_000:
                self._windows = {candidate: values for candidate, values in self._windows.items() if values and values[-1] > cutoff}
            return True


rate_limiter = InMemoryRateLimiter()


def client_identifier(request: Request) -> str:
    """Use forwarding headers only when the deployment explicitly trusts its proxy."""
    if settings.trust_proxy_headers:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",", 1)[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def enforce_rate_limit(
    request: Request,
    *,
    scope: str,
    limit: int,
    principal: str | None = None,
    window_seconds: int = 60,
) -> None:
    identity = principal or f"ip:{client_identifier(request)}"
    if rate_limiter.allow(f"{scope}:{identity}", limit, window_seconds):
        return
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many requests. Please try again shortly.",
        headers={"Retry-After": str(window_seconds)},
    )
