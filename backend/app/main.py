"""Minimal FastAPI application entry point for CSTAR-Energy."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings

settings = get_settings()
app = FastAPI(title=settings.app_name, docs_url="/docs", redoc_url="/redoc")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api/v1")

@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    """Return basic process health without external service dependencies."""
    return {"status": "ok"}
