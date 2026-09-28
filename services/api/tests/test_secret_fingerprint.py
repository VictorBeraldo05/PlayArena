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
            payment_provider="disabled",
            payment_mode="disabled",
            payment_production_test_allowed_user_id=None,
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


@pytest.mark.parametrize(
    ("production_enabled", "controlled", "allowed_user_id", "expected_state", "expected_allowlist", "expected_warning"),
    [
        (False, False, None, "production_disabled", "inactive", None),
        (True, True, "00000000-0000-0000-0000-00000000000a", "production_controlled", "single_user", None),
        (True, True, None, "production_controlled", "none", "controlled_without_allowlist"),
        (True, False, "00000000-0000-0000-0000-00000000000a", "production_open", "ignored", "stale_allowed_user_id_ignored"),
        (True, False, None, "production_open", "inactive", None),
    ],
)
def test_startup_logs_production_payment_mode_without_user_id(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    production_enabled: bool,
    controlled: bool,
    allowed_user_id: str | None,
    expected_state: str,
    expected_allowlist: str,
    expected_warning: str | None,
) -> None:
    caplog.set_level("INFO", logger="app.main")
    monkeypatch.setattr(
        api_main,
        "settings",
        Settings(
            _env_file=None,
            PAYMENT_PROVIDER="mercado_pago",
            PAYMENT_ENV="production",
            PAYMENT_SANDBOX_ENABLED=False,
            PAYMENT_PRODUCTION_ENABLED=production_enabled,
            PAYMENT_PRODUCTION_TEST_ENABLED=controlled,
            PAYMENT_PRODUCTION_TEST_ALLOWED_USER_ID=allowed_user_id,
            MERCADO_PAGO_ACCESS_TOKEN="fake-production-token",
            MERCADO_PAGO_WEBHOOK_SECRET="fake-webhook-secret",
        ),
    )

    async def run_startup() -> None:
        async with api_main.lifespan(api_main.app):
            pass

    asyncio.run(run_startup())
    assert f"state={expected_state} allowlist={expected_allowlist}" in caplog.text
    if expected_warning:
        assert expected_warning in caplog.text
    else:
        assert "payment.mode controlled_without_allowlist" not in caplog.text
        assert "payment.mode stale_allowed_user_id_ignored" not in caplog.text
    assert allowed_user_id is None or allowed_user_id not in caplog.text


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
