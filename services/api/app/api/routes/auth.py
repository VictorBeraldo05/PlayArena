from fastapi import APIRouter, Depends
import logging

from app.dependencies.auth import get_current_role, get_current_user
from app.schemas.auth import AuthenticatedUser, MeResponse

router = APIRouter(tags=["auth"])
logger = logging.getLogger(__name__)


@router.get("/me", response_model=MeResponse)
def read_me(
    current_user: AuthenticatedUser = Depends(get_current_user),
    current_role: str = Depends(get_current_role),
) -> MeResponse:
    response = MeResponse(id=current_user.id, email=current_user.email, role=current_role)
    logger.info("[ME] response created for user=%s", current_user.id)
    return response
