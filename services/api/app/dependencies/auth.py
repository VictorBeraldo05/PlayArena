from __future__ import annotations

import logging

from fastapi import Depends, Header, HTTPException, status

from app.repositories.profile_repository import get_profile_role
from app.schemas.auth import AuthenticatedUser
from app.services.auth import SupabaseAuthVerifier, get_auth_verifier

logger = logging.getLogger(__name__)


def get_current_user(
    authorization: str | None = Header(default=None),
    verifier: SupabaseAuthVerifier = Depends(get_auth_verifier),
) -> AuthenticatedUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    token = authorization.removeprefix("Bearer ").strip()
    return verifier.verify_access_token(token)


def get_current_role(current_user: AuthenticatedUser = Depends(get_current_user)) -> str:
    try:
        profile_role = get_profile_role(current_user.id)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "[PROFILE] failed to load profile for user=%s; exception=%s message=%s",
            current_user.id,
            type(exc).__name__,
            str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load user profile.",
        ) from exc

    if profile_role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found.",
        )

    return profile_role
