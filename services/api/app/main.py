import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from app.api.routes.auth import router as auth_router
from app.api.routes.booking import router as booking_router
from app.api.routes.owner import router as owner_router
from app.api.routes.owner import sports_router
from app.api.routes.payments import admin_router as payments_admin_router
from app.api.routes.payments import router as payments_router
from app.api.routes.payments import webhook_router as payments_webhook_router
from app.api.routes.analytics import admin_router as analytics_admin_router
from app.api.routes.analytics import router as analytics_router
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.core.config import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logger.info("CORS allowed origins: %s", settings.allowed_web_origins)
    yield


def create_application() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs" if settings.api_docs_enabled else None,
        redoc_url="/redoc" if settings.api_docs_enabled else None,
        openapi_url="/openapi.json" if settings.api_docs_enabled else None,
        lifespan=lifespan,
    )
    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > settings.max_request_body_bytes:
            return JSONResponse(status_code=413, content={"detail": "Request body is too large."})

        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Cache-Control", "no-store")
        vary = {item.strip() for item in response.headers.get("Vary", "").split(",") if item.strip()}
        vary.update({"Authorization", "Origin"})
        response.headers["Vary"] = ", ".join(sorted(vary))
        return response

    # Register CORS after the security middleware so it is the outermost
    # application middleware and decorates preflight and early error responses.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_web_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(booking_router)
    app.include_router(sports_router)
    app.include_router(owner_router)
    app.include_router(analytics_router)
    app.include_router(analytics_admin_router)
    app.include_router(payments_router)
    app.include_router(payments_webhook_router)
    app.include_router(payments_admin_router)
    return app


app = create_application()
