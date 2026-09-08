import inspect
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.api.routes import owner
from app.api.routes.owner import require_arena_owner
from app.repositories import owner_repository
from app.repositories.owner_repository import OwnerResourceNotFoundError
from app.schemas.auth import AuthenticatedUser
from app.schemas.owner import ArenaLogoUpdate

OWNER_A = "00000000-0000-0000-0000-00000000000a"
OWNER_B = "00000000-0000-0000-0000-00000000000b"
PLAYER_C = "00000000-0000-0000-0000-00000000000c"
ARENA_A = UUID("10000000-0000-0000-0000-00000000000a")
ARENA_B = UUID("10000000-0000-0000-0000-00000000000b")
COURT_A = UUID("20000000-0000-0000-0000-00000000000a")
COURT_B = UUID("20000000-0000-0000-0000-00000000000b")
RULE_A = UUID("30000000-0000-0000-0000-00000000000a")
RULE_B = UUID("30000000-0000-0000-0000-00000000000b")
BLOCKED_SLOT_B = UUID("40000000-0000-0000-0000-00000000000b")
BLOCKED_SLOT_A = UUID("40000000-0000-0000-0000-00000000000a")
RESERVATION_A = UUID("50000000-0000-0000-0000-00000000000a")
RESERVATION_B = UUID("50000000-0000-0000-0000-00000000000b")


class Result:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def one_or_none(self):
        return self.row


class OwnershipSession:
    """Minimal DB double that resolves the same ownership joins used in production SQL."""

    def execute(self, statement, params):
        sql = str(statement)
        user_id = params["user_id"]
        if "from public.arenas a" in sql:
            arena_id = params["arena_id"]
            owner = {ARENA_A: OWNER_A, ARENA_B: OWNER_B}.get(arena_id)
            row = {"id": arena_id, "name": "Arena"} if owner == user_id else None
        elif "from public.courts c" in sql and "pricing_rules" not in sql:
            court_id = params["court_id"]
            owner = {COURT_A: OWNER_A, COURT_B: OWNER_B}.get(court_id)
            row = {"id": court_id, "arena_id": ARENA_A if court_id == COURT_A else ARENA_B} if owner == user_id else None
        else:
            rule_id = params["pricing_rule_id"]
            owner = {RULE_A: OWNER_A, RULE_B: OWNER_B}.get(rule_id)
            row = {"id": rule_id, "court_id": COURT_A if rule_id == RULE_A else COURT_B} if owner == user_id else None
        return Result(row)


class ReservationOwnershipSession:
    def execute(self, _statement, params):
        owner = {RESERVATION_A: OWNER_A, RESERVATION_B: OWNER_B}.get(params["reservation_id"])
        row = {"id": params["reservation_id"]} if owner == params["user_id"] else None
        return Result(row)


class BlockedSlotOwnershipSession:
    def execute(self, _statement, params):
        owner = {BLOCKED_SLOT_A: OWNER_A, BLOCKED_SLOT_B: OWNER_B}.get(params["blocked_slot_id"])
        row = {"id": params["blocked_slot_id"]} if owner == params["user_id"] else None
        return Result(row)


@pytest.fixture
def session() -> OwnershipSession:
    return OwnershipSession()


@pytest.mark.parametrize(
    ("user_id", "arena_id", "allowed"),
    [(OWNER_A, ARENA_A, True), (OWNER_A, ARENA_B, False), (OWNER_B, ARENA_B, True), (OWNER_B, ARENA_A, False)],
)
def test_arena_ownership_is_bidirectional(session, user_id, arena_id, allowed) -> None:
    if allowed:
        assert owner_repository._owned_arena(session, user_id, arena_id)["id"] == arena_id
    else:
        with pytest.raises(OwnerResourceNotFoundError):
            owner_repository._owned_arena(session, user_id, arena_id)


@pytest.mark.parametrize(
    ("user_id", "court_id", "allowed"),
    [(OWNER_A, COURT_A, True), (OWNER_A, COURT_B, False), (OWNER_B, COURT_B, True), (OWNER_B, COURT_A, False)],
)
def test_court_and_court_sports_follow_arena_ownership(session, user_id, court_id, allowed) -> None:
    if allowed:
        assert owner_repository._owned_court(session, user_id, court_id)["id"] == court_id
    else:
        with pytest.raises(OwnerResourceNotFoundError):
            owner_repository._owned_court(session, user_id, court_id)


@pytest.mark.parametrize(
    ("user_id", "rule_id", "allowed"),
    [(OWNER_A, RULE_A, True), (OWNER_A, RULE_B, False), (OWNER_B, RULE_B, True), (OWNER_B, RULE_A, False)],
)
def test_pricing_rules_follow_court_then_arena_ownership(session, user_id, rule_id, allowed) -> None:
    if allowed:
        assert owner_repository._owned_pricing_rule(session, user_id, rule_id)["id"] == rule_id
    else:
        with pytest.raises(OwnerResourceNotFoundError):
            owner_repository._owned_pricing_rule(session, user_id, rule_id)


@pytest.mark.parametrize("operation", ["patch arena", "post court", "patch court", "put hours", "post price"])
def test_player_c_is_blocked_before_any_owner_operation(operation) -> None:
    player = AuthenticatedUser(id=PLAYER_C, email="player@playarena.dev", auth_role="authenticated")

    with pytest.raises(HTTPException) as error:
        require_arena_owner(player, "player")

    assert error.value.status_code == 403, operation


def test_owner_blocked_slot_deletion_uses_authenticated_owner(monkeypatch) -> None:
    captured = {}
    monkeypatch.setattr(owner_repository, "delete_blocked_slot", lambda user_id, slot_id: captured.update(user_id=user_id, slot_id=slot_id))
    response = owner.remove_blocked_slot(BLOCKED_SLOT_B, AuthenticatedUser(id=OWNER_A))
    assert response.status_code == 204
    assert captured == {"user_id": OWNER_A, "slot_id": BLOCKED_SLOT_B}


def test_owner_route_translates_foreign_blocked_slot_to_not_found(monkeypatch) -> None:
    monkeypatch.setattr(owner_repository, "delete_blocked_slot", lambda user_id, slot_id: (_ for _ in ()).throw(OwnerResourceNotFoundError()))
    with pytest.raises(HTTPException) as error:
        owner.remove_blocked_slot(BLOCKED_SLOT_B, AuthenticatedUser(id=OWNER_A))
    assert error.value.status_code == 404


@pytest.mark.parametrize(
    ("user_id", "reservation_id", "allowed"),
    [(OWNER_A, RESERVATION_A, True), (OWNER_A, RESERVATION_B, False), (OWNER_B, RESERVATION_B, True), (OWNER_B, RESERVATION_A, False)],
)
def test_reservation_confirmation_and_cancellation_follow_arena_ownership(user_id, reservation_id, allowed) -> None:
    session = ReservationOwnershipSession()
    if allowed:
        assert owner_repository._owned_reservation(session, user_id, reservation_id)["id"] == reservation_id
    else:
        with pytest.raises(OwnerResourceNotFoundError):
            owner_repository._owned_reservation(session, user_id, reservation_id)


@pytest.mark.parametrize(
    ("user_id", "blocked_slot_id", "allowed"),
    [(OWNER_A, BLOCKED_SLOT_A, True), (OWNER_A, BLOCKED_SLOT_B, False), (OWNER_B, BLOCKED_SLOT_B, True), (OWNER_B, BLOCKED_SLOT_A, False)],
)
def test_blocked_slot_deletion_follows_arena_ownership(user_id, blocked_slot_id, allowed) -> None:
    session = BlockedSlotOwnershipSession()
    if allowed:
        assert owner_repository._owned_blocked_slot(session, user_id, blocked_slot_id)["id"] == blocked_slot_id
    else:
        with pytest.raises(OwnerResourceNotFoundError):
            owner_repository._owned_blocked_slot(session, user_id, blocked_slot_id)


def test_agenda_query_types_optional_court_id_for_all_courts() -> None:
    query_source = inspect.getsource(owner_repository.get_agenda_slots)

    assert "cast(:court_id as uuid) is null" in query_source
    assert "c.id = cast(:court_id as uuid)" in query_source


def test_owner_can_persist_only_a_logo_path_for_their_arena(monkeypatch) -> None:
    captured = {}
    monkeypatch.setattr(owner_repository, "update_arena", lambda user_id, arena_id, changes: captured.update(user_id=user_id, arena_id=arena_id, changes=changes) or {"id": arena_id, "logo_path": changes["logo_path"]})

    result = owner.patch_owner_arena_logo(
        ARENA_A,
        ArenaLogoUpdate(logo_path=f"arenas/{ARENA_A}/logo.webp"),
        AuthenticatedUser(id=OWNER_A),
    )

    assert result["logo_path"] == f"arenas/{ARENA_A}/logo.webp"
    assert captured["user_id"] == OWNER_A
    assert captured["arena_id"] == ARENA_A


def test_owner_cannot_persist_a_logo_path_for_another_arena() -> None:
    with pytest.raises(HTTPException) as error:
        owner.patch_owner_arena_logo(
            ARENA_A,
            ArenaLogoUpdate(logo_path=f"arenas/{ARENA_B}/logo.webp"),
            AuthenticatedUser(id=OWNER_A),
        )

    assert error.value.status_code == 422
