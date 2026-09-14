from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from email.utils import parseaddr
from functools import lru_cache
from typing import Protocol
from uuid import UUID

from app.core.config import settings
from app.repositories.booking_repository import get_reservation_notification
from app.services.notifications.templates import NotificationKind, ReservationEmailData, RenderedEmail, notification_kind, render_reservation_email

logger = logging.getLogger(__name__)


class EmailSender(Protocol):
    def send(self, recipient: str, message: RenderedEmail, idempotency_key: str) -> None: ...


@dataclass(frozen=True)
class EmailNotificationConfig:
    enabled: bool
    api_key: str | None
    sender: str | None
    frontend_url: str
    timeout_seconds: int


class ResendEmailSender:
    def __init__(self, api_key: str, sender: str, timeout_seconds: int) -> None:
        self.api_key = api_key
        self.sender = sender
        self.timeout_seconds = timeout_seconds

    def send(self, recipient: str, message: RenderedEmail, idempotency_key: str) -> None:
        # Import lazily so disabled local development does not require the SDK.
        import resend

        resend.api_key = self.api_key
        resend.default_http_client = resend.RequestsClient(timeout=self.timeout_seconds)
        resend.Emails.send({
            "from": self.sender,
            "to": [recipient],
            "subject": message.subject,
            "html": message.html,
            "text": message.text,
            "headers": {"Idempotency-Key": idempotency_key},
        })


class ReservationNotificationService:
    def __init__(
        self,
        config: EmailNotificationConfig,
        fetch_reservation: Callable[[UUID], dict | None] = get_reservation_notification,
        sender_factory: Callable[[str, str, int], EmailSender] = ResendEmailSender,
    ) -> None:
        self.config = config
        self.fetch_reservation = fetch_reservation
        self.sender_factory = sender_factory

    def send_status_change(
        self,
        reservation_id: UUID,
        previous_status: str,
        next_status: str,
        notification_override: NotificationKind | None = None,
    ) -> None:
        kind = notification_override or notification_kind(previous_status, next_status)
        if kind is None:
            logger.info("reservation notification skipped reservation_id=%s reason=unsupported-transition", reservation_id)
            return
        if not self.config.enabled:
            logger.info("reservation notification skipped reservation_id=%s reason=disabled", reservation_id)
            return
        if not self.config.api_key or not self._is_safe_header_value(self.config.sender):
            logger.warning("reservation notification failed reservation_id=%s reason=missing-email-configuration", reservation_id)
            return

        reservation = self.fetch_reservation(reservation_id)
        if reservation is None:
            logger.warning("reservation notification failed reservation_id=%s reason=reservation-not-found", reservation_id)
            return
        recipient = reservation.get("recipient_email")
        if not self._is_valid_email(recipient):
            logger.info("reservation notification skipped reservation_id=%s reason=missing-email", reservation_id)
            return

        try:
            message = render_reservation_email(self._to_email_data(reservation), kind, self.config.frontend_url)
            sender = self.sender_factory(self.config.api_key, self.config.sender, self.config.timeout_seconds)
            sender.send(recipient, message, f"reservation:{reservation_id}:{kind}")
        except Exception as exc:  # noqa: BLE001 - notifications must never affect persisted reservations.
            logger.warning(
                "reservation notification failed reservation_id=%s kind=%s error_type=%s",
                reservation_id,
                kind,
                type(exc).__name__,
            )
            return

        logger.info("reservation notification sent reservation_id=%s kind=%s", reservation_id, kind)

    @staticmethod
    def _is_valid_email(value: object) -> bool:
        if not isinstance(value, str) or "\r" in value or "\n" in value:
            return False
        _, address = parseaddr(value)
        return bool(address and "@" in address and address == value)

    @staticmethod
    def _is_safe_header_value(value: str | None) -> bool:
        return bool(value and value.strip() and "\r" not in value and "\n" not in value)

    @staticmethod
    def _to_email_data(reservation: dict) -> ReservationEmailData:
        return ReservationEmailData(
            reservation_id=str(reservation["id"]),
            recipient_email=reservation["recipient_email"],
            arena_name=str(reservation["arena_name"]),
            court_name=str(reservation["court_name"]),
            sport_name=str(reservation["sport_name"]),
            start_at=reservation["start_at"],
            end_at=reservation["end_at"],
            price=Decimal(reservation["price"]),
        )


@lru_cache
def get_reservation_notification_service() -> ReservationNotificationService:
    return ReservationNotificationService(
        EmailNotificationConfig(
            enabled=settings.email_notifications_enabled,
            api_key=settings.resend_api_key,
            sender=settings.email_from,
            frontend_url=settings.frontend_url,
            timeout_seconds=settings.email_request_timeout_seconds,
        )
    )


def send_reservation_status_notification(
    reservation_id: UUID,
    previous_status: str,
    next_status: str,
    *,
    cancellation_by_player: bool = False,
) -> None:
    notification_override: NotificationKind | None = "cancelled" if cancellation_by_player and next_status == "cancelled" else None
    get_reservation_notification_service().send_status_change(
        reservation_id,
        previous_status,
        next_status,
        notification_override=notification_override,
    )
