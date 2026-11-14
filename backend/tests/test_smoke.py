"""Smoke tests for the minimal application."""

import asyncio

import httpx

from app.main import app


def request(path: str) -> httpx.Response:
    async def _request() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get(path)

    return asyncio.run(_request())


def test_application_import_and_initialization() -> None:
    assert app.title == "CSTAR-Energy API"


def test_health_endpoint() -> None:
    response = request("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_docs_available() -> None:
    response = request("/docs")
    assert response.status_code == 200
