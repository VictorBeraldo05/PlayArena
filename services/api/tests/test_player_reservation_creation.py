import inspect

import pytest

from app.api.routes import booking
from app.repositories import booking_repository


def test_legacy_repository_never_creates_unpaid_pending_reservation() -> None:
    with pytest.raises(ValueError, match="Payment checkout is required"):
        booking_repository.create_player_reservation("player-id", {"court_id": "court-id"})


def test_paid_reservation_insert_is_owned_by_payment_repository() -> None:
    source = inspect.getsource(booking_repository.create_player_reservation)
    assert "insert into public.reservations" not in source.lower()
    assert "payment checkout is required" in source.lower()
    assert "payment_required" in inspect.getsource(booking.post_player_reservation)
