from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status

from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.dependencies.auth import get_current_role, get_current_user
from app.repositories.payment_repository import (
    CheckoutConfigurationError,
    CheckoutIdempotencyConflictError,
    CheckoutNotFoundError,
    CheckoutPaymentPlanChangedError,
    CheckoutSlotUnavailableError,
    PaymentOwnershipError,
    WalletInsufficientBalanceError,
    get_admin_payments,
    get_checkout_quote,
    get_wallet,
)
from app.schemas.auth import AuthenticatedUser
from app.schemas.booking import validate_future_booking_start
from app.schemas.payment import CheckoutCreate, SandboxCompletion
from app.services.payments.service import (
    PaymentConfigurationError,
    PaymentWebhookError,
    complete_sandbox_payment,
    create_checkout,
    get_player_payment_status,
    process_webhook,
    reconcile_mercado_pago_payment,
)

router = APIRouter(tags=["payments and wallet"])
webhook_router = APIRouter(prefix="/payments/webhooks", tags=["payment webhooks"])
admin_router = APIRouter(prefix="/admin/payments", tags=["payment operations"])


def require_player(
    current_user: AuthenticatedUser = Depends(get_current_user),
    role: str = Depends(get_current_role),
) -> AuthenticatedUser:
    if role != "player":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Player access required.")
    return current_user


def require_admin(
    current_user: AuthenticatedUser = Depends(get_current_user),
    role: str = Depends(get_current_role),
) -> AuthenticatedUser:
    if role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform admin access required.")
    return current_user


def _checkout_error(exc: Exception) -> HTTPException:
    if isinstance(exc, CheckoutNotFoundError):
        return HTTPException(status_code=404, detail="Campo ou modalidade nao encontrados.")
    if isinstance(exc, CheckoutSlotUnavailableError):
        return HTTPException(status_code=409, detail={"code": "slot_unavailable", "message": "Esse horario nao esta mais disponivel."})
    if isinstance(exc, WalletInsufficientBalanceError):
        return HTTPException(status_code=409, detail={"code": "wallet_insufficient", "message": "Saldo PlayArena insuficiente."})
    if isinstance(exc, CheckoutIdempotencyConflictError):
        return HTTPException(status_code=409, detail={"code": "idempotency_conflict", "message": "Esta chave ja foi usada em outro checkout."})
    if isinstance(exc, CheckoutPaymentPlanChangedError):
        return HTTPException(
            status_code=409,
            detail={
                "code": "payment_plan_changed",
                "message": "Seu saldo mudou. Revise os valores antes de continuar.",
            },
        )
    if isinstance(exc, PaymentConfigurationError):
        return HTTPException(status_code=503, detail={"code": exc.code, "message": str(exc)})
    if isinstance(exc, CheckoutConfigurationError):
        return HTTPException(status_code=503, detail=str(exc))
    return HTTPException(status_code=422, detail="Nao foi possivel preparar o checkout.")


@router.get("/player/checkout/quote")
def checkout_quote(
    court_id: UUID,
    start_at: datetime,
    sport: str = Query(min_length=1, max_length=120),
    use_wallet_balance: bool = Query(default=False),
    current_user: AuthenticatedUser = Depends(require_player),
) -> dict:
    try:
        validate_future_booking_start(start_at)
        quote = get_checkout_quote(
            current_user.id,
            court_id,
            start_at,
            sport,
            settings.booking_advance_amount,
            use_wallet_balance=use_wallet_balance,
        )
        provider_available = settings.payment_provider_available
        return {
            **quote,
            "provider_available": provider_available,
            "checkout_available": not quote["requires_provider"] or provider_available,
            "payment_provider": settings.payment_provider if provider_available else None,
            "hold_minutes": settings.effective_payment_hold_minutes,
        }
    except (CheckoutNotFoundError, CheckoutSlotUnavailableError, CheckoutConfigurationError, ValueError) as exc:
        raise _checkout_error(exc) from exc


@router.post("/player/checkout", status_code=status.HTTP_201_CREATED)
def post_checkout(
    request: Request,
    input_data: CheckoutCreate,
    current_user: AuthenticatedUser = Depends(require_player),
) -> dict:
    enforce_rate_limit(request, scope="checkout", principal=f"user:{current_user.id}", limit=settings.checkout_rate_limit_per_minute)
    try:
        return create_checkout(current_user.id, input_data.model_dump(), payer_email=current_user.email)
    except (
        CheckoutNotFoundError,
        CheckoutSlotUnavailableError,
        CheckoutConfigurationError,
        CheckoutIdempotencyConflictError,
        CheckoutPaymentPlanChangedError,
        WalletInsufficientBalanceError,
        PaymentConfigurationError,
    ) as exc:
        raise _checkout_error(exc) from exc


@router.get("/player/payments/{payment_id}")
def payment_status(
    payment_id: UUID,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_player),
) -> dict:
    enforce_rate_limit(request, scope="payment-status", principal=f"user:{current_user.id}", limit=60)
    try:
        return get_player_payment_status(current_user.id, payment_id)
    except PaymentOwnershipError as exc:
        raise HTTPException(status_code=404, detail="Payment not found.") from exc
    except PaymentConfigurationError as exc:
        raise _checkout_error(exc) from exc


@router.post("/player/payments/{payment_id}/sandbox-complete")
def sandbox_complete(
    payment_id: UUID,
    input_data: SandboxCompletion,
    current_user: AuthenticatedUser = Depends(require_player),
) -> dict:
    try:
        return complete_sandbox_payment(current_user.id, payment_id, input_data.outcome)
    except (PaymentConfigurationError, PaymentOwnershipError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/player/wallet")
def player_wallet(current_user: AuthenticatedUser = Depends(require_player)) -> dict:
    return get_wallet(current_user.id)


@webhook_router.post("/sandbox", status_code=status.HTTP_202_ACCEPTED)
async def sandbox_payment_webhook(
    request: Request,
    x_playarena_signature: str | None = Header(default=None),
) -> dict:
    enforce_rate_limit(request, scope="payment-webhook", limit=settings.payment_webhook_rate_limit_per_minute)
    payload = await request.body()
    try:
        return process_webhook("sandbox", payload, x_playarena_signature)
    except PaymentWebhookError as exc:
        raise HTTPException(status_code=exc.status_code, detail="Invalid payment webhook.") from exc


@webhook_router.post("/mercado-pago", status_code=status.HTTP_200_OK)
async def mercado_pago_payment_webhook(
    request: Request,
    topic: str = Query(alias="type", min_length=1, max_length=40),
    x_signature: str | None = Header(default=None),
    x_request_id: str | None = Header(default=None),
) -> dict:
    enforce_rate_limit(request, scope="payment-webhook", limit=settings.payment_webhook_rate_limit_per_minute)
    payload = await request.body()
    data_id = request.query_params.get("data.id")
    if not data_id or len(data_id) > 120:
        raise HTTPException(status_code=401, detail="Invalid payment webhook.")
    try:
        return process_webhook(
            "mercado_pago",
            payload,
            x_signature,
            request_id=x_request_id,
            data_id=data_id,
            topic=topic,
        )
    except PaymentWebhookError as exc:
        raise HTTPException(status_code=exc.status_code, detail="Invalid payment webhook.") from exc


@admin_router.get("")
def admin_payments(
    days: int = Query(default=30, ge=1, le=90),
    limit: int = Query(default=100, ge=1, le=250),
    _: AuthenticatedUser = Depends(require_admin),
) -> dict:
    return get_admin_payments(days, limit)


@admin_router.post("/{payment_id}/reconcile")
def admin_reconcile_payment(
    payment_id: UUID,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_admin),
) -> dict:
    enforce_rate_limit(
        request,
        scope="admin-payment-reconciliation",
        principal=f"admin:{current_user.id}",
        limit=settings.owner_mutation_rate_limit_per_minute,
    )
    try:
        return reconcile_mercado_pago_payment(payment_id)
    except CheckoutNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Payment not found.") from exc
    except PaymentConfigurationError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
