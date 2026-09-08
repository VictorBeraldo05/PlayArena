from app.db import session


def test_database_connections_use_sao_paulo_for_local_booking_times(monkeypatch) -> None:
    monkeypatch.setattr(session.settings, "database_url", "postgresql://user:secret@localhost:5432/playarena")
    session.get_engine.cache_clear()

    try:
        engine = session.get_engine()
    finally:
        session.get_engine.cache_clear()

    assert engine.url.drivername == "postgresql+psycopg"
    assert session.SAO_PAULO_TIME_ZONE == "America/Sao_Paulo"
