from app.db import session as db_session
from app.db.session import get_sqlalchemy_database_url


def test_database_url_uses_installed_psycopg_driver() -> None:
    database_url = "postgresql://user:password@db.example.com:5432/postgres?sslmode=require"

    normalized_url = get_sqlalchemy_database_url(database_url)

    assert normalized_url == "postgresql+psycopg://user:password@db.example.com:5432/postgres?sslmode=require"


def test_database_url_keeps_explicit_sqlalchemy_driver() -> None:
    database_url = "postgresql+psycopg://user:password@db.example.com:5432/postgres"

    assert get_sqlalchemy_database_url(database_url) == database_url


def test_supabase_session_pooler_keeps_configured_port() -> None:
    database_url = "postgresql://postgres.project:password@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"

    normalized_url = get_sqlalchemy_database_url(database_url)

    assert normalized_url == "postgresql+psycopg://postgres.project:password@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"


def test_database_engine_is_reused_with_a_bounded_pool(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    engine = object()

    def create_test_engine(*args, **kwargs):
        calls.append({"args": args, **kwargs})
        return engine

    monkeypatch.setattr(db_session.settings, "database_url", "postgresql://user:password@db.example.com/postgres")
    monkeypatch.setattr(db_session, "create_engine", create_test_engine)
    db_session.get_engine.cache_clear()

    try:
        assert db_session.get_engine() is engine
        assert db_session.get_engine() is engine
        assert len(calls) == 1
        assert calls[0]["poolclass"].__name__ == "NullPool"
        assert calls[0]["connect_args"] == {"connect_timeout": 10}
    finally:
        db_session.get_engine.cache_clear()
        db_session.get_session_factory.cache_clear()
