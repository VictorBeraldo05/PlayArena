def test_healthcheck(create_client) -> None:
    client = create_client
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "playarena-api",
    }
