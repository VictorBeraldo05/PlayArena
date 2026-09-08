from fastapi import HTTPException, status

from app.dependencies import auth as auth_dependencies
from app.dependencies.auth import get_current_user
from app.schemas.auth import AuthenticatedUser
from app.services.auth import SupabaseAuthVerifier, get_auth_verifier
from app.main import app


def test_me_requires_token(create_client) -> None:
    client = create_client
    response = client.get("/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required."}


def test_me_rejects_invalid_token(create_client) -> None:
    class InvalidTokenVerifier:
        def verify_access_token(self, token: str) -> AuthenticatedUser:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token.",
            )

    app.dependency_overrides[get_auth_verifier] = InvalidTokenVerifier

    response = create_client.get("/me", headers={"Authorization": "Bearer invalid"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid authentication token."}

    app.dependency_overrides.clear()


def test_me_returns_profile_role_for_valid_mocked_token(create_client, monkeypatch) -> None:
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id="user-123",
        email="owner@playarena.dev",
        auth_role="authenticated",
    )
    monkeypatch.setattr(auth_dependencies, "get_profile_role", lambda user_id: "arena_owner")

    client = create_client
    response = client.get("/me", headers={"Authorization": "Bearer test"})

    assert response.status_code == 200
    assert response.json() == {
        "id": "user-123",
        "email": "owner@playarena.dev",
        "role": "arena_owner",
    }

    app.dependency_overrides.clear()


def test_me_returns_controlled_error_when_profile_is_missing(create_client, monkeypatch) -> None:
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id="user-without-profile",
        email="player@playarena.dev",
        auth_role="authenticated",
    )
    monkeypatch.setattr(auth_dependencies, "get_profile_role", lambda user_id: None)

    response = create_client.get("/me", headers={"Authorization": "Bearer valid-mocked-token"})

    assert response.status_code == 404
    assert response.json() == {"detail": "Profile not found."}

    app.dependency_overrides.clear()


def test_supabase_auth_verifier_accepts_user_returned_by_auth_server(monkeypatch) -> None:
    class Response:
        status_code = 200

        @staticmethod
        def json() -> dict[str, str]:
            return {"id": "user-123", "email": "owner@playarena.dev", "role": "authenticated"}

    class Client:
        def __init__(self, **_kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        @staticmethod
        def get(*_args, **_kwargs) -> Response:
            return Response()

    monkeypatch.setattr("app.services.auth.httpx.Client", Client)

    user = SupabaseAuthVerifier("https://project.supabase.co", "anon-key").verify_access_token("invalid")

    assert user == AuthenticatedUser(id="user-123", email="owner@playarena.dev", auth_role="authenticated")
