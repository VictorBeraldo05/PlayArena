from fastapi import APIRouter, Depends

from app.dependencies.auth import get_current_role, get_current_user
from app.schemas.auth import AuthenticatedUser, MeResponse

router = APIRouter(tags=["auth"])


@router.get("/me", response_model=MeResponse)
def read_me(
    current_user: AuthenticatedUser = Depends(get_current_user),
    current_role: str = Depends(get_current_role),
) -> MeResponse:
    return MeResponse(id=current_user.id, email=current_user.email, role=current_role)
