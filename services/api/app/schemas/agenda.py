from datetime import datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field, model_validator

class BlockedSlotCreate(BaseModel):
    court_id: UUID
    start_at: datetime
    end_at: datetime
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_period(self) -> "BlockedSlotCreate":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self

class ManualReservationCreate(BaseModel):
    court_id: UUID
    start_at: datetime
    end_at: datetime
    customer_name: str = Field(min_length=1)
    customer_phone: str = Field(min_length=1)
    price: Decimal = Field(ge=0)

    @model_validator(mode="after")
    def validate_period(self) -> "ManualReservationCreate":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self
