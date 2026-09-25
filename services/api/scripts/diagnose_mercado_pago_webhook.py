"""Check one captured Mercado Pago signature locally without storing credentials."""

from __future__ import annotations

import os
from urllib.parse import urlsplit

from mercadopago.webhook import InvalidWebhookSignatureError, WebhookSignatureValidator
from starlette.datastructures import QueryParams


def main() -> int:
    url = os.getenv("MP_WEBHOOK_URL", "")
    query_id = QueryParams(urlsplit(url).query).get("data.id") if url else None
    supplied_id = os.getenv("MP_DATA_ID")
    if query_id and supplied_id and query_id != supplied_id:
        print("result=input_mismatch: MP_DATA_ID differs from MP_WEBHOOK_URL data.id")
        return 2
    data_id = query_id or supplied_id
    request_id = os.getenv("MP_X_REQUEST_ID")
    signature = os.getenv("MP_X_SIGNATURE")
    secret = os.getenv("MERCADO_PAGO_WEBHOOK_SECRET")

    print(f"query_data_id={data_id!r}")
    print(f"x_request_id={request_id!r}")
    print(f"x_signature_present={str(bool(signature)).lower()}")
    print(f"webhook_secret_configured={str(bool(secret)).lower()}")
    if not data_id:
        print("result=missing_data_id")
        return 2
    if not signature:
        print("result=missing_signature")
        return 2
    if not request_id:
        print("result=missing_request_id")
        return 2
    if not secret:
        print("result=missing_webhook_secret")
        return 2

    try:
        WebhookSignatureValidator.validate(signature, request_id, data_id, secret)
    except (InvalidWebhookSignatureError, TypeError):
        print("result=webhook_signature_invalid")
        return 1
    print("result=signature_valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
