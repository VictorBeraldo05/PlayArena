from app.api.routes.auth import router as auth_router
from app.api.routes.booking import router as booking_router
from app.api.routes.owner import router as owner_router
from app.api.routes.owner import sports_router
from app.api.routes.analytics import admin_router as analytics_admin_router
from app.api.routes.analytics import router as analytics_router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.core.config import settings


def create_application() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(booking_router)
    app.include_router(sports_router)
    app.include_router(owner_router)
    app.include_router(analytics_router)
    app.include_router(analytics_admin_router)
    return app


app = create_application()
