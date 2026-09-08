from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, status

from app.core.config import settings
from app.schemas.auth import AuthenticatedUser

logger = logging.getLogger(__name__)


class SupabaseAuthVerifier:
    """Validates user access tokens through Supabase Auth's user endpoint."""

    def __init__(self, supabase_url: str | None, supabase_anon_key: str | None) -> None:
        self.user_url = f"{supabase_url.rstrip('/')}/auth/v1/user" if supabase_url else None
        self.supabase_anon_key = supabase_anon_key

    def verify_access_token(self, token: str) -> AuthenticatedUser:
        token_metadata = self._token_metadata(token)
        logger.info("[AUTH] validating Supabase access token")

        if not self.user_url or not self.supabase_anon_key:
            self._log_failure(token_metadata, "Supabase Auth configuration is incomplete")
            raise self._invalid_token_error()

        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.get(
                    self.user_url,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "apikey": self.supabase_anon_key,
                    },
                )
        except httpx.HTTPError as exc:
            self._log_failure(token_metadata, f"Supabase Auth request failed: {type(exc).__name__}")
            raise self._invalid_token_error() from exc

        logger.info("[AUTH] Supabase /auth/v1/user status=%s", response.status_code)

        if response.status_code != status.HTTP_200_OK:
            self._log_failure(token_metadata, f"Supabase Auth rejected token with HTTP {response.status_code}")
            raise self._invalid_token_error()

        try:
            user: dict[str, Any] = response.json()
        except ValueError as exc:
            self._log_failure(token_metadata, "Supabase Auth returned an invalid user response")
            raise self._invalid_token_error() from exc

        user_id = user.get("id")
        if not isinstance(user_id, str) or not user_id:
            self._log_failure(token_metadata, "Supabase Auth response did not include a user id")
            raise self._invalid_token_error()

        authenticated_user = AuthenticatedUser(
            id=user_id,
            email=user.get("email") if isinstance(user.get("email"), str) else None,
            auth_role=user.get("role") if isinstance(user.get("role"), str) else None,
        )
        logger.info("[AUTH] authenticated user id=%s", authenticated_user.id)
        return authenticated_user

    @staticmethod
    def _invalid_token_error() -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )

    @staticmethod
    def _token_metadata(token: str) -> dict[str, str | None]:
        """Decode unverified metadata for logs only; it is never used for authorization."""
        metadata: dict[str, str | None] = {"algorithm": None, "kid": None, "issuer": None}

        try:
            header = jwt.get_unverified_header(token)
            claims = jwt.decode(
                token,
                options={"verify_signature": False, "verify_exp": False, "verify_aud": False},
            )
            metadata["algorithm"] = header.get("alg")
            metadata["kid"] = header.get("kid")
            metadata["issuer"] = claims.get("iss")
        except jwt.PyJWTError:
            pass

        return metadata

    @staticmethod
    def _log_failure(token_metadata: dict[str, str | None], reason: str) -> None:
        logger.warning(
            "Supabase access-token validation failed: %s; algorithm=%s kid=%s issuer=%s",
            reason,
            token_metadata["algorithm"],
            token_metadata["kid"],
            token_metadata["issuer"],
        )


@lru_cache
def get_auth_verifier() -> SupabaseAuthVerifier:
    return SupabaseAuthVerifier(settings.supabase_url, settings.supabase_anon_key)
