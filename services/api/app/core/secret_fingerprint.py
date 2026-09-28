import hashlib


def fingerprint_secret(secret: str) -> str:
    if not secret:
        raise ValueError("Secret is not configured.")
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:10]
