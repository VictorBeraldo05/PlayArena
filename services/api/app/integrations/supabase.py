from __future__ import annotations

from functools import lru_cache
from typing import Any

import httpx

from app.core.config import settings


class SupabaseAdminClient:
    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key

    def auth_headers(self) -> dict[str, str]:
        return {
            "apikey": self._api_key,
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    async def get(self, path: str) -> httpx.Response:
        async with httpx.AsyncClient(base_url=self._base_url, headers=self.auth_headers()) as client:
            return await client.get(path)

    async def post(self, path: str, payload: dict[str, Any]) -> httpx.Response:
        async with httpx.AsyncClient(base_url=self._base_url, headers=self.auth_headers()) as client:
            return await client.post(path, json=payload)


@lru_cache
def get_supabase_admin_client() -> SupabaseAdminClient | None:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None

    return SupabaseAdminClient(
        base_url=f"{settings.supabase_url}/rest/v1",
        api_key=settings.supabase_service_role_key,
    )
