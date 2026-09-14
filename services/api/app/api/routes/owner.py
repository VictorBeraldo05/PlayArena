from __future__ import annotations

import logging
from datetime import date
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status

from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.dependencies.auth import get_current_role, get_current_user
from app.repositories import owner_repository
from app.repositories.owner_repository import OwnerResourceNotFoundError, ReservationConflictError, ReservationStateError
from app.schemas.auth import AuthenticatedUser
from app.schemas.owner import (
    ArenaResponse,
    ArenaLogoUpdate,
    ArenaUpdate,
    CourtCreate,
    CourtResponse,
    CourtSportsUpdate,
    CourtUpdate,
    OpeningHourResponse,
    OpeningHoursUpdate,
    OwnerDashboardResponse,
    PricingRuleCreate,
    PricingRuleResponse,
    PricingRuleUpdate,
    SportResponse,
)
from app.schemas.agenda import BlockedSlotCreate, ManualReservationCreate
from app.services.notifications import send_reservation_status_notification

router = APIRouter(prefix="/owner", tags=["owner configuration"])
sports_router = APIRouter(tags=["sports"])
logger = logging.getLogger(__name__)


def require_arena_owner(
    current_user: AuthenticatedUser = Depends(get_current_user),
    profile_role_value: str = Depends(get_current_role),
) -> AuthenticatedUser:
    if profile_role_value != "arena_owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Arena owner access required.")
    return current_user


def translate_repository_error(exc: Exception) -> None:
    if isinstance(exc, ReservationConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esse horario acabou de ser reservado.") from exc
    if isinstance(exc, ReservationStateError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A reserva não pode ser alterada no status atual.") from exc
    if isinstance(exc, OwnerResourceNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found.") from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    raise exc


def enforce_owner_mutation_limit(request: Request, current_user: AuthenticatedUser) -> None:
    enforce_rate_limit(
        request,
        scope="owner-mutation",
        principal=f"user:{current_user.id}",
        limit=settings.owner_mutation_rate_limit_per_minute,
    )


@sports_router.get("/sports", response_model=list[SportResponse])
def get_sports() -> list[dict]:
    return owner_repository.list_sports()


@router.get("/arenas", response_model=list[ArenaResponse])
def get_arenas(current_user: AuthenticatedUser = Depends(require_arena_owner)) -> list[dict]:
    return owner_repository.list_arenas(current_user.id)


@router.get("/arenas/{arena_id}", response_model=ArenaResponse)
def get_owner_arena(arena_id: UUID, current_user: AuthenticatedUser = Depends(require_arena_owner)) -> dict:
    try:
        return owner_repository.get_arena(current_user.id, arena_id)
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.patch("/arenas/{arena_id}", response_model=ArenaResponse)
def patch_owner_arena(
    request: Request,
    arena_id: UUID,
    input_data: ArenaUpdate,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> dict:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return owner_repository.update_arena(current_user.id, arena_id, input_data.model_dump(exclude_unset=True))
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.patch("/arenas/{arena_id}/logo", response_model=ArenaResponse)
def patch_owner_arena_logo(
    request: Request,
    arena_id: UUID,
    input_data: ArenaLogoUpdate,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> dict:
    enforce_owner_mutation_limit(request, current_user)
    logo_path = input_data.logo_path
    if logo_path is not None and not logo_path.startswith(f"arenas/{arena_id}/"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid arena logo path.")
    try:
        return owner_repository.update_arena(current_user.id, arena_id, {"logo_path": logo_path})
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.get("/arenas/{arena_id}/courts", response_model=list[CourtResponse])
def get_courts(arena_id: UUID, current_user: AuthenticatedUser = Depends(require_arena_owner)) -> list[dict]:
    try:
        return owner_repository.list_courts(current_user.id, arena_id)
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.post("/arenas/{arena_id}/courts", response_model=CourtResponse, status_code=status.HTTP_201_CREATED)
def post_court(
    request: Request,
    arena_id: UUID,
    input_data: CourtCreate,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> dict:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return owner_repository.create_court(current_user.id, arena_id, input_data.model_dump())
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.patch("/courts/{court_id}", response_model=CourtResponse)
def patch_court(
    request: Request,
    court_id: UUID,
    input_data: CourtUpdate,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> dict:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return owner_repository.update_court(current_user.id, court_id, input_data.model_dump(exclude_unset=True))
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.get("/courts/{court_id}/sports", response_model=list[SportResponse])
def get_court_sports(court_id: UUID, current_user: AuthenticatedUser = Depends(require_arena_owner)) -> list[dict]:
    try:
        return owner_repository.get_court_sports(current_user.id, court_id)
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.put("/courts/{court_id}/sports", response_model=list[SportResponse])
def put_court_sports(
    request: Request,
    court_id: UUID,
    input_data: CourtSportsUpdate,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> list[dict]:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return owner_repository.replace_court_sports(current_user.id, court_id, input_data.sport_ids)
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.get("/arenas/{arena_id}/opening-hours", response_model=list[OpeningHourResponse])
def get_opening_hours(arena_id: UUID, current_user: AuthenticatedUser = Depends(require_arena_owner)) -> list[dict]:
    try:
        return owner_repository.list_opening_hours(current_user.id, arena_id)
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.put("/arenas/{arena_id}/opening-hours", response_model=list[OpeningHourResponse])
def put_opening_hours(
    request: Request,
    arena_id: UUID,
    input_data: OpeningHoursUpdate,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> list[dict]:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return owner_repository.replace_opening_hours(
            current_user.id,
            arena_id,
            [hour.model_dump() for hour in input_data.hours],
        )
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.get("/arenas/{arena_id}/pricing-rules", response_model=list[PricingRuleResponse])
def get_pricing_rules(arena_id: UUID, current_user: AuthenticatedUser = Depends(require_arena_owner)) -> list[dict]:
    try:
        return owner_repository.list_pricing_rules(current_user.id, arena_id)
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.post("/arenas/{arena_id}/pricing-rules", response_model=PricingRuleResponse, status_code=status.HTTP_201_CREATED)
def post_pricing_rule(
    request: Request,
    arena_id: UUID,
    input_data: PricingRuleCreate,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> dict:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return owner_repository.create_pricing_rule(current_user.id, arena_id, input_data.model_dump())
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.patch("/pricing-rules/{pricing_rule_id}", response_model=PricingRuleResponse)
def patch_pricing_rule(
    request: Request,
    pricing_rule_id: UUID,
    input_data: PricingRuleUpdate,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> dict:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return owner_repository.update_pricing_rule(
            current_user.id,
            pricing_rule_id,
            input_data.model_dump(exclude_unset=True),
        )
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.delete("/pricing-rules/{pricing_rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_pricing_rule(
    request: Request,
    pricing_rule_id: UUID,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> Response:
    enforce_owner_mutation_limit(request, current_user)
    try:
        owner_repository.delete_pricing_rule(current_user.id, pricing_rule_id)
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/arenas/{arena_id}/dashboard", response_model=OwnerDashboardResponse)
def get_owner_dashboard(arena_id: UUID, current_user: AuthenticatedUser = Depends(require_arena_owner)) -> dict:
    try:
        return owner_repository.get_dashboard(current_user.id, arena_id)
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.post("/blocked-slots", status_code=status.HTTP_201_CREATED)
def post_blocked_slot(request: Request, input_data: BlockedSlotCreate, current_user: AuthenticatedUser = Depends(require_arena_owner)) -> dict:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return owner_repository.create_blocked_slot(current_user.id, input_data.model_dump())
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.get("/reservations")
def get_owner_reservations(current_user: AuthenticatedUser = Depends(require_arena_owner)) -> list[dict]:
    return owner_repository.list_owner_reservations(current_user.id)


@router.get("/blocked-slots")
def get_owner_blocked_slots(current_user: AuthenticatedUser = Depends(require_arena_owner)) -> list[dict]:
    return owner_repository.list_owner_blocked_slots(current_user.id)


@router.delete("/blocked-slots/{blocked_slot_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_blocked_slot(request: Request, blocked_slot_id: UUID, current_user: AuthenticatedUser = Depends(require_arena_owner)) -> Response:
    enforce_owner_mutation_limit(request, current_user)
    try:
        owner_repository.delete_blocked_slot(current_user.id, blocked_slot_id)
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/dashboard-summary")
def get_dashboard_summary(current_user: AuthenticatedUser = Depends(require_arena_owner)) -> dict:
    summary = owner_repository.get_dashboard_summary(current_user.id)
    logger.info(
        "[DASHBOARD_SUMMARY] owner_id=%s today=%s week=%s revenue=%s occupancy=%s pending=%s next=%s",
        current_user.id,
        summary["reservations_today"],
        summary["reservations_week"],
        summary["app_revenue"],
        summary["occupancy_today"],
        summary["pending_count"],
        len(summary["next_reservations"]),
    )
    return summary


@router.get("/agenda")
def get_owner_agenda(
    day: date,
    court_id: UUID | None = None,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> list[dict]:
    return owner_repository.get_agenda_slots(current_user.id, day, court_id)


@router.post("/reservations/manual", status_code=status.HTTP_201_CREATED)
def post_manual_reservation(request: Request, input_data: ManualReservationCreate, current_user: AuthenticatedUser = Depends(require_arena_owner)) -> dict:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return owner_repository.create_manual_reservation(current_user.id, input_data.model_dump())
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


def change_reservation_status(
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser,
    reservation_id: UUID,
    next_status: str,
) -> dict:
    changed = owner_repository.update_reservation_status(current_user.id, reservation_id, next_status)
    background_tasks.add_task(
        send_reservation_status_notification,
        changed["id"],
        changed["previous_status"],
        changed["status"],
    )
    # Keep the public response contract limited to the persisted reservation state.
    return {"id": changed["id"], "status": changed["status"]}


@router.post("/reservations/{reservation_id}/confirm")
def confirm_reservation(
    request: Request,
    background_tasks: BackgroundTasks,
    reservation_id: UUID,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> dict:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return change_reservation_status(background_tasks, current_user, reservation_id, "confirmed")
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)


@router.post("/reservations/{reservation_id}/cancel")
def cancel_reservation(
    request: Request,
    background_tasks: BackgroundTasks,
    reservation_id: UUID,
    current_user: AuthenticatedUser = Depends(require_arena_owner),
) -> dict:
    enforce_owner_mutation_limit(request, current_user)
    try:
        return change_reservation_status(background_tasks, current_user, reservation_id, "cancelled")
    except Exception as exc:  # noqa: BLE001
        translate_repository_error(exc)
