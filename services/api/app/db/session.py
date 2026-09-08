from functools import lru_cache

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import settings

SAO_PAULO_TIME_ZONE = "America/Sao_Paulo"


def get_sqlalchemy_database_url(database_url: str) -> str:
    """Select the installed psycopg v3 driver for PostgreSQL URLs."""
    url = make_url(database_url)
    if url.drivername == "postgresql":
        url = url.set(drivername="postgresql+psycopg")
    return url.render_as_string(hide_password=False)


@lru_cache
def get_engine() -> Engine:
    """Return the process-wide database engine.

    The current Supabase session pooler has a strict connection limit. NullPool
    closes each request-scoped connection instead of retaining idle clients.
    """
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured.")
    engine = create_engine(
        get_sqlalchemy_database_url(settings.database_url),
        pool_pre_ping=True,
        poolclass=NullPool,
        connect_args={"connect_timeout": 10},
    )

    if isinstance(engine, Engine):
        @event.listens_for(engine, "connect")
        def set_booking_timezone(dbapi_connection, _connection_record) -> None:  # type: ignore[no-untyped-def]
            # Booking inputs are local operational times. PostgreSQL must interpret
            # naive timestamps in the arena timezone before writing timestamptz data.
            with dbapi_connection.cursor() as cursor:
                cursor.execute(f"SET TIME ZONE '{SAO_PAULO_TIME_ZONE}'")

    return engine


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False)
