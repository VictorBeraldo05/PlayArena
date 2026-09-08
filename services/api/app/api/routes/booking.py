import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies.auth import get_current_role, get_current_user
from app.repositories.booking_repository import (
    BookingConflictError,
    available,
    create_player_reservation,
    list_player_reservations,
    public_arena,
    public_arenas,
)
from app.schemas.auth import AuthenticatedUser
from app.schemas.booking import AvailabilityOption, PlayerReservationCreate

router = APIRouter(tags=["availability and reservations"])
logger = logging.getLogger(__name__)


def require_player(
    current_user: AuthenticatedUser = Depends(get_current_user),
    profile_role_value: str = Depends(get_current_role),
) -> AuthenticatedUser:
    if profile_role_value != "player":
        logger.info("[PLAYER_RESERVATIONS] access denied user_id=%s role=%s", current_user.id, profile_role_value)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Player access required.")
    return current_user

@router.get("/arenas")
def get_public_arenas(city: str | None = None) -> list[dict]:
    try:
        return public_arenas(city)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[PLAYER_CATALOG] failed city=%s type=%s message=%s", city, type(exc).__name__, str(exc))
        raise

@router.get("/arenas/{arena_id}")
def get_public_arena(arena_id: UUID) -> dict:
    arena = public_arena(arena_id)
    if arena is None: raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Arena not found.")
    return arena


@router.get("/availability", response_model=list[AvailabilityOption], response_model_exclude_none=True)
def get_availability(
    city: str = Query(min_length=1),
    sport: str = Query(min_length=1),
    start_at: datetime = Query(),
) -> list[dict]:
    return available(city, sport, start_at)


@router.post("/player/reservations", status_code=status.HTTP_201_CREATED)
def post_player_reservation(
    input_data: PlayerReservationCreate,
    current_user: AuthenticatedUser = Depends(require_player),
) -> dict:
    try:
        return create_player_reservation(current_user.id, input_data.model_dump())
    except BookingConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esse horario acabou de ser reservado.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/player/reservations")
def get_player_reservations(current_user: AuthenticatedUser = Depends(require_player)) -> list[dict]:
    try:
        reservations = list_player_reservations(current_user.id)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "[PLAYER_RESERVATIONS] failed user_id=%s type=%s message=%s",
            current_user.id,
            type(exc).__name__,
            str(exc),
        )
        raise

    logger.info(
        "[PLAYER_RESERVATIONS] user_id=%s count=%d ids=%s statuses=%s start_at=%s end_at=%s",
        current_user.id,
        len(reservations),
        [str(reservation["id"]) for reservation in reservations],
        [reservation["status"] for reservation in reservations],
        [str(reservation["start_at"]) for reservation in reservations],
        [str(reservation["end_at"]) for reservation in reservations],
    )
    return reservations
