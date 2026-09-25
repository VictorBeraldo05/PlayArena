from functools import lru_cache
import json
from decimal import Decimal
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, PositiveInt, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_WEB_ORIGINS = (
    "http://localhost:3000",
    "https://playarena-phi.vercel.app",
    "https://useplayarena.com.br",
    "https://www.useplayarena.com.br",
)


def parse_web_origins(raw_origins: str | None) -> list[str]:
    """Parse comma-separated origins, with JSON-list support for legacy Render values."""
    if raw_origins is None or not raw_origins.strip():
        return list(DEFAULT_WEB_ORIGINS)

    raw_value = raw_origins.strip()
    if raw_value.startswith("["):
        try:
            values = json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise ValueError("WEB_ORIGINS must be a comma-separated origin list.") from exc
        if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
            raise ValueError("WEB_ORIGINS JSON values must be strings.")
    else:
        values = raw_value.split(",")

    origins: list[str] = []
    for raw_origin in values:
        origin = raw_origin.strip().strip('"').rstrip("/")
        parsed = urlparse(origin)
        if (
            not origin
            or parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.path
            or parsed.params
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("WEB_ORIGINS must contain origins without paths, queries, or fragments.")
        if origin not in origins:
            origins.append(origin)
    if not origins:
        raise ValueError("WEB_ORIGINS must include at least one origin.")
    return origins


class Settings(BaseSettings):
    app_name: str = "PlayArena API"
    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    supabase_url: str | None = Field(default=None, alias="SUPABASE_URL")
    supabase_anon_key: str | None = Field(default=None, alias="SUPABASE_ANON_KEY")
    supabase_service_role_key: str | None = Field(default=None, alias="SUPABASE_SERVICE_ROLE_KEY")
    supabase_jwt_issuer: str | None = None
    web_origin: str | None = Field(default=None, alias="WEB_ORIGIN")
    web_origins: str | None = Field(default=None, alias="WEB_ORIGINS")
    api_docs_enabled: bool = Field(default=False, alias="API_DOCS_ENABLED")
    trust_proxy_headers: bool = Field(default=False, alias="TRUST_PROXY_HEADERS")
    analytics_rate_limit_per_minute: PositiveInt = Field(default=120, alias="ANALYTICS_RATE_LIMIT_PER_MINUTE")
    availability_rate_limit_per_minute: PositiveInt = Field(default=60, alias="AVAILABILITY_RATE_LIMIT_PER_MINUTE")
    reservation_rate_limit_per_minute: PositiveInt = Field(default=10, alias="RESERVATION_RATE_LIMIT_PER_MINUTE")
    checkout_rate_limit_per_minute: PositiveInt = Field(default=10, alias="CHECKOUT_RATE_LIMIT_PER_MINUTE")
    payment_webhook_rate_limit_per_minute: PositiveInt = Field(default=600, alias="PAYMENT_WEBHOOK_RATE_LIMIT_PER_MINUTE")
    owner_mutation_rate_limit_per_minute: PositiveInt = Field(default=90, alias="OWNER_MUTATION_RATE_LIMIT_PER_MINUTE")
    max_request_body_bytes: PositiveInt = Field(default=65536, alias="MAX_REQUEST_BODY_BYTES")
    email_notifications_enabled: bool = Field(default=False, alias="EMAIL_NOTIFICATIONS_ENABLED")
    resend_api_key: str | None = Field(default=None, alias="RESEND_API_KEY")
    email_from: str | None = Field(default=None, alias="EMAIL_FROM")
    frontend_url: str = Field(default="http://localhost:3000", alias="FRONTEND_URL")
    email_request_timeout_seconds: PositiveInt = Field(default=5, alias="EMAIL_REQUEST_TIMEOUT_SECONDS")
    booking_advance_amount: Decimal = Field(default=Decimal("5.00"), alias="BOOKING_ADVANCE_AMOUNT", gt=0)
    payment_hold_minutes: PositiveInt = Field(default=10, alias="PAYMENT_HOLD_MINUTES")
    payment_provider: Literal["disabled", "sandbox", "mercado_pago"] = Field(default="disabled", alias="PAYMENT_PROVIDER")
    payment_environment: Literal["test", "production"] = Field(default="test", alias="PAYMENT_ENV")
    payment_sandbox_enabled: bool = Field(default=False, alias="PAYMENT_SANDBOX_ENABLED")
    payment_webhook_secret: str | None = Field(default=None, alias="PAYMENT_WEBHOOK_SECRET")
    mercado_pago_access_token: str | None = Field(default=None, alias="MERCADO_PAGO_ACCESS_TOKEN")
    mercado_pago_webhook_secret: str | None = Field(default=None, alias="MERCADO_PAGO_WEBHOOK_SECRET")
    mercado_pago_test_seller_id: str | None = Field(default=None, alias="MERCADO_PAGO_TEST_SELLER_ID")
    mercado_pago_http_timeout_seconds: PositiveInt = Field(default=5, alias="MERCADO_PAGO_HTTP_TIMEOUT_SECONDS")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    @property
    def allowed_web_origins(self) -> list[str]:
        return parse_web_origins(self.web_origins if self.web_origins is not None else self.web_origin)

    @property
    def payment_provider_available(self) -> bool:
        return self.payment_provider != "disabled" and self.payment_sandbox_enabled

    @property
    def effective_payment_hold_minutes(self) -> int:
        return max(self.payment_hold_minutes, 31) if self.payment_provider == "mercado_pago" else self.payment_hold_minutes

    @model_validator(mode="after")
    def validate_payment_configuration(self) -> "Settings":
        if self.payment_provider == "disabled":
            if self.payment_sandbox_enabled:
                raise ValueError("PAYMENT_SANDBOX_ENABLED must be false when PAYMENT_PROVIDER is disabled.")
            return self
        if not self.payment_sandbox_enabled:
            raise ValueError("PAYMENT_SANDBOX_ENABLED=true is required for non-production payment providers.")
        if self.payment_environment != "test":
            raise ValueError("Production payments are blocked in this release.")
        if self.payment_provider == "sandbox" and not self.payment_webhook_secret:
            raise ValueError("PAYMENT_WEBHOOK_SECRET is required for the sandbox provider.")
        if self.payment_provider == "mercado_pago":
            if not self.mercado_pago_access_token or not self.mercado_pago_webhook_secret or not self.mercado_pago_test_seller_id:
                raise ValueError(
                    "MERCADO_PAGO_ACCESS_TOKEN, MERCADO_PAGO_WEBHOOK_SECRET and MERCADO_PAGO_TEST_SELLER_ID are required."
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
