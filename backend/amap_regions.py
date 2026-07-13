
"""AMap-backed region helpers for MusicCloud weather locations.

The weather-location picker uses AMap adcodes as the canonical key for China.
GeoNames remains useful for global search, but it must not replace the China
cascade because the weather flow is China/adcode oriented.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from threading import RLock
from time import time
from typing import Any

import json
import httpx

AMAP_DISTRICT_URL = "https://restapi.amap.com/v3/config/district"
AMAP_WEATHER_URL = "https://restapi.amap.com/v3/weather/weatherInfo"
CHINA_NAME = "\u4e2d\u56fd"
CHINA_ADCODE = "100000"
MUNICIPALITY_PREFIXES = {"11", "12", "31", "50"}
DIRECT_ADMIN_PREFIXES = MUNICIPALITY_PREFIXES | {"81", "82"}
BASE_DIR = Path(__file__).resolve().parent
AMAP_CACHE_DIR = BASE_DIR / "data" / "amap_cache"
AMAP_DISTRICT_CACHE = AMAP_CACHE_DIR / "district_cache.json"
AMAP_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
_AMAP_CACHE_LOCK = RLock()
_AMAP_DISTRICT_CACHE_DATA: dict[str, dict[str, Any]] | None = None


class AMapError(RuntimeError):
    pass


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _request_json(url: str, params: dict[str, Any], timeout: float = 8.0) -> dict[str, Any]:
    try:
        resp = httpx.get(url, params=params, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001 - converted to API-level fallback/error
        raise AMapError(str(exc)) from exc
    if str(data.get("status")) != "1":
        raise AMapError(data.get("info") or data.get("infocode") or "AMap request failed")
    return data


def _load_district_cache() -> dict[str, dict[str, Any]]:
    global _AMAP_DISTRICT_CACHE_DATA
    if _AMAP_DISTRICT_CACHE_DATA is not None:
        return _AMAP_DISTRICT_CACHE_DATA
    with _AMAP_CACHE_LOCK:
        if _AMAP_DISTRICT_CACHE_DATA is not None:
            return _AMAP_DISTRICT_CACHE_DATA
        try:
            raw = json.loads(AMAP_DISTRICT_CACHE.read_text(encoding="utf-8"))
            _AMAP_DISTRICT_CACHE_DATA = raw if isinstance(raw, dict) else {}
        except Exception:
            _AMAP_DISTRICT_CACHE_DATA = {}
        return _AMAP_DISTRICT_CACHE_DATA


def _save_district_cache() -> None:
    with _AMAP_CACHE_LOCK:
        try:
            AMAP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = AMAP_DISTRICT_CACHE.with_suffix(".tmp")
            tmp.write_text(json.dumps(_load_district_cache(), ensure_ascii=False), encoding="utf-8")
            tmp.replace(AMAP_DISTRICT_CACHE)
        except Exception:
            # Cache is an optimization only. Never break region selection because
            # the disk cache cannot be written.
            pass


def _cache_key(keywords: str, subdistrict: int) -> str:
    return f"district|{_clean(keywords)}|{int(subdistrict)}"


def _get_cached_districts(keywords: str, subdistrict: int, allow_stale: bool = False) -> tuple[dict[str, Any], ...] | None:
    entry = _load_district_cache().get(_cache_key(keywords, subdistrict))
    if not entry:
        return None
    rows = entry.get("districts")
    if not isinstance(rows, list):
        return None
    age = time() - float(entry.get("time") or 0)
    if age > AMAP_CACHE_TTL_SECONDS and not allow_stale:
        return None
    return tuple(rows)


def _put_cached_districts(keywords: str, subdistrict: int, rows: list[dict[str, Any]]) -> None:
    cache = _load_district_cache()
    cache[_cache_key(keywords, subdistrict)] = {"time": time(), "districts": rows}
    _save_district_cache()


@lru_cache(maxsize=2048)
def _district_cached(api_key: str, keywords: str, subdistrict: int = 1) -> tuple[dict[str, Any], ...]:
    cached = _get_cached_districts(keywords, subdistrict)
    if cached is not None:
        return cached
    try:
        data = _request_json(
            AMAP_DISTRICT_URL,
            {
                "key": api_key,
                "keywords": keywords,
                "subdistrict": str(subdistrict),
                "extensions": "base",
            },
        )
        rows = list(data.get("districts") or [])
        _put_cached_districts(keywords, subdistrict, rows)
        return tuple(rows)
    except AMapError:
        stale = _get_cached_districts(keywords, subdistrict, allow_stale=True)
        if stale is not None:
            return stale
        raise


def _first_district(api_key: str, keywords: str, subdistrict: int = 1) -> dict[str, Any] | None:
    rows = _district_cached(api_key, keywords, subdistrict)
    return dict(rows[0]) if rows else None


def _option(row: dict[str, Any], parent_adcode: str | None = None) -> dict[str, Any]:
    name = _clean(row.get("name"))
    adcode = _clean(row.get("adcode"))
    level = _clean(row.get("level"))
    center = _clean(row.get("center"))
    return {
        "value": adcode or name,
        "label": name,
        "name": name,
        "adcode": adcode,
        "level": level,
        "parent_adcode": parent_adcode or "",
        "center": center,
        "source": "amap",
        "country": CHINA_NAME,
        "country_code": "CN",
    }


def _is_selectable_level(item: dict[str, Any]) -> bool:
    return (item.get("level") or "") in {"province", "city", "district"}


def china_root_option() -> dict[str, Any]:
    return {
        "value": CHINA_NAME,
        "label": CHINA_NAME,
        "name": CHINA_NAME,
        "adcode": CHINA_ADCODE,
        "level": "country",
        "parent_adcode": "",
        "center": "",
        "source": "amap",
        "country": CHINA_NAME,
        "country_code": "CN",
    }


def china_province_options(api_key: str) -> list[dict[str, Any]]:
    root = _first_district(api_key, CHINA_NAME, 1)
    if not root:
        return []
    return [_option(child, CHINA_ADCODE) for child in (root.get("districts") or [])]


def amap_child_options(api_key: str, adcode_or_name: str) -> list[dict[str, Any]]:
    parent = _first_district(api_key, adcode_or_name, 1)
    if not parent:
        return []
    parent_adcode = _clean(parent.get("adcode")) or adcode_or_name
    children = list(parent.get("districts") or [])
    # AMap represents direct municipalities as Province -> "Beijing urban area"
    # -> districts. The UI should not expose that synthetic city layer; flatten it.
    if (
        len(parent_adcode) == 6
        and parent_adcode[:2] in MUNICIPALITY_PREFIXES
        and parent_adcode[2:] == "0000"
        and len(children) == 1
        and _clean(children[0].get("level")) == "city"
    ):
        inner_code = _clean(children[0].get("adcode"))
        inner = _first_district(api_key, inner_code, 1) if inner_code else None
        inner_children = list((inner or {}).get("districts") or [])
        if inner_children:
            return [_option(child, parent_adcode) for child in inner_children]
    return [_option(child, parent_adcode) for child in children]


def amap_place(api_key: str, adcode_or_name: str) -> dict[str, Any] | None:
    row = _first_district(api_key, adcode_or_name, 0)
    return _option(row) if row else None


def _adcode_chain(adcode: str) -> list[tuple[str, str]]:
    code = "".join(ch for ch in str(adcode or "") if ch.isdigit())
    if len(code) != 6:
        return []
    province_code = code[:2] + "0000"
    chain: list[tuple[str, str]] = [("province", province_code)]
    if code[2:] == "0000":
        return chain
    if code[:2] in DIRECT_ADMIN_PREFIXES:
        if code != province_code:
            chain.append(("district", code))
        return chain
    city_code = code[:4] + "00"
    chain.append(("city", city_code))
    if code != city_code:
        chain.append(("district", code))
    return chain


def resolve_amap_location(api_key: str, adcode: str, fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    fallback = fallback or {}
    resolved = {
        "country": china_root_option(),
        "province": None,
        "city": None,
        "district": None,
        "selected": None,
    }
    seen: set[tuple[str, str]] = set()
    for level, code in _adcode_chain(adcode):
        key = (level, code)
        if key in seen:
            continue
        seen.add(key)
        place = amap_place(api_key, code)
        if not place:
            continue
        if level == "city" and place.get("level") == "province":
            place["level"] = "city"
        resolved[level] = place
        resolved["selected"] = place
    if not resolved["selected"] and fallback:
        resolved["selected"] = fallback
    return resolved


def search_amap_regions(api_key: str, query: str, limit: int = 20) -> list[dict[str, Any]]:
    q = _clean(query)
    if not q:
        return []
    try:
        rows = _district_cached(api_key, q, 0)
    except AMapError:
        return []
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        item = _option(row)
        if not _is_selectable_level(item):
            continue
        code = str(item.get("adcode") or "")
        # Hide synthetic direct-municipality city rows such as ????/????.
        if item.get("level") == "city" and len(code) == 6 and code[:2] in DIRECT_ADMIN_PREFIXES:
            continue
        adcode = item.get("adcode") or item.get("name")
        if not adcode or adcode in seen:
            continue
        seen.add(adcode)
        item["type"] = item.get("level") or "region"
        item["weather_name"] = item.get("name")
        results.append(item)
        if len(results) >= limit:
            break
    return results



def _norm_path_part(value: str) -> str:
    return _clean(value).replace("\uFF0F", "/").replace("\\", "/")


def search_amap_region_path(api_key: str, query: str, limit: int = 20) -> list[dict[str, Any]]:
    """Resolve path-like China queries such as ??/???????/??."""
    parts = [_clean(p) for p in _norm_path_part(query).split("/") if _clean(p)]
    if len(parts) < 2:
        return []
    if parts[0] in {CHINA_NAME, "CN", "China"}:
        parts = parts[1:]
    if not parts:
        return []
    current_options = china_province_options(api_key)
    parent = None
    for idx, part in enumerate(parts):
        match = next((item for item in current_options if item.get("name") == part or item.get("label") == part or item.get("adcode") == part), None)
        if not match:
            fuzzy = [item for item in current_options if part in (item.get("name") or "") or (item.get("name") or "") in part]
            match = fuzzy[0] if fuzzy else None
        if not match:
            return []
        parent = match
        if idx < len(parts) - 1:
            current_options = amap_child_options(api_key, match.get("adcode") or match.get("value") or match.get("name"))
    if not parent:
        return []
    item = dict(parent)
    item["type"] = item.get("level") or "region"
    item["weather_name"] = item.get("name")
    return [item]


def search_amap_with_context(api_key: str, query: str, country: str | None = None, province: str | None = None, city: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """Search China regions, preferring currently selected parent context."""
    path_hit = search_amap_region_path(api_key, query, limit)
    if path_hit:
        return path_hit[:limit]
    q = _clean(query)
    scoped: list[dict[str, Any]] = []
    try:
        if city:
            scoped = [item for item in amap_child_options(api_key, city) if _is_selectable_level(item) and (q in (item.get("name") or "") or (item.get("name") or "") in q)]
        if not scoped and province:
            children = amap_child_options(api_key, province)
            scoped = [item for item in children if _is_selectable_level(item) and (q in (item.get("name") or "") or (item.get("name") or "") in q)]
            if not scoped:
                for child in children:
                    if child.get("level") == "city":
                        districts = amap_child_options(api_key, child.get("adcode") or child.get("value") or "")
                        scoped.extend([item for item in districts if _is_selectable_level(item) and (q in (item.get("name") or "") or (item.get("name") or "") in q)])
                        if len(scoped) >= limit:
                            break
        if scoped:
            results = []
            seen = set()
            for item in scoped:
                key = item.get("adcode") or item.get("name")
                if key in seen:
                    continue
                seen.add(key)
                item = dict(item)
                item["type"] = item.get("level") or "region"
                item["weather_name"] = item.get("name")
                results.append(item)
                if len(results) >= limit:
                    break
            return results
    except AMapError:
        return []
    return search_amap_regions(api_key, query, limit)

def get_amap_weather(api_key: str, adcode: str) -> dict[str, Any]:
    data = _request_json(
        AMAP_WEATHER_URL,
        {"key": api_key, "city": adcode, "extensions": "base"},
    )
    lives = data.get("lives") or []
    if not lives:
        raise AMapError("No AMap weather lives returned")
    live = lives[0]
    return {
        "source": "amap",
        "province": live.get("province"),
        "city": live.get("city"),
        "adcode": live.get("adcode") or adcode,
        "weather": live.get("weather"),
        "temperature": live.get("temperature"),
        "temp": live.get("temperature"),
        "winddirection": live.get("winddirection"),
        "windpower": live.get("windpower"),
        "humidity": live.get("humidity"),
        "reporttime": live.get("reporttime"),
    }
