from app.api.routes import owner
from app.repositories import owner_repository
from app.schemas.auth import AuthenticatedUser


class MappingResult:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def mappings(self):
        return self

    def one(self):
        return self.row

    def __iter__(self):
        return iter(self.rows)


class SummarySession:
    def __init__(self):
        self.statements: list[str] = []
        self.params: list[dict] = []

    def execute(self, statement, params):
        self.statements.append(str(statement))
        self.params.append(params)
        if len(self.statements) == 1:
            return MappingResult({
                "reservations_today": 2,
                "reservations_week": 3,
                "app_revenue": "230.00",
                "occupancy_today": "25.0",
                "pending_count": 1,
            })
        return MappingResult(rows=[{
            "id": "reservation-a",
            "customer_name": "Cliente",
            "court_name": "Campo A",
            "start_at": "2026-09-03T20:00:00",
            "end_at": "2026-09-03T21:00:00",
            "price": "115.00",
            "status": "pending",
            "source": "app",
        }])

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def test_dashboard_summary_uses_operational_metric_rules(monkeypatch) -> None:
    session = SummarySession()
    monkeypatch.setattr(owner_repository, "get_session_factory", lambda: lambda: session)

    summary = owner_repository.get_dashboard_summary("owner-a")

    metric_sql, next_sql = session.statements
    assert session.params == [{"user_id": "owner-a"}, {"user_id": "owner-a"}]
    assert "America/Sao_Paulo" in metric_sql
    assert "status in ('pending', 'confirmed', 'completed')" in metric_sql
    assert "r.source = 'app' and r.status in ('confirmed', 'completed')" in metric_sql
    assert "left join public.reservations" in metric_sql
    assert "r.status in ('pending', 'confirmed')" in next_sql
    assert summary["reservations_today"] == 2
    assert summary["reservations_week"] == 3
    assert summary["app_revenue"] == "230.00"
    assert summary["next_reservations"][0]["id"] == "reservation-a"


def test_dashboard_summary_route_uses_authenticated_owner(monkeypatch) -> None:
    captured = {}
    expected = {"reservations_today": 1, "reservations_week": 1, "app_revenue": "115.00", "occupancy_today": "20.0", "pending_count": 0, "next_reservations": []}
    monkeypatch.setattr(owner_repository, "get_dashboard_summary", lambda user_id: captured.update(user_id=user_id) or expected)

    result = owner.get_dashboard_summary(AuthenticatedUser(id="owner-a", email="owner@example.com"))

    assert captured["user_id"] == "owner-a"
    assert result == expected
