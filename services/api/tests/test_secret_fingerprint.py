import asyncio
import hashlib
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from app import main as api_main
from app.core.config import Settings
from app.core.secret_fingerprint import fingerprint_secret

TEST_SECRET = "test-webhook-secret-for-fingerprint"


def test_fingerprint_is_only_ten_hex_characters() -> None:
    expected = hashlib.sha256(TEST_SECRET.encode("utf-8")).hexdigest()
    result = fingerprint_secret(TEST_SECRET)
    assert result == expected[:10]
    assert len(result) == 10
    assert result != expected
    with pytest.raises(ValueError):
        fingerprint_secret("")


def test_debug_flag_requires_explicit_true(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PAYMENT_DEBUG_SECRET_FINGERPRINT", raising=False)
    assert Settings(_env_file=None).payment_debug_secret_fingerprint is False
    assert Settings(_env_file=None, PAYMENT_DEBUG_SECRET_FINGERPRINT="true").payment_debug_secret_fingerprint is True


@pytest.mark.parametrize(
    ("payment_env", "enabled", "secret_present", "should_log"),
    [
        ("test", True, True, True),
        ("test", False, True, False),
        ("production", True, True, False),
        ("test", True, False, False),
    ],
)
def test_startup_logs_fingerprint_only_when_explicitly_enabled(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    payment_env: str,
    enabled: bool,
    secret_present: bool,
    should_log: bool,
) -> None:
    caplog.set_level("WARNING", logger="app.main")
    monkeypatch.setattr(
        api_main,
        "settings",
        SimpleNamespace(
            allowed_web_origins=[],
            payment_environment=payment_env,
            payment_debug_secret_fingerprint=enabled,
            mercado_pago_webhook_secret=TEST_SECRET if secret_present else None,
        ),
    )

    async def run_startup() -> None:
        async with api_main.lifespan(api_main.app):
            pass

    asyncio.run(run_startup())
    line = f"mercado_pago.webhook_secret_fingerprint={fingerprint_secret(TEST_SECRET)}"
    assert (line in caplog.text) is should_log
    assert TEST_SECRET not in caplog.text
    assert hashlib.sha256(TEST_SECRET.encode()).hexdigest() not in caplog.text


def test_local_script_prints_only_the_same_fingerprint() -> None:
    script = Path(__file__).resolve().parents[1] / "scripts" / "fingerprint_secret.py"
    environment = {**os.environ, "MERCADO_PAGO_WEBHOOK_SECRET": TEST_SECRET}
    result = subprocess.run([sys.executable, str(script)], env=environment, capture_output=True, text=True, check=False)
    assert result.returncode == 0
    assert result.stdout == f"{fingerprint_secret(TEST_SECRET)}\n"
    assert TEST_SECRET not in result.stdout + result.stderr
    assert hashlib.sha256(TEST_SECRET.encode()).hexdigest() not in result.stdout + result.stderr

    environment.pop("MERCADO_PAGO_WEBHOOK_SECRET")
    missing = subprocess.run([sys.executable, str(script)], env=environment, capture_output=True, text=True, check=False)
    assert missing.returncode == 1
    assert missing.stdout == ""
