import logging
import unicodedata

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def _normalize(value: str) -> str:
    return "".join(character for character in unicodedata.normalize("NFD", value.lower()) if unicodedata.category(character) != "Mn")


def geocode_arena_address(address: str, city: str, state: str) -> tuple[float, float] | None:
    """Resolve an owner-edited address once; never use this during public searches."""
    if not settings.arena_geocoding_url:
        return None
    try:
        response = httpx.get(
            settings.arena_geocoding_url,
            params={"q": f"{address}, {city}, {state}, Brasil", "format": "jsonv2", "addressdetails": 1, "limit": 1, "countrycodes": "br"},
            headers={"User-Agent": settings.arena_geocoding_user_agent, "Accept": "application/json"},
            timeout=5,
        )
        response.raise_for_status()
        results = response.json()
        if not isinstance(results, list) or not results:
            return None
        result = results[0]
        if (
            not isinstance(result, dict)
            or not isinstance(result.get("address"), dict)
            or result["address"].get("country_code") != "br"
            or result["address"].get("ISO3166-2-lvl4") != f"BR-{state.upper()}"
            or _normalize(city) not in _normalize(str(result.get("display_name", "")))
        ):
            return None
        latitude, longitude = float(result["lat"]), float(result["lon"])
        if -90 <= latitude <= 90 and -180 <= longitude <= 180:
            return latitude, longitude
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        logger.warning("arena_geocode_failed", exc_info=False)
    return None
