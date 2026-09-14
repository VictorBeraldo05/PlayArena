import json
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


AnalyticsEventName = Literal[
    "app_opened", "search_started", "availability_searched", "availability_results_viewed",
    "availability_no_results", "arena_viewed", "arena_schedule_viewed", "reservation_started", "reservation_login_required",
]


class AnalyticsEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_name: AnalyticsEventName
    anonymous_id: str | None = Field(default=None, max_length=80)
    session_id: str = Field(min_length=8, max_length=80)
    arena_id: UUID | None = None
    court_id: UUID | None = None
    sport_id: int | None = Field(default=None, gt=0)
    properties: dict[str, str | int | float | bool | None] = Field(default_factory=dict)

    @field_validator("properties")
    @classmethod
    def reject_sensitive_properties(cls, value: dict[str, object]) -> dict[str, object]:
        allowed = {"city", "sport", "date", "time", "source", "results_count", "start_at"}
        forbidden = {"password", "token", "access_token", "refresh_token", "email", "phone", "full_name", "name"}
        if forbidden.intersection(key.lower() for key in value):
            raise ValueError("Sensitive analytics properties are not allowed.")
        if set(value).difference(allowed):
            raise ValueError("Unsupported analytics properties.")
        if len(json.dumps(value, separators=(",", ":"))) > 2048:
            raise ValueError("Analytics properties are too large.")
        return value
