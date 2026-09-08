from pydantic import BaseModel


class AuthenticatedUser(BaseModel):
    id: str
    email: str | None = None
    auth_role: str | None = None


class MeResponse(BaseModel):
    id: str
    email: str | None
    role: str
