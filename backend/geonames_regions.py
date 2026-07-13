
"""GeoNames-backed region lookup helpers.

The app can run without the generated SQLite database. When
``geonames_regions.sqlite`` is present, these helpers use GeoNames places and
alternate names. Otherwise they fall back to the existing ``global_regions``
JSON so the old cascading selector keeps working.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
GEONAMES_DB = BASE_DIR / "geonames_regions.sqlite"
SUPPORTED_LANGS = {"zh-CN", "zh-TW", "en", "ja", "ko"}
LANG_FALLBACKS = {
    "zh-CN": ["zh-CN", "zh-Hans", "zh"],
    "zh-TW": ["zh-TW", "zh-Hant", "zh"],
    "en": ["en"],
    "ja": ["ja"],
    "ko": ["ko"],
}

REGION_NAME_I18N = {
    "\u4e2d\u56fd": {"zh-TW": "\u4e2d\u570b", "en": "China", "ja": "\u4e2d\u56fd", "ko": "\uc911\uad6d"},
    "\u6c5f\u82cf": {"zh-TW": "\u6c5f\u8607", "en": "Jiangsu", "ja": "\u6c5f\u8607", "ko": "\uc7a5\uc218"},
    "\u6c5f\u82cf\u7701": {"zh-TW": "\u6c5f\u8607\u7701", "en": "Jiangsu Province", "ja": "\u6c5f\u8607\u7701", "ko": "\uc7a5\uc218\uc131"},
    "\u5357\u4eac": {"zh-TW": "\u5357\u4eac", "en": "Nanjing", "ja": "\u5357\u4eac", "ko": "\ub09c\uc9d5"},
    "\u5357\u4eac\u5e02": {"zh-TW": "\u5357\u4eac\u5e02", "en": "Nanjing City", "ja": "\u5357\u4eac\u5e02", "ko": "\ub09c\uc9d5\uc2dc"},
    "\u7384\u6b66\u533a": {"zh-TW": "\u7384\u6b66\u5340", "en": "Xuanwu District", "ja": "\u7384\u6b66\u533a", "ko": "\ud604\ubb34\uad6c"},
    "\u5317\u4eac": {"zh-TW": "\u5317\u4eac", "en": "Beijing", "ja": "\u5317\u4eac", "ko": "\ubca0\uc774\uc9d5"},
    "\u4e0a\u6d77": {"zh-TW": "\u4e0a\u6d77", "en": "Shanghai", "ja": "\u4e0a\u6d77", "ko": "\uc0c1\ud558\uc774"},
    "\u5e7f\u5dde": {"zh-TW": "\u5ee3\u5dde", "en": "Guangzhou", "ja": "\u5e83\u5dde", "ko": "\uad11\uc800\uc6b0"},
    "\u6df1\u5733": {"zh-TW": "\u6df1\u5733", "en": "Shenzhen", "ja": "\u6df1\u5733", "ko": "\uc120\uc804"},
    "\u676d\u5dde": {"zh-TW": "\u676d\u5dde", "en": "Hangzhou", "ja": "\u676d\u5dde", "ko": "\ud56d\uc800\uc6b0"},
    "\u82cf\u5dde": {"zh-TW": "\u8607\u5dde", "en": "Suzhou", "ja": "\u8607\u5dde", "ko": "\uc4d4\uc800\uc6b0"},
    "\u65e0\u9521": {"zh-TW": "\u7121\u932b", "en": "Wuxi", "ja": "\u7121\u932b", "ko": "\uc6b0\uc2dc"},
}


CN_ADMIN1_LEGACY = {
    "01": "\u5b89\u5fbd", "02": "\u6d59\u6c5f", "03": "\u6c5f\u897f", "04": "\u6c5f\u82cf", "05": "\u5409\u6797", "06": "\u9752\u6d77",
    "07": "\u798f\u5efa", "08": "\u9ed1\u9f99\u6c5f", "09": "\u6cb3\u5357", "10": "\u6cb3\u5317", "11": "\u6e56\u5357", "12": "\u6e56\u5317",
    "13": "\u65b0\u7586", "14": "\u897f\u85cf", "15": "\u7518\u8083", "16": "\u5e7f\u897f", "18": "\u8d35\u5dde", "19": "\u8fbd\u5b81",
    "20": "\u5185\u8499\u53e4", "21": "\u5b81\u590f", "22": "\u5317\u4eac", "23": "\u4e0a\u6d77", "24": "\u5c71\u897f", "25": "\u5c71\u4e1c",
    "26": "\u9655\u897f", "28": "\u5929\u6d25", "29": "\u4e91\u5357", "30": "\u5e7f\u4e1c", "31": "\u6d77\u5357", "32": "\u56db\u5ddd",
    "33": "\u91cd\u5e86",
}

SEARCH_ALIASES = {
    "china": "\u4e2d\u56fd", "cn": "\u4e2d\u56fd", "jiangsu": "\u6c5f\u82cf", "nanjing": "\u5357\u4eac",
    "nanking": "\u5357\u4eac", "xuanwu": "\u7384\u6b66\u533a", "beijing": "\u5317\u4eac", "shanghai": "\u4e0a\u6d77",
    "guangzhou": "\u5e7f\u5dde", "shenzhen": "\u6df1\u5733", "hangzhou": "\u676d\u5dde", "suzhou": "\u82cf\u5dde", "wuxi": "\u65e0\u9521",
}


def normalize_lang(lang: str | None) -> str:
    return lang if lang in SUPPORTED_LANGS else "zh-CN"


def has_geonames_db() -> bool:
    return GEONAMES_DB.exists()


def ensure_geonames_indexes() -> None:
    if not has_geonames_db():
        return
    with sqlite3.connect(GEONAMES_DB) as conn:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_alternate_names_geoname_lang ON alternate_names(geoname_id, lang)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_alternate_names_name ON alternate_names(name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_places_country_feature ON places(country_code, feature_class, feature_code, population)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_places_feature_population_country ON places(feature_class, feature_code, population, country_code)")
        conn.commit()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(GEONAMES_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA cache_size = -32768")
    conn.execute("PRAGMA mmap_size = 268435456")
    return conn


def localize_legacy_name(name: str, lang: str | None) -> str:
    lang = normalize_lang(lang)
    if lang == "zh-CN":
        return name
    hit = REGION_NAME_I18N.get(name)
    if hit and hit.get(lang):
        return hit[lang]
    if lang == "zh-TW":
        return name.replace("\u533a", "\u5340").replace("\u53bf", "\u7e23").replace("\u6c5f\u82cf", "\u6c5f\u8607").replace("\u82cf", "\u8607")
    return name


def option(value: str, label: str | None = None, **extra: Any) -> dict[str, Any]:
    payload = {"value": value, "label": label or value}
    payload.update({k: v for k, v in extra.items() if v not in (None, "")})
    return payload


def legacy_options(values: list[str], lang: str | None) -> list[dict[str, str]]:
    return [option(v, localize_legacy_name(v, lang)) for v in values]



def _norm_text(value: Any) -> str:
    return "".join(ch.lower() for ch in str(value or "") if ch.isalnum() or "\u4e00" <= ch <= "\u9fff")


def _legacy_city_province(global_regions: dict[str, Any], country: str, province: str | None, city: str | None) -> bool:
    if not country or not province or not city:
        return False
    return city in global_regions.get(country, {}).get(province, [])


def _strip_region_suffix(value: Any) -> str:
    text = str(value or "").strip()
    for suffix in ("\u5e02", "\u7701", "\u5dde", " Municipality", " City", " Province", " Department", " County", " Prefecture", " Region", " District"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
    return text


def _search_identity(item: dict[str, Any]) -> tuple[str, str, str]:
    """Return a stable key for merging legacy and GeoNames search hits.

    The same Chinese region may appear once from the bundled weather dataset and
    once from GeoNames with English names/codes. For the weather picker those are
    the same selectable location, so the key intentionally ignores source/type
    and normalizes CN admin codes back to Chinese names.
    """
    country = str(item.get("country") or item.get("country_code") or "")
    if country == "CN":
        country = "\u4e2d\u56fd"
    province = str(item.get("province") or "")
    if not province and country in {"\u4e2d\u56fd", "CN"}:
        province = CN_ADMIN1_LEGACY.get(str(item.get("admin1_code") or ""), "")
    place = item.get("city") or item.get("label") or item.get("value") or item.get("name") or item.get("weather_name") or ""
    place = _strip_region_suffix(place)
    province = _strip_region_suffix(province)
    return (_norm_text(country), _norm_text(province), _norm_text(place))


def _is_major_place(row: sqlite3.Row) -> bool:
    feature_class = row["feature_class"]
    feature_code = row["feature_code"]
    population = int(row["population"] or 0)
    if feature_class == "A":
        return feature_code in {"PCLI", "PCLD", "PCLF", "PCLIX", "ADM1", "ADM2"} or (
            feature_code == "ADM3" and population >= 100000
        )
    if feature_class != "P":
        return False
    if feature_code in {"PPLC", "PPLA", "PPLA2", "PPLA3"}:
        return True
    # GeoNames has many villages/hamlets as PPL/PPLX with population 0. They are
    # not suitable for this app's weather location picker.
    return population >= 50000


def _matched_name_allowed(row: sqlite3.Row, matched_name: str, query: str, label: str, weather_name: str) -> bool:
    qn = _norm_text(query)
    if not qn:
        return False
    canonical_values = [row["name"], label, weather_name]
    canonical_norms = [_norm_text(v) for v in canonical_values if v]
    matched_norm = _norm_text(matched_name)
    if any(n == qn or n.startswith(qn) for n in canonical_norms):
        return True
    # Exact alternate names are acceptable (e.g. historical/common aliases), but
    # prefix-only marketing nicknames like "New York Van Java" for Jakarta are not.
    return matched_norm == qn


def _search_rank(row: sqlite3.Row, matched_name: str, query: str, label: str, weather_name: str) -> tuple[int, int, str]:
    qn = _norm_text(query)
    values = [_norm_text(row["name"]), _norm_text(label), _norm_text(weather_name), _norm_text(matched_name)]
    if any(v == qn for v in values):
        text_rank = 0
    elif any(v.startswith(qn) for v in values[:3]):
        text_rank = 1
    elif values[3].startswith(qn):
        text_rank = 2
    else:
        text_rank = 4
    feature_order = {"PPLC": 0, "PPLA": 1, "PPLA2": 2, "PPLA3": 3, "PPL": 4, "PPLX": 5, "ADM1": 6, "ADM2": 7, "ADM3": 8}
    feature_rank = feature_order.get(row["feature_code"], 8)
    return (text_rank, feature_rank, str(row["name"] or "").lower())

def _localized_place_name(conn: sqlite3.Connection, geoname_id: int, lang: str, fallback: str) -> str:
    normalized_lang = normalize_lang(lang)
    if normalized_lang == "en":
        return fallback
    langs = LANG_FALLBACKS.get(normalized_lang, ["en"])
    rows = conn.execute(
        "SELECT lang, name, is_preferred FROM alternate_names WHERE geoname_id = ? AND lang IN ({}) ORDER BY is_preferred DESC, is_short ASC, is_colloquial ASC, is_historic ASC, length(name) ASC".format(
            ",".join("?" for _ in langs)
        ),
        [geoname_id, *langs],
    ).fetchall()
    if rows:
        return rows[0]["name"]
    if normalized_lang != "en":
        row = conn.execute(
            "SELECT name FROM alternate_names WHERE geoname_id = ? AND lang = 'en' ORDER BY is_preferred DESC, is_short ASC, is_colloquial ASC, is_historic ASC, length(name) ASC LIMIT 1",
            (geoname_id,),
        ).fetchone()
        if row:
            return row["name"]
    return fallback


def _resolve_country_code(conn: sqlite3.Connection, value: str) -> str:
    row = conn.execute(
        "SELECT country_code FROM places WHERE country_code = ? OR name = ? OR geoname_id = ? LIMIT 1",
        (value, value, value if str(value).isdigit() else -1),
    ).fetchone()
    if row:
        return row["country_code"]
    row = conn.execute(
        """
        SELECT p.country_code FROM alternate_names a JOIN places p ON p.geoname_id = a.geoname_id
        WHERE a.name = ? AND p.feature_class = 'A' AND p.feature_code LIKE 'PCL%' LIMIT 1
        """,
        (value,),
    ).fetchone()
    return row["country_code"] if row else value


def _resolve_admin1_code(conn: sqlite3.Connection, country_code: str, value: str) -> str:
    row = conn.execute(
        """
        SELECT admin1_code FROM places
        WHERE country_code = ? AND (admin1_code = ? OR name = ? OR geoname_id = ?)
          AND feature_class = 'A' AND feature_code = 'ADM1'
        LIMIT 1
        """,
        (country_code, value, value, value if str(value).isdigit() else -1),
    ).fetchone()
    if row:
        return row["admin1_code"]
    row = conn.execute(
        """
        SELECT p.admin1_code FROM alternate_names a JOIN places p ON p.geoname_id = a.geoname_id
        WHERE p.country_code = ? AND a.name = ? AND p.feature_class = 'A' AND p.feature_code = 'ADM1'
        LIMIT 1
        """,
        (country_code, value),
    ).fetchone()
    return row["admin1_code"] if row else value


def _country_label(conn: sqlite3.Connection, country_code: str | None, lang: str) -> str | None:
    if not country_code:
        return None
    row = conn.execute(
        """
        SELECT geoname_id, name FROM places
        WHERE country_code = ? AND feature_class = 'A' AND feature_code IN ('PCLI','PCLD','PCLF','PCLIX')
        ORDER BY CASE feature_code WHEN 'PCLI' THEN 0 ELSE 1 END
        LIMIT 1
        """,
        (country_code,),
    ).fetchone()
    if not row:
        return country_code
    return _localized_place_name(conn, row["geoname_id"], lang, row["name"])


def _row_to_search_option(conn: sqlite3.Connection, row: sqlite3.Row, lang: str) -> dict[str, Any]:
    label = _localized_place_name(conn, row["geoname_id"], lang, row["name"])
    weather_name = _localized_place_name(conn, row["geoname_id"], "zh-CN", row["name"])
    country_name = None
    country_label = _country_label(conn, row["country_code"], lang)
    province_name = None
    if row["country_code"] == "CN":
        country_name = "\u4e2d\u56fd"
        province_name = CN_ADMIN1_LEGACY.get(row["admin1_code"] or "")
    return option(
        row["name"], label,
        geoname_id=row["geoname_id"], country_code=row["country_code"], admin1_code=row["admin1_code"],
        admin2_code=row["admin2_code"], feature_class=row["feature_class"], feature_code=row["feature_code"],
        latitude=row["latitude"], longitude=row["longitude"], population=row["population"], name=row["name"],
        weather_name=weather_name, country=country_name, country_label=country_label, province=province_name,
    )


def _db_country_options(lang: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT geoname_id, name, country_code FROM places
            WHERE feature_class = 'A' AND feature_code IN ('PCLI','PCLD','PCLF','PCLIX')
            ORDER BY name COLLATE NOCASE
            """
        ).fetchall()
        return [
            option(row["country_code"], _localized_place_name(conn, row["geoname_id"], lang, row["name"]),
                   geoname_id=row["geoname_id"], country_code=row["country_code"], name=row["name"])
            for row in rows
        ]


def _db_admin1_options(country: str, lang: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        country_code = _resolve_country_code(conn, country)
        rows = conn.execute(
            """
            SELECT geoname_id, name, admin1_code, country_code FROM places
            WHERE feature_class = 'A' AND feature_code = 'ADM1' AND country_code = ?
            ORDER BY name COLLATE NOCASE
            """,
            (country_code,),
        ).fetchall()
        return [
            option(row["admin1_code"] or str(row["geoname_id"]), _localized_place_name(conn, row["geoname_id"], lang, row["name"]),
                   geoname_id=row["geoname_id"], country_code=row["country_code"], admin1_code=row["admin1_code"], name=row["name"])
            for row in rows
        ]


def _db_city_options(country: str, province: str, lang: str, limit: int = 200) -> list[dict[str, Any]]:
    with _connect() as conn:
        country_code = _resolve_country_code(conn, country)
        admin1_code = _resolve_admin1_code(conn, country_code, province)
        rows = conn.execute(
            """
            SELECT geoname_id, name, country_code, admin1_code, admin2_code, feature_class, feature_code,
                   latitude, longitude, population
            FROM places
            WHERE country_code = ? AND admin1_code = ?
              AND feature_class = 'P'
              AND feature_code IN ('PPLC','PPLA','PPLA2','PPLA3','PPLA4','PPL')
              AND (population > 0 OR feature_code IN ('PPLC','PPLA','PPLA2','PPLA3','PPLA4'))
            ORDER BY CASE feature_code
                WHEN 'PPLC' THEN 0 WHEN 'PPLA' THEN 1 WHEN 'PPLA2' THEN 2
                WHEN 'PPLA3' THEN 3 WHEN 'PPLA4' THEN 4 ELSE 5 END,
                population DESC, name COLLATE NOCASE
            LIMIT ?
            """,
            (country_code, admin1_code, limit),
        ).fetchall()
        return [_row_to_search_option(conn, row, lang) for row in rows]


def region_options(global_regions: dict[str, Any], country: str | None, province: str | None, lang: str | None) -> list[dict[str, Any]]:
    """Return stable cascading options from the bundled legacy dataset.

    Important: the cascading selector is used for weather lookup and user
    location persistence, so its values must remain the original Chinese names
    expected by the weather API. GeoNames is intentionally reserved for search
    suggestions and must not replace the primary cascade values with country
    codes, admin codes, or English labels.
    """
    if country is None:
        return [option(v, v) for v in sorted(global_regions.keys())]
    country_data = global_regions.get(country)
    if country_data is None:
        return []
    if province is None:
        return [option(v, v) for v in sorted(country_data.keys())]
    return [option(v, v) for v in country_data.get(province, [])]


def search_regions(global_regions: dict[str, Any], q: str, lang: str | None, country: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    lang = normalize_lang(lang)
    query = (q or "").strip()
    if not query:
        return []

    # The bundled dataset is the canonical source for the app's Chinese weather
    # cascade. Always search it first so values stay stable Chinese names.
    results = _legacy_search(global_regions, query, lang, country, limit)
    seen = {_search_identity(item) for item in results}

    if has_geonames_db() and len(results) < limit:
        try:
            with _connect() as conn:
                for item in _db_search_regions(conn, global_regions, query, lang, country, limit * 4):
                    sig = _search_identity(item)
                    if sig in seen:
                        continue
                    results.append(item)
                    seen.add(sig)
                    if len(results) >= limit:
                        break
        except Exception as exc:
            print(f"GeoNames search failed, using legacy search only: {exc}")
    return results[:limit]



def _db_search_regions(conn: sqlite3.Connection, global_regions: dict[str, Any], query: str, lang: str, country: str | None, limit: int) -> list[dict[str, Any]]:
    """Search GeoNames, but only return weather-picker-safe places.

    GeoNames contains villages, hamlets, nicknames, and ambiguous transliterations.
    Those records are useful for a map, but unsafe for this app's weather selector.
    This function therefore keeps only major settlements/admin regions and rejects
    prefix-only alias matches that do not actually name the place.
    """
    country_code = _resolve_country_code(conn, country) if country else None
    exact_variants = []
    for value in (query.strip(), query.strip().title(), query.strip().upper()):
        if value and value not in exact_variants:
            exact_variants.append(value)
    rows = []
    if exact_variants:
        placeholders = ",".join("?" for _ in exact_variants)
        exact_country_sql = " AND country_code = ?" if country_code else ""
        exact_params: list[Any] = [*exact_variants]
        if country_code:
            exact_params.append(country_code)
        exact_params.append(max(limit, 20))
        rows = conn.execute(
            f"""
            SELECT geoname_id, name, country_code, admin1_code, admin2_code,
                   feature_class, feature_code, latitude, longitude, population,
                   name AS matched_name
            FROM places INDEXED BY idx_places_name
            WHERE name IN ({placeholders}) {exact_country_sql}
              AND ((feature_class = 'P') OR (feature_class = 'A' AND feature_code IN ('PCLI','PCLD','PCLF','PCLIX','ADM1','ADM2','ADM3')))
            ORDER BY CASE feature_code WHEN 'PPLC' THEN 0 WHEN 'PPLA' THEN 1 WHEN 'PPLA2' THEN 2 WHEN 'PPLA3' THEN 3 WHEN 'PPL' THEN 4 WHEN 'ADM1' THEN 5 WHEN 'ADM2' THEN 6 ELSE 7 END,
                     population DESC, name COLLATE NOCASE
            LIMIT ?
            """,
            exact_params,
        ).fetchall()
    if not any(row["feature_class"] == "P" and _is_major_place(row) for row in rows):
        token = _fts_query(query)
        country_sql = " AND p.country_code = ?" if country_code else ""
        params: list[Any] = [token]
        if country_code:
            params.append(country_code)
        params.append(min(max(limit * 4, 80), 200))
        try:
            rows = [*rows, *conn.execute(
                f"""
                SELECT p.geoname_id, p.name, p.country_code, p.admin1_code, p.admin2_code,
                       p.feature_class, p.feature_code, p.latitude, p.longitude, p.population,
                       s.name AS matched_name
                FROM region_search s JOIN places p ON p.geoname_id = s.geoname_id
                WHERE region_search MATCH ? {country_sql}
                  AND ((p.feature_class = 'P') OR (p.feature_class = 'A' AND p.feature_code IN ('PCLI','PCLD','PCLF','PCLIX','ADM1','ADM2','ADM3')))
                ORDER BY p.population DESC, p.name COLLATE NOCASE
                LIMIT ?
                """,
                params,
            ).fetchall()]
        except sqlite3.OperationalError:
            rows = rows or []

    best: dict[int, tuple[tuple[int, int, str], sqlite3.Row, str, str, str]] = {}
    for row in rows:
        if not _is_major_place(row):
            continue
        label = _localized_place_name(conn, row["geoname_id"], lang, row["name"])
        weather_name = _localized_place_name(conn, row["geoname_id"], "zh-CN", row["name"])
        matched_name = row["matched_name"] or row["name"]
        if not _matched_name_allowed(row, matched_name, query, label, weather_name):
            continue
        rank = _search_rank(row, matched_name, query, label, weather_name)
        current = best.get(row["geoname_id"])
        if current is None or rank < current[0]:
            best[row["geoname_id"]] = (rank, row, label, weather_name, matched_name)

    ordered = sorted(best.values(), key=lambda item: (item[0], -(int(item[1]["population"] or 0))))
    # If there are exact name hits, suppress prefix-only matches such as
    # "London Road" for query "london" or "Paris 05" for query "paris".
    if any(rank[0] == 0 for rank, *_rest in ordered):
        ordered = [entry for entry in ordered if entry[0][0] == 0]

    results: list[dict[str, Any]] = []
    seen_names: set[tuple[str, str, str]] = set()
    for _rank, row, label, weather_name, matched_name in ordered:
        item = _row_to_search_option(conn, row, lang)
        item["label"] = label
        item["weather_name"] = weather_name
        item["matched_name"] = matched_name
        item["source"] = "geonames"
        item["type"] = "city" if row["feature_class"] == "P" else "admin"
        if row["country_code"] == "CN":
            province = item.get("province")
            # Only promote China GeoNames places to selectable cities when the
            # name exists in the legacy province-city list. This prevents villages
            # such as village-level GeoNames records from being mixed with city-level districts.
            city_name = weather_name.removesuffix("\u5e02") if isinstance(weather_name, str) else weather_name
            if _legacy_city_province(global_regions, "\u4e2d\u56fd", province, city_name):
                item["city"] = city_name
                item["value"] = city_name
                item["weather_name"] = city_name
            elif row["feature_class"] == "P":
                continue
        dedupe_key = _search_identity(item)
        if dedupe_key in seen_names:
            continue
        seen_names.add(dedupe_key)
        results.append(item)
        if len(results) >= limit:
            break
    return results


def _fts_query(query: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or "\u4e00" <= ch <= "\u9fff" else " " for ch in query).strip()
    parts = [part for part in cleaned.split() if part]
    if not parts:
        return '""'
    return " AND ".join(f'"{part}"*' for part in parts)

def _legacy_search(global_regions: dict[str, Any], query: str, lang: str, country: str | None, limit: int) -> list[dict[str, Any]]:
    alias_target = SEARCH_ALIASES.get(query.lower())
    results: list[dict[str, Any]] = []
    countries = [country] if country and country in global_regions else sorted(global_regions.keys())
    for c in countries:
        c_label = localize_legacy_name(c, lang)
        if _matches(query, c, c_label) or c == alias_target:
            results.append(option(c, c_label, country=c, type="country"))
        for p, cities in global_regions.get(c, {}).items():
            p_label = localize_legacy_name(p, lang)
            if _matches(query, p, p_label) or p == alias_target:
                results.append(option(p, p_label, country=c, province=p, type="province"))
            for city in cities:
                city_label = localize_legacy_name(city, lang)
                if _matches(query, city, city_label) or city == alias_target:
                    results.append(option(city, city_label, country=c, province=p, city=city, type="city"))
                if len(results) >= limit:
                    return results
    return results[:limit]


def _matches(query: str, value: str, label: str) -> bool:
    q = query.lower()
    return q in value.lower() or q in label.lower()


# ?? International GeoNames hierarchy for overseas weather locations ??????????
# Countries where users usually expect city-level selection after state/region.
CITY_LEVEL_COUNTRIES = {
    "US", "KR", "JP", "GB", "CA", "AU", "DE", "FR", "IT", "ES", "BR", "IN", "MX", "RU", "TR",
    "TH", "ID", "MY", "PH", "VN", "NL", "SE", "CH", "NZ",
}

# Korean metropolitan/special/self-governing cities are ADM1 and should be
# selectable as terminal regions; adding a duplicate city column creates the
# exact duplicate-Seoul/Daejeon issue the UI must avoid.
DIRECT_ADMIN1 = {
    "KR": {"10", "11", "12", "15", "18", "19", "21", "22"},
    # Tokyo Metropolis is an ADM1-level location in this selector; showing a
    # second same-name city column is confusing for a weather location picker.
    "JP": {"40"},
}

CITY_FEATURE_RANK = {"PPLC": 0, "PPLA": 1, "PPLA2": 2, "PPLA3": 3, "PPLA4": 4, "PPL": 5}
COUNTRY_CODES = {"PCLI", "PCLD", "PCLF", "PCLIX"}
CITY_CODES = tuple(CITY_FEATURE_RANK.keys())
_COUNTRY_DEPTH_CACHE: dict[str, int] = {}


def _display_lang(lang: str | None) -> str:
    # Overseas UI rule: Chinese UIs may use Chinese aliases; all other UI
    # languages use English to avoid mixed Japanese/Korean local names plus English.
    return normalize_lang(lang) if normalize_lang(lang) in {"zh-CN", "zh-TW"} else "en"


def _has_cjk(value: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in value)


def _english_name(conn: sqlite3.Connection, geoname_id: int, fallback: str) -> str:
    return _localized_place_name(conn, geoname_id, "en", fallback)


def _intl_label(conn: sqlite3.Connection, row: sqlite3.Row, lang: str | None) -> str:
    display_lang = _display_lang(lang)
    fallback = row["asciiname"] or row["name"]
    if display_lang in {"zh-CN", "zh-TW"}:
        label = _localized_place_name(conn, row["geoname_id"], display_lang, fallback)
        if _has_cjk(label):
            return label
        return _english_name(conn, row["geoname_id"], fallback)
    return _english_name(conn, row["geoname_id"], fallback)


def _country_row(conn: sqlite3.Connection, country_code: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT * FROM places
        WHERE country_code = ? AND feature_class = 'A' AND feature_code IN ('PCLI','PCLD','PCLF','PCLIX')
        ORDER BY CASE feature_code WHEN 'PCLI' THEN 0 ELSE 1 END
        LIMIT 1
        """,
        (country_code,),
    ).fetchone()


def _country_counts(conn: sqlite3.Connection, country_code: str) -> tuple[int, int]:
    adm1_count = conn.execute(
        "SELECT count(*) AS c FROM places WHERE country_code = ? AND feature_class = 'A' AND feature_code = 'ADM1'",
        (country_code,),
    ).fetchone()["c"]
    city_count = conn.execute(
        f"""
        SELECT count(*) AS c FROM places
        WHERE country_code = ? AND feature_class = 'P' AND feature_code IN ({','.join('?' for _ in CITY_CODES)})
          AND (population >= 50000 OR feature_code IN ('PPLC','PPLA','PPLA2','PPLA3'))
        """,
        (country_code, *CITY_CODES),
    ).fetchone()["c"]
    return int(adm1_count or 0), int(city_count or 0)


def _depth_from_counts(country_code: str, adm1_count: int, city_count: int) -> int:
    if adm1_count <= 0:
        return 1
    if adm1_count <= 1 and city_count <= 1:
        return 1
    if country_code in CITY_LEVEL_COUNTRIES and city_count > 0:
        return 3
    return 2


def country_max_depth(conn: sqlite3.Connection, country_code: str) -> int:
    if country_code in _COUNTRY_DEPTH_CACHE:
        return _COUNTRY_DEPTH_CACHE[country_code]
    adm1_count, city_count = _country_counts(conn, country_code)
    depth = _depth_from_counts(country_code, adm1_count, city_count)
    _COUNTRY_DEPTH_CACHE[country_code] = depth
    return depth


def _is_direct_admin1(country_code: str, admin1_code: str, name: str = "") -> bool:
    if admin1_code in DIRECT_ADMIN1.get(country_code, set()):
        return True
    lowered = (name or "").lower()
    return country_code == "KR" and any(token in lowered for token in ("seoul", "busan", "daegu", "daejeon", "gwangju", "ulsan", "incheon", "sejong"))


def _admin1_has_child_cities(conn: sqlite3.Connection, country_code: str, admin1_code: str) -> bool:
    if _is_direct_admin1(country_code, admin1_code):
        return False
    row = conn.execute(
        f"""
        SELECT 1 FROM places
        WHERE country_code = ? AND admin1_code = ? AND feature_class = 'P' AND feature_code IN ({','.join('?' for _ in CITY_CODES)})
          AND (population >= 50000 OR feature_code IN ('PPLC','PPLA','PPLA2','PPLA3'))
        LIMIT 1
        """,
        (country_code, admin1_code, *CITY_CODES),
    ).fetchone()
    return row is not None


def _place_option(conn: sqlite3.Connection, row: sqlite3.Row, lang: str | None, level: str, **extra: Any) -> dict[str, Any]:
    label = _intl_label(conn, row, lang)
    country_code = row["country_code"] or extra.get("country_code") or ""
    max_depth = int(extra.pop("max_depth", 0) or (country_max_depth(conn, country_code) if country_code else 1))
    payload = option(
        str(row["geoname_id"]),
        label,
        name=label,
        english_name=_english_name(conn, row["geoname_id"], row["asciiname"] or row["name"]),
        geoname_id=row["geoname_id"],
        country_code=country_code,
        admin1_code=row["admin1_code"],
        admin2_code=row["admin2_code"],
        level=level,
        source="geonames",
        latitude=row["latitude"],
        longitude=row["longitude"],
        timezone=row["timezone"],
        feature_class=row["feature_class"],
        feature_code=row["feature_code"],
        population=row["population"],
        max_depth=max_depth,
        **extra,
    )
    return payload


def _country_option(conn: sqlite3.Connection, row: sqlite3.Row, lang: str | None, max_depth: int | None = None) -> dict[str, Any]:
    max_depth = int(max_depth or country_max_depth(conn, row["country_code"]))
    payload = _place_option(conn, row, lang, "country", max_depth=max_depth)
    payload.update(
        value=row["country_code"],
        country_code=row["country_code"],
        has_children=max_depth > 1,
        next_level="province" if max_depth > 1 else "",
        terminal=max_depth <= 1,
        is_direct_admin=False,
    )
    return payload


def geonames_country_options(lang: str | None, exclude: set[str] | None = None) -> list[dict[str, Any]]:
    if not has_geonames_db():
        return []
    exclude = exclude or set()
    with _connect() as conn:
        adm1_counts = {
            row["country_code"]: int(row["c"] or 0)
            for row in conn.execute("SELECT country_code, count(*) AS c FROM places WHERE feature_class = 'A' AND feature_code = 'ADM1' GROUP BY country_code")
        }
        # The country root list only needs enough depth metadata to decide
        # whether a country has a next selector. Avoid a full-table city count
        # here; selected countries still use exact indexed lookups later.
        city_counts = {code: 2 for code in CITY_LEVEL_COUNTRIES}
        rows = conn.execute(
            """
            SELECT * FROM places
            WHERE feature_class = 'A' AND feature_code IN ('PCLI','PCLD','PCLF','PCLIX')
            ORDER BY name COLLATE NOCASE
            """
        ).fetchall()
        items = []
        for row in rows:
            cc = row["country_code"]
            if cc in exclude:
                continue
            depth = _depth_from_counts(cc, adm1_counts.get(cc, 0), city_counts.get(cc, 0))
            _COUNTRY_DEPTH_CACHE[cc] = depth
            items.append(_country_option(conn, row, lang, depth))
        return sorted(items, key=lambda item: item.get("label", "").lower())


def geonames_admin1_options(country_code: str, lang: str | None) -> list[dict[str, Any]]:
    if not has_geonames_db():
        return []
    with _connect() as conn:
        max_depth = country_max_depth(conn, country_code)
        if max_depth <= 1:
            return []
        rows = conn.execute(
            """
            SELECT * FROM places
            WHERE country_code = ? AND feature_class = 'A' AND feature_code = 'ADM1'
            ORDER BY name COLLATE NOCASE
            """,
            (country_code,),
        ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            direct = _is_direct_admin1(country_code, row["admin1_code"] or "", row["name"] or "")
            has_children = max_depth >= 3 and not direct and _admin1_has_child_cities(conn, country_code, row["admin1_code"] or "")
            item = _place_option(conn, row, lang, "province")
            item.update(
                value=row["admin1_code"] or str(row["geoname_id"]),
                has_children=has_children,
                next_level="city" if has_children else "",
                terminal=not has_children,
                is_direct_admin=direct,
            )
            items.append(item)
        return sorted(items, key=lambda item: item.get("label", "").lower())


def geonames_city_options(country_code: str, admin1_code: str, lang: str | None, limit: int = 300) -> list[dict[str, Any]]:
    if not has_geonames_db() or _is_direct_admin1(country_code, admin1_code):
        return []
    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM places
            WHERE country_code = ? AND admin1_code = ? AND feature_class = 'P' AND feature_code IN ({','.join('?' for _ in CITY_CODES)})
              AND (population >= 50000 OR feature_code IN ('PPLC','PPLA','PPLA2','PPLA3'))
            ORDER BY CASE feature_code
                WHEN 'PPLC' THEN 0 WHEN 'PPLA' THEN 1 WHEN 'PPLA2' THEN 2 WHEN 'PPLA3' THEN 3 WHEN 'PPLA4' THEN 4 ELSE 5 END,
                population DESC, name COLLATE NOCASE
            LIMIT ?
            """,
            (country_code, admin1_code, *CITY_CODES, limit),
        ).fetchall()
        seen: set[tuple[str, str]] = set()
        items: list[dict[str, Any]] = []
        for row in rows:
            label = _intl_label(conn, row, lang)
            key = (_norm_text(label), row["admin1_code"] or "")
            if key in seen:
                continue
            seen.add(key)
            item = _place_option(conn, row, lang, "city")
            item.update(value=str(row["geoname_id"]), has_children=False, next_level="", terminal=True, is_direct_admin=False)
            items.append(item)
        return items


def _top_city(conn: sqlite3.Connection, country_code: str, admin1_code: str | None, lang: str | None) -> dict[str, Any] | None:
    params: list[Any] = [country_code]
    admin_sql = ""
    if admin1_code:
        admin_sql = " AND admin1_code = ?"
        params.append(admin1_code)
    rows = conn.execute(
        f"""
        SELECT * FROM places
        WHERE country_code = ? {admin_sql} AND feature_class = 'P' AND feature_code IN ({','.join('?' for _ in CITY_CODES)})
          AND (population >= 50000 OR feature_code IN ('PPLC','PPLA','PPLA2','PPLA3'))
        ORDER BY CASE feature_code
            WHEN 'PPLC' THEN 0 WHEN 'PPLA' THEN 1 WHEN 'PPLA2' THEN 2 WHEN 'PPLA3' THEN 3 WHEN 'PPLA4' THEN 4 ELSE 5 END,
            population DESC, name COLLATE NOCASE
        LIMIT 1
        """,
        (*params, *CITY_CODES),
    ).fetchall()
    if not rows:
        return None
    item = _place_option(conn, rows[0], lang, "city")
    item.update(value=str(rows[0]["geoname_id"]), has_children=False, next_level="", terminal=True)
    return item


def _admin1_by_code(conn: sqlite3.Connection, country_code: str, admin1_code: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM places WHERE country_code = ? AND admin1_code = ? AND feature_class = 'A' AND feature_code = 'ADM1' LIMIT 1",
        (country_code, admin1_code),
    ).fetchone()


def resolve_geonames_location(
    geoname_id: int | None = None,
    country_code: str | None = None,
    admin1_code: str | None = None,
    lang: str | None = None,
) -> dict[str, Any]:
    if not has_geonames_db():
        return {"country": None, "province": None, "city": None, "district": None, "selected": None}
    with _connect() as conn:
        row = None
        if geoname_id:
            row = conn.execute("SELECT * FROM places WHERE geoname_id = ? LIMIT 1", (geoname_id,)).fetchone()
        if row is not None:
            country_code = row["country_code"] or country_code
            admin1_code = row["admin1_code"] or admin1_code
        country = _country_row(conn, country_code or "") if country_code else None
        country_item = _country_option(conn, country, lang) if country else None
        max_depth = country_item.get("max_depth", 1) if country_item else 1
        province_item = None
        city_item = None
        selected = country_item

        if row is not None and row["feature_class"] == "A" and row["feature_code"] in COUNTRY_CODES:
            if max_depth > 1:
                capital = _top_city(conn, country_code or "", None, lang)
                if capital:
                    admin1_code = capital.get("admin1_code") or admin1_code
            selected = country_item

        if admin1_code and max_depth > 1:
            admin1 = _admin1_by_code(conn, country_code or "", admin1_code)
            if admin1:
                direct = _is_direct_admin1(country_code or "", admin1_code, admin1["name"] or "")
                has_children = max_depth >= 3 and not direct and _admin1_has_child_cities(conn, country_code or "", admin1_code)
                province_item = _place_option(conn, admin1, lang, "province")
                province_item.update(
                    value=admin1_code,
                    has_children=has_children,
                    next_level="city" if has_children else "",
                    terminal=not has_children,
                    is_direct_admin=direct,
                )
                selected = province_item

        if row is not None and row["feature_class"] == "P":
            if country_item and country_item.get("max_depth", 1) <= 1:
                selected = country_item
            elif province_item and province_item.get("is_direct_admin"):
                city_item = None
                selected = province_item
            else:
                city_item = _place_option(conn, row, lang, "city")
                city_item.update(value=str(row["geoname_id"]), has_children=False, next_level="", terminal=True)
                selected = city_item
        elif province_item and province_item.get("has_children"):
            city_item = _top_city(conn, country_code or "", admin1_code, lang)
            if city_item:
                selected = city_item

        return {"country": country_item, "province": province_item, "city": city_item, "district": None, "selected": selected}


def enhanced_geonames_search(query: str, lang: str | None, limit: int = 20) -> list[dict[str, Any]]:
    if not has_geonames_db() or not (query or "").strip():
        return []
    lang = normalize_lang(lang)
    qn = _norm_text(query)
    with _connect() as conn:
        rows = _db_search_regions(conn, {}, query, lang, None, limit * 2)
        candidates: list[dict[str, Any]] = []
        for raw in rows:
            geoname_id = raw.get("geoname_id")
            row = conn.execute("SELECT * FROM places WHERE geoname_id = ? LIMIT 1", (geoname_id,)).fetchone() if geoname_id else None
            if row is None or row["country_code"] == "CN":
                continue
            country_depth = country_max_depth(conn, row["country_code"] or "")
            # Small/one-level countries such as Singapore should resolve to the
            # country itself, not a same-name city row.
            if row["feature_class"] == "P" and country_depth <= 1:
                country = _country_row(conn, row["country_code"] or "")
                if not country:
                    continue
                row = country
            # Direct-admin cities (Seoul/Daejeon/Tokyo) should resolve to ADM1.
            if row["feature_class"] == "P" and _is_direct_admin1(row["country_code"] or "", row["admin1_code"] or ""):
                admin1 = _admin1_by_code(conn, row["country_code"] or "", row["admin1_code"] or "")
                if admin1:
                    row = admin1
            if row["feature_class"] == "P":
                level = "city"
            elif row["feature_class"] == "A" and row["feature_code"] in COUNTRY_CODES:
                level = "country"
            elif row["feature_class"] == "A" and row["feature_code"] in {"ADM1", "ADM2", "ADM3"}:
                level = "province"
            else:
                continue
            item = _place_option(conn, row, lang, level)
            item["matched_name"] = raw.get("matched_name") or item.get("label")
            item["type"] = level
            item["weather_name"] = item.get("english_name") or item.get("label")
            if level == "country":
                item.update(_country_option(conn, row, lang))
                dedupe = ("country", item.get("country_code", ""), "")
            elif level == "province":
                direct = _is_direct_admin1(row["country_code"] or "", row["admin1_code"] or "", row["name"] or "")
                has_children = country_max_depth(conn, row["country_code"]) >= 3 and not direct and _admin1_has_child_cities(conn, row["country_code"], row["admin1_code"] or "")
                item.update(value=row["admin1_code"] or str(row["geoname_id"]), has_children=has_children, next_level="city" if has_children else "", terminal=not has_children, is_direct_admin=direct)
                dedupe = ("province", row["country_code"] or "", row["admin1_code"] or str(row["geoname_id"]))
            else:
                item.update(value=str(row["geoname_id"]), has_children=False, next_level="", terminal=True, is_direct_admin=False)
                dedupe = ("city", row["country_code"] or "", str(row["geoname_id"]))
            item["_dedupe"] = dedupe
            label_norm = _norm_text(item.get("label") or "")
            english_norm = _norm_text(item.get("english_name") or "")
            matched_norm = _norm_text(item.get("matched_name") or "")
            item["_name_key"] = _strip_region_suffix(item.get("english_name") or item.get("name") or item.get("label") or item.get("weather_name") or "")
            item["_exact"] = (label_norm == qn or english_norm == qn or matched_norm == qn or _norm_text(row["name"] or "") == qn)
            candidates.append(item)

        # Free-text search should prefer concrete cities over same-name
        # administrative regions: New York City before New York State, and
        # Paris city before Paris Department.
        level_order = {"country": 0, "city": 1, "province": 2}
        candidates.sort(key=lambda item: (0 if item.get("_exact") else 1, level_order.get(item.get("level"), 9), -int(item.get("population") or 0)))

        results: list[dict[str, Any]] = []
        seen: set[tuple[str, str, str]] = set()
        covered_country: set[str] = set()
        covered_direct_admin: set[tuple[str, str]] = set()
        covered_city_names: set[tuple[str, str, str]] = set()
        for item in candidates:
            dedupe = item.pop("_dedupe")
            item.pop("_exact", None)
            name_key = item.pop("_name_key", "")
            cc = item.get("country_code") or ""
            admin1 = item.get("admin1_code") or ""
            city_name_key = (cc, admin1, _norm_text(name_key))
            if item.get("level") == "country":
                if cc in covered_country:
                    continue
                covered_country.add(cc)
            elif cc in covered_country and item.get("max_depth", 1) <= 1:
                continue
            if item.get("level") == "city":
                covered_city_names.add(city_name_key)
            elif item.get("level") == "province" and city_name_key in covered_city_names:
                continue
            if item.get("level") == "province" and item.get("is_direct_admin"):
                covered_direct_admin.add((cc, admin1))
            elif item.get("level") == "city" and (cc, admin1) in covered_direct_admin:
                continue
            if dedupe in seen:
                continue
            seen.add(dedupe)
            results.append(item)
            if len(results) >= limit:
                break
        return results
