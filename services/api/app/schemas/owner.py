from __future__ import annotations

from datetime import time
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ArenaResponse(ApiModel):
    id: UUID
    name: str
    slug: str
    description: str | None
    phone: str | None
    whatsapp: str | None
    address: str
    city: str
    state: str
    logo_path: str | None
    active: bool


class ArenaUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    phone: str | None = Field(default=None, max_length=30)
    whatsapp: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, min_length=1, max_length=240)
    city: str | None = Field(default=None, min_length=1, max_length=120)
    state: str | None = Field(default=None, min_length=2, max_length=2)


class ArenaLogoUpdate(BaseModel):
    logo_path: str | None = Field(default=None, max_length=300)

    @field_validator("logo_path")
    @classmethod
    def validate_logo_path(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not value.startswith("arenas/") or not value.rsplit("/", 1)[-1].startswith("logo."):
            raise ValueError("Invalid arena logo path.")
        if value.rsplit(".", 1)[-1].lower() not in {"png", "jpg", "jpeg", "webp"}:
            raise ValueError("Invalid arena logo format.")
        return value


class SportResponse(ApiModel):
    id: int
    name: str
    slug: str


class CourtResponse(ApiModel):
    id: UUID
    arena_id: UUID
    name: str
    description: str | None
    active: bool
    default_duration_minutes: int
    sports: list[SportResponse] = []


class CourtCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    default_duration_minutes: int = Field(default=60, gt=0, le=360)
    active: bool = True
    sport_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_active_court_sports(self) -> "CourtCreate":
        if self.active and not self.sport_ids:
            raise ValueError("Selecione pelo menos uma modalidade.")
        return self


class CourtUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    default_duration_minutes: int | None = Field(default=None, gt=0, le=360)
    active: bool | None = None


class CourtSportsUpdate(BaseModel):
    sport_ids: list[int] = Field(default_factory=list)


class OpeningHourInput(BaseModel):
    weekday: int = Field(ge=0, le=6)
    open_time: time
    close_time: time
    active: bool = True

    @model_validator(mode="after")
    def validate_range(self) -> "OpeningHourInput":
        if self.active and self.open_time >= self.close_time:
            raise ValueError("open_time must be before close_time for active hours")
        return self


class OpeningHoursUpdate(BaseModel):
    hours: list[OpeningHourInput]


class OpeningHourResponse(ApiModel):
    id: UUID
    arena_id: UUID
    weekday: int
    open_time: time
    close_time: time
    active: bool


class PricingRuleCreate(BaseModel):
    court_id: UUID
    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    active: bool = True

    @model_validator(mode="after")
    def validate_range(self) -> "PricingRuleCreate":
        if self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self


class PricingRuleUpdate(BaseModel):
    weekday: int | None = Field(default=None, ge=0, le=6)
    start_time: time | None = None
    end_time: time | None = None
    price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    active: bool | None = None


class PricingRuleResponse(ApiModel):
    id: UUID
    court_id: UUID
    weekday: int
    start_time: time
    end_time: time
    price: Decimal
    active: bool


class OwnerDashboardResponse(ApiModel):
    arena: ArenaResponse
    court_count: int
    sport_count: int
    opening_hours_configured: bool
    pricing_rules_configured: bool
