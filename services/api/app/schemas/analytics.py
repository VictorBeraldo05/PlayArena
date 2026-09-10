from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


AnalyticsEventName = Literal[
    "app_opened", "search_started", "availability_searched", "availability_results_viewed",
    "availability_no_results", "arena_viewed", "reservation_started", "reservation_login_required",
]


class AnalyticsEventCreate(BaseModel):
    event_name: AnalyticsEventName
    anonymous_id: str | None = Field(default=None, max_length=80)
    session_id: str = Field(min_length=8, max_length=80)
    arena_id: UUID | None = None
    court_id: UUID | None = None
    sport_id: int | None = Field(default=None, gt=0)
    reservation_id: UUID | None = None
    properties: dict[str, str | int | float | bool | None] = Field(default_factory=dict)

    @field_validator("properties")
    @classmethod
    def reject_sensitive_properties(cls, value: dict[str, object]) -> dict[str, object]:
        forbidden = {"password", "token", "access_token", "refresh_token", "email", "phone", "full_name", "name"}
        if forbidden.intersection(key.lower() for key in value):
            raise ValueError("Sensitive analytics properties are not allowed.")
        return value
