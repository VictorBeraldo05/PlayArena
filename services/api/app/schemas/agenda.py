from datetime import datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.booking import validate_future_booking_start

class BlockedSlotCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    court_id: UUID
    start_at: datetime
    end_at: datetime
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_period(self) -> "BlockedSlotCreate":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        validate_future_booking_start(self.start_at)
        return self

class ManualReservationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    court_id: UUID
    start_at: datetime
    end_at: datetime
    customer_name: str = Field(min_length=1, max_length=120)
    customer_phone: str = Field(min_length=1, max_length=30)
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)

    @model_validator(mode="after")
    def validate_period(self) -> "ManualReservationCreate":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        validate_future_booking_start(self.start_at)
        return self
