import logging
from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status

from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.dependencies.auth import get_current_role, get_current_user
from app.repositories.booking_repository import (
    BookingConflictError,
    PlayerCancellationWindowClosedError,
    PlayerReservationCancellationConflictError,
    PlayerReservationNotFoundError,
    PlayerReservationStateError,
    PublicScheduleCourtNotFoundError,
    available,
    cancel_player_reservation,
    create_player_reservation,
    list_player_reservations,
    public_arena,
    public_arenas,
    public_arena_schedule,
)
from app.schemas.auth import AuthenticatedUser
from app.schemas.booking import (
    SAO_PAULO_TIME_ZONE,
    AvailabilityOption,
    PlayerReservationCreate,
    PublicArenaSchedule,
    validate_future_booking_start,
)
from app.services.notifications import send_reservation_status_notification

router = APIRouter(tags=["availability and reservations"])
logger = logging.getLogger(__name__)


def require_player(
    current_user: AuthenticatedUser = Depends(get_current_user),
    profile_role_value: str = Depends(get_current_role),
) -> AuthenticatedUser:
    if profile_role_value != "player":
        logger.info("[PLAYER_RESERVATIONS] access denied role=%s", profile_role_value)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Player access required.")
    return current_user

@router.get("/arenas")
def get_public_arenas(city: str | None = None) -> list[dict]:
    try:
        return public_arenas(city)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[PLAYER_CATALOG] failed type=%s", type(exc).__name__)
        raise

@router.get("/arenas/{arena_id}")
def get_public_arena(arena_id: UUID) -> dict:
    arena = public_arena(arena_id)
    if arena is None: raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Arena not found.")
    return arena


@router.get("/arenas/{arena_id}/schedule", response_model=PublicArenaSchedule)
def get_public_arena_schedule(
    arena_id: UUID,
    day: date | None = None,
    court_id: UUID | None = None,
) -> dict:
    selected_day = day or datetime.now(SAO_PAULO_TIME_ZONE).date()
    if selected_day < datetime.now(SAO_PAULO_TIME_ZONE).date():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A data deve ser hoje ou futura.")
    try:
        schedule = public_arena_schedule(arena_id, selected_day, court_id)
    except PublicScheduleCourtNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Court not found for this arena.") from exc
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Arena not found.")
    return schedule


@router.get("/availability", response_model=list[AvailabilityOption], response_model_exclude_none=True)
def get_availability(
    request: Request,
    city: str | None = Query(default=None, min_length=1, max_length=120),
    sport: str = Query(min_length=1, max_length=120),
    start_at: datetime = Query(),
    arena_id: UUID | None = None,
    court_id: UUID | None = None,
) -> list[dict]:
    enforce_rate_limit(request, scope="availability", limit=settings.availability_rate_limit_per_minute)
    try:
        if city is None and arena_id is None:
            raise ValueError("city or arena_id is required")
        validate_future_booking_start(start_at)
        if arena_id is None and court_id is None:
            return available(city, sport, start_at)
        return available(city, sport, start_at, arena_id=arena_id, court_id=court_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.post("/player/reservations", status_code=status.HTTP_201_CREATED)
def post_player_reservation(
    request: Request,
    input_data: PlayerReservationCreate,
    current_user: AuthenticatedUser = Depends(require_player),
) -> dict:
    enforce_rate_limit(
        request,
        scope="reservation",
        principal=f"user:{current_user.id}",
        limit=settings.reservation_rate_limit_per_minute,
    )
    del input_data
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "payment_required", "message": "Use o checkout para solicitar esta reserva."},
    )


@router.get("/player/reservations")
def get_player_reservations(current_user: AuthenticatedUser = Depends(require_player)) -> list[dict]:
    try:
        reservations = list_player_reservations(current_user.id)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "[PLAYER_RESERVATIONS] failed type=%s",
            type(exc).__name__,
        )
        raise

    logger.info("[PLAYER_RESERVATIONS] loaded count=%d", len(reservations))
    return reservations


@router.patch("/player/reservations/{reservation_id}/cancel")
def patch_player_reservation_cancel(
    request: Request,
    background_tasks: BackgroundTasks,
    reservation_id: UUID,
    current_user: AuthenticatedUser = Depends(require_player),
) -> dict:
    enforce_rate_limit(
        request,
        scope="reservation",
        principal=f"user:{current_user.id}",
        limit=settings.reservation_rate_limit_per_minute,
    )
    try:
        changed = cancel_player_reservation(current_user.id, reservation_id)
    except PlayerReservationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reservation not found.") from exc
    except PlayerCancellationWindowClosedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "cancellation_window_closed", "message": "Esta reserva não pode mais ser cancelada."},
        ) from exc
    except (PlayerReservationStateError, PlayerReservationCancellationConflictError) as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "reservation_not_cancellable", "message": "Esta reserva não pode ser cancelada."},
        ) from exc

    background_tasks.add_task(
        send_reservation_status_notification,
        changed["id"],
        changed["previous_status"],
        changed["status"],
        cancellation_by_player=True,
    )
    return {"id": changed["id"], "status": changed["status"]}
