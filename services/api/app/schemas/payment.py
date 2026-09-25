from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.booking import validate_future_booking_start


class CheckoutCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    court_id: UUID
    start_at: datetime
    sport: str = Field(min_length=1, max_length=120)
    payment_method: Literal["wallet", "provider"]
    use_wallet_balance: bool = False
    quoted_wallet_amount: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    quoted_provider_amount: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    idempotency_key: str = Field(min_length=16, max_length=120, pattern=r"^[A-Za-z0-9:_-]+$")

    @field_validator("start_at")
    @classmethod
    def validate_future_start(cls, value: datetime) -> datetime:
        return validate_future_booking_start(value)


class SandboxCompletion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: Literal["paid", "failed"] = "paid"
