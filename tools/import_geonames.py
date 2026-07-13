
"""Build backend/geonames_regions.sqlite from GeoNames dumps.

Usage:
  python tools/import_geonames.py --download
  python tools/import_geonames.py --data-dir backend/data/geonames

Downloads used when --download is passed:
  - allCountries.zip
  - alternateNamesV2.zip
  - admin1CodesASCII.txt
  - admin2Codes.txt

GeoNames data is licensed under CC BY 4.0 and requires attribution.
"""

from __future__ import annotations

import argparse
import csv
import shutil
import sqlite3
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DEFAULT_DATA_DIR = BACKEND / "data" / "geonames"
DEFAULT_DB = BACKEND / "geonames_regions.sqlite"
BASE_URLS = ["https://download.geonames.org/export/dump", "http://download.geonames.org/export/dump"]
FILENAMES = ["allCountries.zip", "alternateNamesV2.zip", "admin1CodesASCII.txt", "admin2Codes.txt"]
KEEP_LANGS = {"zh", "zh-CN", "zh-Hans", "zh-TW", "zh-Hant", "en", "ja", "ko"}
KEEP_FEATURE_CLASSES = {"A", "P"}
KEEP_ADMIN_CODES = {"PCLI", "PCLD", "PCLF", "PCLIX", "ADM1", "ADM2", "ADM3"}


def _download_one(url: str, target: Path) -> None:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "MusicCloud GeoNames importer/1.0"},
    )
    with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as out:
        shutil.copyfileobj(response, out)


def download_files(data_dir: Path) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    for filename in FILENAMES:
        target = data_dir / filename
        if target.exists() and target.stat().st_size > 0:
            print(f"Already exists: {target}")
            continue
        if target.exists():
            target.unlink()
        last_error: Exception | None = None
        for base_url in BASE_URLS:
            url = f"{base_url}/{filename}"
            try:
                print(f"Downloading {url} -> {target}")
                _download_one(url, target)
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                if target.exists():
                    target.unlink()
                print(f"Download failed from {url}: {exc}")
        if last_error is not None:
            raise last_error


def open_text_from_zip(zip_path: Path, inner_name: str):
    zf = zipfile.ZipFile(zip_path)
    return zf.open(inner_name, "r")


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;
        DROP TABLE IF EXISTS places;
        DROP TABLE IF EXISTS alternate_names;
        CREATE TABLE places (
            geoname_id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            asciiname TEXT,
            latitude REAL,
            longitude REAL,
            feature_class TEXT,
            feature_code TEXT,
            country_code TEXT,
            admin1_code TEXT,
            admin2_code TEXT,
            admin3_code TEXT,
            admin4_code TEXT,
            population INTEGER,
            timezone TEXT
        );
        CREATE TABLE alternate_names (
            geoname_id INTEGER NOT NULL,
            lang TEXT NOT NULL,
            name TEXT NOT NULL,
            is_preferred INTEGER DEFAULT 0,
            is_short INTEGER DEFAULT 0,
            is_colloquial INTEGER DEFAULT 0,
            is_historic INTEGER DEFAULT 0
        );
        """
    )
    conn.commit()


def import_all_countries(conn: sqlite3.Connection, data_dir: Path) -> set[int]:
    zip_path = data_dir / "allCountries.zip"
    kept: set[int] = set()
    batch = []
    with open_text_from_zip(zip_path, "allCountries.txt") as raw:
        text = (line.decode("utf-8") for line in raw)
        reader = csv.reader(text, delimiter="\t")
        for row in reader:
            if len(row) < 18:
                continue
            geoname_id = int(row[0])
            feature_class, feature_code = row[6], row[7]
            if feature_class not in KEEP_FEATURE_CLASSES:
                continue
            if feature_class == "A" and feature_code not in KEEP_ADMIN_CODES:
                continue
            population = int(row[14] or 0)
            if feature_class == "P":
                # Keep only major settlements for the weather picker index. The
                # raw GeoNames dump contains many villages/hamlets with zero
                # population, which create false matches in city search.
                if feature_code not in {"PPLC", "PPLA", "PPLA2", "PPLA3"} and population < 50000:
                    continue
            kept.add(geoname_id)
            batch.append((
                geoname_id, row[1], row[2], float(row[4] or 0), float(row[5] or 0), feature_class,
                feature_code, row[8], row[10], row[11], row[12], row[13], population, row[17]
            ))
            if len(batch) >= 10000:
                conn.executemany("INSERT OR REPLACE INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
                conn.commit()
                print(f"Imported places: {len(kept):,}")
                batch.clear()
    if batch:
        conn.executemany("INSERT OR REPLACE INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
        conn.commit()
    return kept


def import_admin_codes(conn: sqlite3.Connection, data_dir: Path, kept: set[int]) -> None:
    for filename, level in [("admin1CodesASCII.txt", "ADM1"), ("admin2Codes.txt", "ADM2")]:
        path = data_dir / filename
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8") as f:
            reader = csv.reader(f, delimiter="\t")
            rows = []
            for row in reader:
                if len(row) < 4 or not row[3].isdigit():
                    continue
                code_parts = row[0].split(".")
                country = code_parts[0]
                admin1 = code_parts[1] if len(code_parts) > 1 else ""
                admin2 = code_parts[2] if len(code_parts) > 2 else ""
                geoname_id = int(row[3])
                kept.add(geoname_id)
                rows.append((geoname_id, row[1], row[2], None, None, "A", level, country, admin1, admin2, "", "", 0, ""))
            conn.executemany("INSERT OR REPLACE INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            conn.commit()
            print(f"Imported {filename}: {len(rows):,}")


def import_alternate_names(conn: sqlite3.Connection, data_dir: Path, kept: set[int]) -> None:
    zip_path = data_dir / "alternateNamesV2.zip"
    batch = []
    count = 0
    with open_text_from_zip(zip_path, "alternateNamesV2.txt") as raw:
        text = (line.decode("utf-8", errors="replace") for line in raw)
        reader = csv.reader(text, delimiter="\t")
        for row in reader:
            if len(row) < 4:
                continue
            if not row[1].isdigit():
                continue
            geoname_id = int(row[1])
            lang = row[2]
            if geoname_id not in kept or lang not in KEEP_LANGS:
                continue
            batch.append((
                geoname_id, lang, row[3],
                int(row[4] or 0) if len(row) > 4 else 0,
                int(row[5] or 0) if len(row) > 5 else 0,
                int(row[6] or 0) if len(row) > 6 else 0,
                int(row[7] or 0) if len(row) > 7 else 0,
            ))
            count += 1
            if len(batch) >= 10000:
                conn.executemany("INSERT INTO alternate_names VALUES (?,?,?,?,?,?,?)", batch)
                conn.commit()
                print(f"Imported alternate names: {count:,}")
                batch.clear()
    if batch:
        conn.executemany("INSERT INTO alternate_names VALUES (?,?,?,?,?,?,?)", batch)
        conn.commit()
    print(f"Imported alternate names total: {count:,}")


def create_indexes(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_places_country_admin ON places(country_code, admin1_code, admin2_code);
        CREATE INDEX IF NOT EXISTS idx_places_feature ON places(feature_class, feature_code);
        CREATE INDEX IF NOT EXISTS idx_places_name ON places(name);
        CREATE INDEX IF NOT EXISTS idx_alt_geoname_lang ON alternate_names(geoname_id, lang);
        CREATE INDEX IF NOT EXISTS idx_alt_name ON alternate_names(name);
        DROP TABLE IF EXISTS region_search;
        CREATE VIRTUAL TABLE region_search USING fts5(name, geoname_id UNINDEXED);
        INSERT INTO region_search(name, geoname_id)
            SELECT name, geoname_id FROM places WHERE name IS NOT NULL AND name <> '';
        INSERT INTO region_search(name, geoname_id)
            SELECT name, geoname_id FROM alternate_names WHERE name IS NOT NULL AND name <> '';
        """
    )
    conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true", help="Download GeoNames dumps before importing")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()

    if args.download:
        download_files(args.data_dir)

    args.db.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.db) as conn:
        init_schema(conn)
        kept = import_all_countries(conn, args.data_dir)
        import_admin_codes(conn, args.data_dir, kept)
        import_alternate_names(conn, args.data_dir, kept)
        create_indexes(conn)
    print(f"GeoNames region DB ready: {args.db}")
    print("Attribution required: GeoNames geographical database (https://www.geonames.org/)")


if __name__ == "__main__":
    main()
