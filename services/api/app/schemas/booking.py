from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


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
    court_id: UUID
    start_at: datetime
    customer_name: str = Field(min_length=1, max_length=120)
    customer_phone: str = Field(min_length=1, max_length=30)


class AvailabilityQuery(BaseModel):
    city: str
    sport: str
    date: date
    start_time: time
