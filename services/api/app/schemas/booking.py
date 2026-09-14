from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator

SAO_PAULO_TIME_ZONE = ZoneInfo("America/Sao_Paulo")


def validate_future_booking_start(value: datetime) -> datetime:
    local_start = value.astimezone(SAO_PAULO_TIME_ZONE) if value.tzinfo else value.replace(tzinfo=SAO_PAULO_TIME_ZONE)
    if local_start <= datetime.now(SAO_PAULO_TIME_ZONE):
        raise ValueError("start_at must be in the future")
    return value


class AvailabilityOption(BaseModel):
    arena_id: UUID
    arena_name: str
    logo_path: str | None = None
    court_id: UUID
    court_name: str
    start_at: datetime
    end_at: datetime
    duration_minutes: int
    price: Decimal


class PlayerReservationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    court_id: UUID
    start_at: datetime
    customer_name: str = Field(min_length=1, max_length=120)
    customer_phone: str = Field(min_length=1, max_length=30)

    @field_validator("start_at")
    @classmethod
    def validate_future_start(cls, value: datetime) -> datetime:
        return validate_future_booking_start(value)


class AvailabilityQuery(BaseModel):
    city: str
    sport: str
    date: date
    start_time: time
