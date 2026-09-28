"""Print only a short fingerprint of MERCADO_PAGO_WEBHOOK_SECRET."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.secret_fingerprint import fingerprint_secret  # noqa: E402


def main() -> int:
    secret = os.getenv("MERCADO_PAGO_WEBHOOK_SECRET")
    if not secret:
        print("MERCADO_PAGO_WEBHOOK_SECRET is not configured.", file=sys.stderr)
        return 1
    print(fingerprint_secret(secret))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
