from math import asin, cos, radians, sin, sqrt


def distance_km(origin_latitude: float, origin_longitude: float, arena_latitude: float, arena_longitude: float) -> float:
    """Approximate great-circle distance between two points, in kilometers."""
    lat1, lng1, lat2, lng2 = map(radians, (origin_latitude, origin_longitude, arena_latitude, arena_longitude))
    haversine = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371.0088 * asin(sqrt(min(1.0, max(0.0, haversine))))
