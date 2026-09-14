from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from html import escape
from typing import Literal
from zoneinfo import ZoneInfo

SAO_PAULO_TIME_ZONE = ZoneInfo("America/Sao_Paulo")
NotificationKind = Literal["confirmed", "rejected", "cancelled"]


@dataclass(frozen=True)
class ReservationEmailData:
    reservation_id: str
    recipient_email: str | None
    arena_name: str
    court_name: str
    sport_name: str
    start_at: datetime
    end_at: datetime
    price: Decimal


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


MONTHS_PT_BR = (
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
)


def notification_kind(previous_status: str, next_status: str) -> NotificationKind | None:
    if previous_status == "pending" and next_status == "confirmed":
        return "confirmed"
    if previous_status == "pending" and next_status == "cancelled":
        # The existing owner “Recusar” action is represented by pending -> cancelled.
        return "rejected"
    if previous_status == "confirmed" and next_status == "cancelled":
        return "cancelled"
    return None


def render_reservation_email(reservation: ReservationEmailData, kind: NotificationKind, frontend_url: str) -> RenderedEmail:
    title, introduction, cta_label, cta_path = _copy_for(kind)
    cta_url = f"{frontend_url.rstrip('/')}{cta_path}"
    date_label = format_date_pt_br(reservation.start_at)
    time_label = f"{format_time_pt_br(reservation.start_at)} às {format_time_pt_br(reservation.end_at)}"
    price_label = format_currency_brl(reservation.price)

    details = (
        ("Arena", reservation.arena_name),
        ("Campo", reservation.court_name),
        ("Modalidade", reservation.sport_name),
        ("Data", date_label),
        ("Horário", time_label),
    )
    if kind == "confirmed":
        details += (("Valor", price_label),)

    text_details = "\n".join(f"{label}: {value}" for label, value in details)
    html_details = "".join(
        f'<tr><td style="padding:7px 0;color:#9DA7B3;font-size:14px">{escape(label)}</td>'
        f'<td style="padding:7px 0;color:#FFFFFF;font-size:14px;font-weight:700;text-align:right">{escape(value)}</td></tr>'
        for label, value in details
    )
    html = f'''<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px 12px;background:#080D14;color:#FFFFFF;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#111923;border:1px solid #253240;border-radius:18px;overflow:hidden">
      <tr><td style="padding:28px 28px 16px;color:#8FFF3C;font-size:13px;font-weight:800;letter-spacing:1.4px">PLAYARENA</td></tr>
      <tr><td style="padding:0 28px 24px"><h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;color:#FFFFFF">{escape(title)}</h1><p style="margin:0;color:#9DA7B3;font-size:16px;line-height:1.55">{escape(introduction)}</p></td></tr>
      <tr><td style="padding:0 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #253240;border-bottom:1px solid #253240">{html_details}</table></td></tr>
      <tr><td style="padding:28px"><a href="{escape(cta_url, quote=True)}" style="display:block;padding:15px 18px;border-radius:10px;background:#8FFF3C;color:#080D14;text-align:center;text-decoration:none;font-size:16px;font-weight:800">{escape(cta_label)}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>'''
    text = f"PLAYARENA\n\n{title}\n\n{introduction}\n\n{text_details}\n\n{cta_label}: {cta_url}\n"
    return RenderedEmail(subject=_subject_for(kind), html=html, text=text)


def format_date_pt_br(value: datetime) -> str:
    local_value = _in_sao_paulo(value)
    return f"{local_value.day} de {MONTHS_PT_BR[local_value.month - 1]} de {local_value.year}"


def format_time_pt_br(value: datetime) -> str:
    return _in_sao_paulo(value).strftime("%H:%M")


def format_currency_brl(value: Decimal) -> str:
    rounded = Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"R$ {rounded:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _in_sao_paulo(value: datetime) -> datetime:
    return value.replace(tzinfo=SAO_PAULO_TIME_ZONE) if value.tzinfo is None else value.astimezone(SAO_PAULO_TIME_ZONE)


def _copy_for(kind: NotificationKind) -> tuple[str, str, str, str]:
    if kind == "confirmed":
        return "Sua reserva foi confirmada", "A arena confirmou seu horário. Prepare-se para jogar!", "Ver minha reserva", "/player/reservas"
    if kind == "rejected":
        return "Sua pré-reserva não foi confirmada", "Esse horário não pôde ser confirmado pela arena.", "Buscar outro horário", "/reservar"
    return "Reserva cancelada", "Sua reserva foi cancelada. Você pode buscar outro horário quando quiser.", "Ver minhas reservas", "/player/reservas"


def _subject_for(kind: NotificationKind) -> str:
    if kind == "confirmed":
        return "Sua reserva foi confirmada ✅"
    if kind == "rejected":
        return "Sua pré-reserva não foi confirmada"
    return "Reserva cancelada"
