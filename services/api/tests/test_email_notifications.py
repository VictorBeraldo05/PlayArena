import asyncio
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal
from html import escape
from html.parser import HTMLParser
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api.routes import owner
from app.repositories import booking_repository
from app.repositories.owner_repository import ReservationStateError
from app.schemas.auth import AuthenticatedUser
from app.services.notifications.email import EmailNotificationConfig, ReservationNotificationService, ResendEmailSender
from app.services.notifications.templates import ReservationEmailData, notification_kind, render_owner_new_reservation_email, render_reservation_email

RESERVATION_ID = "50000000-0000-0000-0000-000000000001"
OWNER = AuthenticatedUser(id="00000000-0000-0000-0000-000000000001")


def route_request():
    from starlette.requests import Request

    return Request({"type": "http", "method": "POST", "path": "/", "headers": [], "client": ("127.0.0.1", 12345)})


def reservation_payload(email: str | None = "player@example.com") -> dict:
    return {
        "id": RESERVATION_ID,
        "recipient_email": email,
        "arena_name": "Boleiros",
        "court_name": "Campo 1",
        "sport_name": "Society",
        "start_at": datetime(2026, 9, 18, 23, 0, tzinfo=timezone.utc),
        "end_at": datetime(2026, 9, 19, 0, 0, tzinfo=timezone.utc),
        "price": Decimal("115.00"),
    }


class RecordingSender:
    def __init__(self, sent: list[tuple]) -> None:
        self.sent = sent

    def send(self, recipient, message, idempotency_key) -> None:
        self.sent.append((recipient, message, idempotency_key))


def enabled_config() -> EmailNotificationConfig:
    return EmailNotificationConfig(
        enabled=True,
        api_key="re_test",
        sender="PlayArena <reservas@useplayarena.com.br>",
        frontend_url="https://useplayarena.com.br",
        timeout_seconds=5,
    )


@pytest.mark.parametrize(
    ("previous_status", "next_status", "expected_kind"),
    [
        ("pending", "confirmed", "confirmed"),
        ("pending", "cancelled", "rejected"),
        ("confirmed", "cancelled", "cancelled"),
    ],
)
def test_notification_kind_matches_real_reservation_transitions(previous_status, next_status, expected_kind) -> None:
    assert notification_kind(previous_status, next_status) == expected_kind


def test_confirmed_notification_uses_server_reservation_data_and_pt_br_formatting() -> None:
    sent: list[tuple] = []
    service = ReservationNotificationService(
        enabled_config(),
        fetch_reservation=lambda _reservation_id: reservation_payload(),
        sender_factory=lambda *_args: RecordingSender(sent),
    )

    service.send_status_change(RESERVATION_ID, "pending", "confirmed")

    assert len(sent) == 1
    recipient, message, idempotency_key = sent[0]
    assert recipient == "player@example.com"
    assert message.subject == "Sua reserva foi confirmada ✅"
    assert "18 de setembro de 2026" in message.text
    assert "20:00 às 21:00" in message.text
    assert "R$ 115,00" in message.text
    assert "https://useplayarena.com.br/player/reservas" in message.html
    assert idempotency_key == f"reservation:{RESERVATION_ID}:confirmed"


def test_rejected_notification_uses_existing_pending_to_cancelled_transition() -> None:
    sent: list[tuple] = []
    service = ReservationNotificationService(
        enabled_config(),
        fetch_reservation=lambda _reservation_id: reservation_payload(),
        sender_factory=lambda *_args: RecordingSender(sent),
    )

    service.send_status_change(RESERVATION_ID, "pending", "cancelled")

    assert len(sent) == 1
    assert sent[0][1].subject == "Sua pré-reserva não foi confirmada"
    assert "https://useplayarena.com.br/reservar" in sent[0][1].html


def test_cancelled_notification_uses_confirmed_to_cancelled_transition() -> None:
    sent: list[tuple] = []
    service = ReservationNotificationService(
        enabled_config(),
        fetch_reservation=lambda _reservation_id: reservation_payload(),
        sender_factory=lambda *_args: RecordingSender(sent),
    )

    service.send_status_change(RESERVATION_ID, "confirmed", "cancelled")

    assert len(sent) == 1
    assert sent[0][1].subject == "Reserva cancelada"


def test_player_cancellation_of_a_pending_reservation_uses_the_cancelled_template() -> None:
    sent: list[tuple] = []
    service = ReservationNotificationService(
        enabled_config(),
        fetch_reservation=lambda _reservation_id: reservation_payload(),
        sender_factory=lambda *_args: RecordingSender(sent),
    )

    service.send_status_change(RESERVATION_ID, "pending", "cancelled", notification_override="cancelled")

    assert len(sent) == 1
    assert sent[0][1].subject == "Reserva cancelada"


def test_missing_recipient_email_skips_notification_without_failing_transition() -> None:
    sender_created = False

    def sender_factory(*_args):
        nonlocal sender_created
        sender_created = True
        raise AssertionError("The sender must not be created without a recipient.")

    service = ReservationNotificationService(
        enabled_config(),
        fetch_reservation=lambda _reservation_id: reservation_payload(email=None),
        sender_factory=sender_factory,
    )

    service.send_status_change(RESERVATION_ID, "pending", "confirmed")

    assert not sender_created


def test_notification_repository_reads_email_from_authenticated_reservation_user(monkeypatch) -> None:
    class Result:
        def mappings(self):
            return self

        def one_or_none(self):
            return reservation_payload()

    class Session:
        def __init__(self) -> None:
            self.sql = ""
            self.params = {}

        def execute(self, statement, params):
            self.sql = str(statement)
            self.params = params
            return Result()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    session = Session()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: lambda: session)

    notification = booking_repository.get_reservation_notification(RESERVATION_ID)

    assert notification is not None
    assert session.params == {"reservation_id": RESERVATION_ID}
    assert "left join auth.users u on u.id = r.user_id" in session.sql.lower()
    assert "u.email as recipient_email" in session.sql.lower()


def test_provider_failure_does_not_propagate_or_change_persisted_status() -> None:
    class FailingSender:
        def send(self, *_args) -> None:
            raise RuntimeError("provider unavailable")

    service = ReservationNotificationService(
        enabled_config(),
        fetch_reservation=lambda _reservation_id: reservation_payload(),
        sender_factory=lambda *_args: FailingSender(),
    )

    service.send_status_change(RESERVATION_ID, "pending", "confirmed")


def test_resend_sender_sets_timeout_and_idempotency_key(monkeypatch) -> None:
    sent: dict = {}

    class FakeEmails:
        @staticmethod
        def send(params) -> None:
            sent.update(params)

    fake_resend = SimpleNamespace(
        api_key=None,
        default_http_client=None,
        RequestsClient=lambda timeout: ("client", timeout),
        Emails=FakeEmails,
    )
    monkeypatch.setitem(sys.modules, "resend", fake_resend)
    message = render_reservation_email(
        ReservationEmailData(
            reservation_id=RESERVATION_ID,
            recipient_email="player@example.com",
            arena_name="Boleiros",
            court_name="Campo 1",
            sport_name="Society",
            start_at=datetime(2026, 9, 18, 23, 0, tzinfo=timezone.utc),
            end_at=datetime(2026, 9, 19, 0, 0, tzinfo=timezone.utc),
            price=Decimal("115.00"),
        ),
        "confirmed",
        "https://useplayarena.com.br",
    )

    ResendEmailSender("re_test", "PlayArena <reservas@useplayarena.com.br>", 5).send(
        "player@example.com", message, "reservation:test:confirmed"
    )

    assert fake_resend.api_key == "re_test"
    assert fake_resend.default_http_client == ("client", 5)
    assert sent["headers"] == {"Idempotency-Key": "reservation:test:confirmed"}
    assert sent["text"] == message.text


def test_template_escapes_dynamic_html_and_includes_plain_text() -> None:
    message = render_reservation_email(
        ReservationEmailData(
            reservation_id=RESERVATION_ID,
            recipient_email="player@example.com",
            arena_name="<script>alert(1)</script>",
            court_name="Campo 1",
            sport_name="Society",
            start_at=datetime(2026, 9, 18, 23, 0, tzinfo=timezone.utc),
            end_at=datetime(2026, 9, 19, 0, 0, tzinfo=timezone.utc),
            price=Decimal("115.00"),
        ),
        "confirmed",
        "https://useplayarena.com.br",
    )

    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in message.html
    assert "<script>alert(1)</script>" not in message.html
    assert "Arena: <script>alert(1)</script>" in message.text


@pytest.mark.parametrize(
    ("next_status", "previous_status", "expected_kind"),
    [("confirmed", "pending", "confirmed"), ("cancelled", "pending", "rejected"), ("cancelled", "confirmed", "cancelled")],
)
def test_real_status_change_schedules_exactly_one_notification(monkeypatch, next_status, previous_status, expected_kind) -> None:
    scheduled: list[tuple] = []
    monkeypatch.setattr(
        owner.owner_repository,
        "update_reservation_status",
        lambda *_args: {"id": RESERVATION_ID, "previous_status": previous_status, "status": next_status},
    )
    monkeypatch.setattr(owner, "send_reservation_status_notification", lambda *args: scheduled.append(args))
    tasks = BackgroundTasks()

    response = owner.change_reservation_status(tasks, OWNER, RESERVATION_ID, next_status)
    asyncio.run(tasks())

    assert response == {"id": RESERVATION_ID, "status": next_status}
    assert scheduled == [(RESERVATION_ID, previous_status, next_status)]
    assert notification_kind(previous_status, next_status) == expected_kind


def test_repeated_confirmation_schedules_no_second_notification(monkeypatch) -> None:
    monkeypatch.setattr(
        owner.owner_repository,
        "update_reservation_status",
        lambda *_args: (_ for _ in ()).throw(ReservationStateError("already confirmed")),
    )
    tasks = BackgroundTasks()

    with pytest.raises(HTTPException) as error:
        owner.confirm_reservation(route_request(), tasks, RESERVATION_ID, OWNER)

    assert error.value.status_code == 409
    assert tasks.tasks == []


@pytest.mark.parametrize(
    ("paid", "expected_due"),
    [(Decimal("0.00"), "R$ 115,00"), (Decimal("5.00"), "R$ 110,00")],
)
def test_new_owner_email_links_to_specific_reservation_with_correct_amounts(paid, expected_due) -> None:
    payload = reservation_payload(email="owner@example.com")
    payload.update(booking_amount_paid=paid, amount_due_at_venue=Decimal("115.00") - paid)
    message = render_owner_new_reservation_email(
        ReservationEmailData(
            reservation_id=RESERVATION_ID,
            recipient_email=payload["recipient_email"],
            arena_name=payload["arena_name"],
            court_name=payload["court_name"],
            sport_name=payload["sport_name"],
            start_at=payload["start_at"],
            end_at=payload["end_at"],
            price=payload["price"],
            booking_amount_paid=paid,
            amount_due_at_venue=payload["amount_due_at_venue"],
        ),
        "https://useplayarena.com.br",
    )
    assert message.subject == "Nova pr\u00e9-reserva no PlayArena"
    assert message.preheader == "Boleiros • 18/09 às 20:00"
    assert f"/dashboard/reservas?reservation={RESERVATION_ID}" in message.html
    assert "Analisar pr\u00e9-reserva" in message.html
    assert "Boleiros" in message.text and "Campo 1" in message.text and "Society" in message.text
    assert f"Valor a receber na arena: {expected_due}" in message.text
    assert ("Pago no PlayArena: R$ 5,00" in message.text) is (paid > 0)
    assert "href=" in message.html and message.html.count("<a ") == 1


class EmailStructureParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in {"br", "hr", "img", "meta"}:
            self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        assert self.stack and self.stack.pop() == tag


def assert_hidden_preheader(message) -> None:
    match = re.search(r"<body\b[^>]*>\s*(<div\b[^>]*>.*?</div>)", message.html, re.DOTALL)
    assert match is not None
    hidden = match.group(1)
    assert f">{escape(message.preheader)}" in hidden
    assert 'aria-hidden="true"' in hidden
    assert "display:none!important" in hidden
    assert "visibility:hidden" in hidden
    assert "mso-hide:all" in hidden
    assert "max-height:0" in hidden and "overflow:hidden" in hidden
    assert hidden.count("&#8204;&nbsp;") == 100
    assert message.preheader not in message.text
    parser = EmailStructureParser()
    parser.feed(message.html)
    parser.close()
    assert not parser.stack


def test_owner_new_reservation_has_hidden_preheader_and_escaped_arena_name() -> None:
    payload = reservation_payload(email="owner@example.com")
    payload["arena_name"] = 'Boleiros <script>alert("x")</script> & Cia'
    message = render_owner_new_reservation_email(
        ReservationNotificationService._to_email_data(payload), "https://useplayarena.com.br"
    )

    assert message.subject == "Nova pré-reserva no PlayArena"
    assert message.preheader == 'Boleiros <script>alert("x")</script> & Cia • 18/09 às 20:00'
    assert_hidden_preheader(message)
    assert "<script>" not in message.html
    assert "&lt;script&gt;" in message.html
    assert "&amp; Cia" in message.html


@pytest.mark.parametrize(
    ("kind", "subject", "preheader"),
    [
        ("confirmed", "Sua reserva foi confirmada ✅", "Sua reserva na Boleiros foi confirmada."),
        ("rejected", "Sua pré-reserva não foi confirmada", "Veja os detalhes da sua solicitação."),
        ("cancelled", "Reserva cancelada", "Sua reserva na Boleiros foi cancelada."),
    ],
)
def test_status_emails_have_short_hidden_preheaders(kind, subject, preheader) -> None:
    message = render_reservation_email(
        ReservationNotificationService._to_email_data(reservation_payload()), kind, "https://useplayarena.com.br"
    )

    assert message.subject == subject
    assert message.preheader == preheader
    assert_hidden_preheader(message)


@pytest.mark.parametrize("kind", ["confirmed", "cancelled"])
def test_status_preheaders_escape_dynamic_arena_name(kind) -> None:
    payload = reservation_payload()
    payload["arena_name"] = '<img src=x onerror="alert(1)"> & Arena'
    message = render_reservation_email(
        ReservationNotificationService._to_email_data(payload), kind, "https://useplayarena.com.br"
    )

    assert_hidden_preheader(message)
    assert "<img" not in message.html
    assert "&lt;img" in message.html
    assert "&amp; Arena" in message.html


def test_new_owner_notification_sends_per_owner_without_affecting_reservation() -> None:
    sent: list[tuple] = []
    first = {**reservation_payload("owner-a@example.com"), "owner_user_id": "owner-a"}
    second = {**reservation_payload("owner-b@example.com"), "owner_user_id": "owner-b"}
    service = ReservationNotificationService(
        enabled_config(),
        sender_factory=lambda *_args: RecordingSender(sent),
        fetch_owner_reservations=lambda _id: [first, second],
    )

    service.send_new_owner_reservation(RESERVATION_ID)

    assert [row[0] for row in sent] == ["owner-a@example.com", "owner-b@example.com"]
    assert [row[2] for row in sent] == [
        f"reservation:{RESERVATION_ID}:new-owner:owner-a",
        f"reservation:{RESERVATION_ID}:new-owner:owner-b",
    ]


def test_owner_email_lookup_uses_arena_ownership_and_only_pending_app_reservations(monkeypatch) -> None:
    class Result:
        def mappings(self):
            return self

        def all(self):
            return []

    class Session:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, statement, params):
            self.sql = str(statement).lower()
            self.params = params
            return Result()

    session = Session()
    monkeypatch.setattr(booking_repository, "get_session_factory", lambda: lambda: session)

    assert booking_repository.get_owner_reservation_notifications(RESERVATION_ID) == []
    assert "ao.arena_id = r.arena_id" in session.sql
    assert "u.id = ao.user_id" in session.sql
    assert "r.source = 'app' and r.status = 'pending'" in session.sql
    assert session.params == {"reservation_id": RESERVATION_ID}
