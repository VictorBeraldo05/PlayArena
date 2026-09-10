from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from app.dependencies.auth import get_current_role, get_current_user
from app.repositories.analytics_repository import insert_event, platform_overview
from app.schemas.analytics import AnalyticsEventCreate
from app.schemas.auth import AuthenticatedUser
from app.services.auth import SupabaseAuthVerifier, get_auth_verifier

router = APIRouter(prefix="/analytics", tags=["analytics"])
admin_router = APIRouter(prefix="/admin/analytics", tags=["platform analytics"])


def optional_user(authorization: str | None = Header(default=None), verifier: SupabaseAuthVerifier = Depends(get_auth_verifier)) -> AuthenticatedUser | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return verifier.verify_access_token(authorization.removeprefix("Bearer ").strip())
    except HTTPException:
        return None


def require_admin(current_user: AuthenticatedUser = Depends(get_current_user), role: str = Depends(get_current_role)) -> AuthenticatedUser:
    if role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform admin access required.")
    return current_user


@router.post("/events", status_code=status.HTTP_202_ACCEPTED)
def post_event(event: AnalyticsEventCreate, current_user: AuthenticatedUser | None = Depends(optional_user)) -> dict:
    insert_event(event.model_dump(mode="json"), current_user.id if current_user else None)
    return {"accepted": True}


@admin_router.get("/overview")
def get_overview(days: int = Query(default=7, ge=1, le=90), _: AuthenticatedUser = Depends(require_admin)) -> dict:
    return platform_overview(days)
