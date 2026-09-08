import pytest
from pydantic import ValidationError
from pathlib import Path

from app.api.routes import owner
from app.schemas.auth import AuthenticatedUser
from app.schemas.owner import CourtCreate


def test_active_court_requires_at_least_one_sport() -> None:
    with pytest.raises(ValidationError, match="Selecione pelo menos uma modalidade"):
        CourtCreate(name="Campo 1", active=True, sport_ids=[])


def test_inactive_court_can_be_created_without_sport() -> None:
    court = CourtCreate(name="Campo em preparação", active=False, sport_ids=[])
    assert court.sport_ids == []


def test_sports_endpoint_returns_society(monkeypatch) -> None:
    monkeypatch.setattr(owner.owner_repository, "list_sports", lambda: [{"id": 1, "name": "Society", "slug": "society"}])
    result = owner.get_sports()
    assert result == [{"id": 1, "name": "Society", "slug": "society"}]


def test_sports_seed_contains_society() -> None:
    seed = Path(__file__).resolve().parents[3] / "supabase" / "seed" / "202608310001_sports.sql"
    assert "('Society', 'society')" in seed.read_text(encoding="utf-8")
