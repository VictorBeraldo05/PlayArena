import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def create_client() -> TestClient:
    return TestClient(app)
