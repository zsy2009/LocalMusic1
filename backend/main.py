import os
import sys
import subprocess
import uuid
import json
import shutil
import mimetypes
import re
from datetime import datetime, timedelta
from collections import defaultdict
from contextlib import asynccontextmanager

from dotenv import load_dotenv
import httpx
import requests
from apscheduler.schedulers.background import BackgroundScheduler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
ENV_FILE = os.path.join(BASE_DIR, ".env")
COVERS_DIR = os.path.join(BASE_DIR, "covers")
AVATARS_DIR = os.path.join(BASE_DIR, "avatars")
CUSTOM_COVERS_DIR = os.path.join(BASE_DIR, "custom_covers")
CUSTOM_LYRICS_DIR = os.path.join(BASE_DIR, "custom_lyrics")
TICKET_ATTACHMENTS_DIR = os.path.join(BASE_DIR, "ticket_attachments")
ANNOUNCEMENT_ATTACHMENTS_DIR = os.path.join(BASE_DIR, "announcement_attachments")
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")

if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# ── Load .env file at startup ───────────────────────────────────────
load_dotenv(ENV_FILE)
from auth import verify_password, create_access_token, get_password_hash
from fastapi import FastAPI, HTTPException, Request, Depends, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from database import get_db_connection
from lyrics import get_or_fetch_lyrics
from scanner import scan_and_sync
from auth import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)

from amap_regions import (
    AMapError,
    CHINA_ADCODE,
    CHINA_NAME,
    amap_child_options,
    china_province_options,
    china_root_option,
    get_amap_weather,
    resolve_amap_location,
    search_amap_with_context,
)
from geonames_regions import (
    geonames_admin1_options,
    geonames_city_options,
    geonames_country_options,
    has_geonames_db,
    search_regions as search_geonames_regions,
)

# ── FastAPI app (with lifespan for background scheduler) ─────────────

@asynccontextmanager
async def lifespan(application: FastAPI):
    # Startup: schedule weekly auto-scan at Sunday 3:00 AM
    scheduler = BackgroundScheduler()
    scheduler.add_job(scan_and_sync, "cron", day_of_week="sun", hour=3, minute=0)
    scheduler.start()
    print("Background scheduler started — music library scan runs every Sunday 3:00 AM")
    yield
    # Shutdown
    scheduler.shutdown()

app = FastAPI(title="MusicCloud API", version="1.0.0", lifespan=lifespan)

# ── API keys loaded from .env ───────────────────────────────────────
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")
AMAP_KEY = os.getenv("AMAP_KEY")

if not WEATHER_API_KEY:
    raise ValueError("安全警告: WEATHER_API_KEY 未在 .env 文件中配置！")
if not AMAP_KEY:
    raise ValueError("安全警告: AMAP_KEY 未在 .env 文件中配置！")

# ── Database schema migration (SQL‑Server specific) ────────────────────

def init_db_schema():
    """Ensure Users table has Country / Province / City columns.

    Uses SQL Server T‑SQL ``COL_LENGTH`` to safely check column
    existence before altering; no‑op on subsequent runs.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Country
        cursor.execute("""
            IF COL_LENGTH('Users', 'Country') IS NULL
            BEGIN
                ALTER TABLE Users ADD Country NVARCHAR(100) DEFAULT '';
            END
        """)

        # Province
        cursor.execute("""
            IF COL_LENGTH('Users', 'Province') IS NULL
            BEGIN
                ALTER TABLE Users ADD Province NVARCHAR(100) DEFAULT '';
            END
        """)

        # City
        cursor.execute("""
            IF COL_LENGTH('Users', 'City') IS NULL
            BEGIN
                ALTER TABLE Users ADD City NVARCHAR(100) DEFAULT '';
            END
        """)

        # Last played song for cross-device resume
        cursor.execute("""
            IF COL_LENGTH('Users', 'LastSongID') IS NULL
            BEGIN
                ALTER TABLE Users ADD LastSongID INT NULL;
            END
        """)

        # Visualizer preference for low-performance devices.
        cursor.execute("""
            IF COL_LENGTH('Users', 'VisualizerEnabled') IS NULL
            BEGIN
                ALTER TABLE Users ADD VisualizerEnabled BIT NOT NULL DEFAULT 1;
            END
        """)

        # Weather location metadata for AMap/GeoNames-backed selectors.
        for col_name, col_type in [
            ("District", "NVARCHAR(100) NULL"),
            ("CountryAdcode", "NVARCHAR(20) NULL"),
            ("ProvinceAdcode", "NVARCHAR(20) NULL"),
            ("CityAdcode", "NVARCHAR(20) NULL"),
            ("DistrictAdcode", "NVARCHAR(20) NULL"),
            ("LocationAdcode", "NVARCHAR(20) NULL"),
            ("LocationName", "NVARCHAR(100) NULL"),
            ("LocationLevel", "NVARCHAR(20) NULL"),
            ("LocationCenter", "NVARCHAR(50) NULL"),
            ("LocationSource", "NVARCHAR(20) NULL"),
            ("LocationCountryCode", "NVARCHAR(10) NULL"),
            ("LocationGeonameID", "NVARCHAR(30) NULL"),
            ("LocationLatitude", "FLOAT NULL"),
            ("LocationLongitude", "FLOAT NULL"),
            ("LocationTimezone", "NVARCHAR(100) NULL"),
        ]:
            cursor.execute(f"""
                IF COL_LENGTH('Users', '{col_name}') IS NULL
                BEGIN
                    ALTER TABLE Users ADD {col_name} {col_type};
                END
            """)

        # Support ticket tables (idempotent; attachments are stored on disk).
        cursor.execute("""
            IF OBJECT_ID('SupportTickets', 'U') IS NULL
            BEGIN
                CREATE TABLE SupportTickets (
                    TicketID INT IDENTITY(1,1) PRIMARY KEY,
                    UserID INT NOT NULL,
                    Title NVARCHAR(200) NOT NULL,
                    Status NVARCHAR(30) NOT NULL DEFAULT 'pending',
                    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    ClosedAt DATETIME2 NULL,
                    CONSTRAINT FK_SupportTickets_Users FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
                );
                CREATE INDEX IX_SupportTickets_User_Updated ON SupportTickets(UserID, UpdatedAt DESC);
                CREATE INDEX IX_SupportTickets_Status_Updated ON SupportTickets(Status, UpdatedAt DESC);
            END
        """)
        cursor.execute("""
            IF OBJECT_ID('SupportTicketMessages', 'U') IS NULL
            BEGIN
                CREATE TABLE SupportTicketMessages (
                    MessageID INT IDENTITY(1,1) PRIMARY KEY,
                    TicketID INT NOT NULL,
                    UserID INT NOT NULL,
                    AuthorRole NVARCHAR(20) NOT NULL,
                    Body NVARCHAR(MAX) NULL,
                    BodyFormat NVARCHAR(20) NOT NULL DEFAULT 'markdown',
                    Result NVARCHAR(30) NULL,
                    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    CONSTRAINT FK_SupportTicketMessages_Tickets FOREIGN KEY (TicketID) REFERENCES SupportTickets(TicketID) ON DELETE CASCADE,
                    CONSTRAINT FK_SupportTicketMessages_Users FOREIGN KEY (UserID) REFERENCES Users(UserID)
                );
                CREATE INDEX IX_SupportTicketMessages_Ticket_Created ON SupportTicketMessages(TicketID, CreatedAt ASC);
            END
        """)
        cursor.execute("""
            IF OBJECT_ID('SupportTicketAttachments', 'U') IS NULL
            BEGIN
                CREATE TABLE SupportTicketAttachments (
                    AttachmentID INT IDENTITY(1,1) PRIMARY KEY,
                    TicketID INT NOT NULL,
                    MessageID INT NOT NULL,
                    UserID INT NOT NULL,
                    OriginalName NVARCHAR(255) NOT NULL,
                    StoredName NVARCHAR(255) NOT NULL,
                    ContentType NVARCHAR(200) NULL,
                    FileSize BIGINT NOT NULL,
                    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    CONSTRAINT FK_SupportTicketAttachments_Tickets FOREIGN KEY (TicketID) REFERENCES SupportTickets(TicketID) ON DELETE CASCADE,
                    CONSTRAINT FK_SupportTicketAttachments_Messages FOREIGN KEY (MessageID) REFERENCES SupportTicketMessages(MessageID),
                    CONSTRAINT FK_SupportTicketAttachments_Users FOREIGN KEY (UserID) REFERENCES Users(UserID)
                );
                CREATE INDEX IX_SupportTicketAttachments_Message ON SupportTicketAttachments(MessageID);
            END
        """)

        # Announcement tables (idempotent; attachments are stored on disk).
        cursor.execute("""
            IF OBJECT_ID('Announcements', 'U') IS NULL
            BEGIN
                CREATE TABLE Announcements (
                    AnnouncementID INT IDENTITY(1,1) PRIMARY KEY,
                    SenderUserID INT NULL,
                    TargetUserID INT NULL,
                    Title NVARCHAR(200) NOT NULL,
                    Body NVARCHAR(MAX) NULL,
                    BodyFormat NVARCHAR(20) NOT NULL DEFAULT 'markdown',
                    IsPinned BIT NOT NULL DEFAULT 0,
                    IsDeleted BIT NOT NULL DEFAULT 0,
                    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    DeletedAt DATETIME2 NULL
                );
                CREATE INDEX IX_Announcements_Visible_Pin_Time ON Announcements(IsDeleted, IsPinned, UpdatedAt DESC);
                CREATE INDEX IX_Announcements_Target_Pin_Time ON Announcements(IsDeleted, TargetUserID, IsPinned, UpdatedAt DESC);
            END
        """)
        cursor.execute("""
            IF OBJECT_ID('AnnouncementAttachments', 'U') IS NULL
            BEGIN
                CREATE TABLE AnnouncementAttachments (
                    AttachmentID INT IDENTITY(1,1) PRIMARY KEY,
                    AnnouncementID INT NOT NULL,
                    OriginalName NVARCHAR(255) NOT NULL,
                    StoredName NVARCHAR(255) NOT NULL,
                    ContentType NVARCHAR(200) NULL,
                    FileSize BIGINT NOT NULL,
                    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
                );
                CREATE INDEX IX_AnnouncementAttachments_Announcement ON AnnouncementAttachments(AnnouncementID);
            END
        """)


        # Abuse/BAN tables (idempotent; used for account, IP, and scoped feature bans).
        cursor.execute("""
            IF OBJECT_ID('AbuseBans', 'U') IS NULL
            BEGIN
                CREATE TABLE AbuseBans (
                    BanID INT IDENTITY(1,1) PRIMARY KEY,
                    SubjectType NVARCHAR(30) NOT NULL,
                    SubjectValue NVARCHAR(200) NOT NULL,
                    Scope NVARCHAR(80) NOT NULL DEFAULT 'all',
                    Reason NVARCHAR(500) NULL,
                    Evidence NVARCHAR(MAX) NULL,
                    BannedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    BannedUntil DATETIME2 NULL,
                    CreatedByUserID INT NULL,
                    CreatedByType NVARCHAR(30) NOT NULL DEFAULT 'admin',
                    IsActive BIT NOT NULL DEFAULT 1,
                    RevokedAt DATETIME2 NULL,
                    RevokedByUserID INT NULL,
                    RevokeReason NVARCHAR(500) NULL,
                    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
                );
                CREATE INDEX IX_AbuseBans_Subject_Scope_Active ON AbuseBans(SubjectType, SubjectValue, Scope, IsActive, BannedUntil);
                CREATE INDEX IX_AbuseBans_Active_Until ON AbuseBans(IsActive, BannedUntil);
            END
        """)
        cursor.execute("""
            IF OBJECT_ID('AbuseEvents', 'U') IS NULL
            BEGIN
                CREATE TABLE AbuseEvents (
                    EventID BIGINT IDENTITY(1,1) PRIMARY KEY,
                    UserID INT NULL,
                    Username NVARCHAR(50) NULL,
                    IP NVARCHAR(80) NULL,
                    Action NVARCHAR(80) NOT NULL,
                    Scope NVARCHAR(80) NULL,
                    TargetType NVARCHAR(80) NULL,
                    TargetID NVARCHAR(120) NULL,
                    Severity NVARCHAR(20) NOT NULL DEFAULT 'info',
                    Message NVARCHAR(500) NULL,
                    ExtraJson NVARCHAR(MAX) NULL,
                    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
                );
                CREATE INDEX IX_AbuseEvents_User_Time ON AbuseEvents(UserID, CreatedAt DESC);
                CREATE INDEX IX_AbuseEvents_IP_Time ON AbuseEvents(IP, CreatedAt DESC);
                CREATE INDEX IX_AbuseEvents_Action_Time ON AbuseEvents(Action, CreatedAt DESC);
            END
        """)

        # Support ticket constraints/indexes are also created idempotently for databases
        # that already created the tables before these hardening rules were added.
        cursor.execute("""
            IF OBJECT_ID('FK_SupportTickets_Users', 'F') IS NULL
            BEGIN
                ALTER TABLE SupportTickets WITH CHECK ADD CONSTRAINT FK_SupportTickets_Users
                FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE;
            END
        """)
        cursor.execute("""
            IF OBJECT_ID('FK_SupportTicketMessages_Tickets', 'F') IS NULL
            BEGIN
                ALTER TABLE SupportTicketMessages WITH CHECK ADD CONSTRAINT FK_SupportTicketMessages_Tickets
                FOREIGN KEY (TicketID) REFERENCES SupportTickets(TicketID) ON DELETE CASCADE;
            END
        """)
        cursor.execute("""
            IF OBJECT_ID('FK_SupportTicketMessages_Users', 'F') IS NULL
            BEGIN
                ALTER TABLE SupportTicketMessages WITH CHECK ADD CONSTRAINT FK_SupportTicketMessages_Users
                FOREIGN KEY (UserID) REFERENCES Users(UserID);
            END
        """)
        cursor.execute("""
            IF OBJECT_ID('FK_SupportTicketAttachments_Tickets', 'F') IS NULL
            BEGIN
                ALTER TABLE SupportTicketAttachments WITH CHECK ADD CONSTRAINT FK_SupportTicketAttachments_Tickets
                FOREIGN KEY (TicketID) REFERENCES SupportTickets(TicketID) ON DELETE CASCADE;
            END
        """)
        cursor.execute("""
            IF OBJECT_ID('FK_SupportTicketAttachments_Messages', 'F') IS NULL
            BEGIN
                ALTER TABLE SupportTicketAttachments WITH CHECK ADD CONSTRAINT FK_SupportTicketAttachments_Messages
                FOREIGN KEY (MessageID) REFERENCES SupportTicketMessages(MessageID);
            END
        """)
        cursor.execute("""
            IF OBJECT_ID('FK_SupportTicketAttachments_Users', 'F') IS NULL
            BEGIN
                ALTER TABLE SupportTicketAttachments WITH CHECK ADD CONSTRAINT FK_SupportTicketAttachments_Users
                FOREIGN KEY (UserID) REFERENCES Users(UserID);
            END
        """)
        cursor.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SupportTickets_User_Updated' AND object_id = OBJECT_ID('SupportTickets'))
            BEGIN
                CREATE INDEX IX_SupportTickets_User_Updated ON SupportTickets(UserID, UpdatedAt DESC);
            END
        """)
        cursor.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SupportTickets_Status_Updated' AND object_id = OBJECT_ID('SupportTickets'))
            BEGIN
                CREATE INDEX IX_SupportTickets_Status_Updated ON SupportTickets(Status, UpdatedAt DESC);
            END
        """)
        cursor.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SupportTicketMessages_Ticket_Created' AND object_id = OBJECT_ID('SupportTicketMessages'))
            BEGIN
                CREATE INDEX IX_SupportTicketMessages_Ticket_Created ON SupportTicketMessages(TicketID, CreatedAt ASC);
            END
        """)
        cursor.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SupportTicketAttachments_Message' AND object_id = OBJECT_ID('SupportTicketAttachments'))
            BEGIN
                CREATE INDEX IX_SupportTicketAttachments_Message ON SupportTicketAttachments(MessageID);
            END
        """)

        cursor.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Announcements_Visible_Pin_Time' AND object_id = OBJECT_ID('Announcements'))
            BEGIN
                CREATE INDEX IX_Announcements_Visible_Pin_Time ON Announcements(IsDeleted, IsPinned, UpdatedAt DESC);
            END
        """)
        cursor.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Announcements_Target_Pin_Time' AND object_id = OBJECT_ID('Announcements'))
            BEGIN
                CREATE INDEX IX_Announcements_Target_Pin_Time ON Announcements(IsDeleted, TargetUserID, IsPinned, UpdatedAt DESC);
            END
        """)
        cursor.execute("""
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AnnouncementAttachments_Announcement' AND object_id = OBJECT_ID('AnnouncementAttachments'))
            BEGIN
                CREATE INDEX IX_AnnouncementAttachments_Announcement ON AnnouncementAttachments(AnnouncementID);
            END
        """)

        conn.commit()
        print("Database schema migration checked — Country/Province/City/LastSongID columns ready.")
    except Exception as e:
        print(f"init_db_schema failed: {e}")
    finally:
        try:
            cursor.close()
            conn.close()
        except Exception:
            pass

init_db_schema()

# ── Load global regions data at startup ─────────────────────────────
REGIONS_FILE = os.path.join(BASE_DIR, "global_regions.json")
with open(REGIONS_FILE, "r", encoding="utf-8") as f:
    GLOBAL_REGIONS = json.load(f)
print(f"Loaded {len(GLOBAL_REGIONS)} countries from global_regions.json")


REGION_TRANSLATION_CACHE_FILE = os.path.join(BASE_DIR, "data", "region_translation_cache.json")
REGION_TRANSLATION_API_URL = "https://uapis.cn/api/v1/translate/text"
REGION_TRANSLATION_TIMEOUT_SECONDS = 6.0
REGION_TRANSLATION_MAX_CHARS = 2800
_REGION_TRANSLATION_CACHE: dict[str, str] | None = None
_REGION_TRANSLATION_DIRTY = False
_REGION_CHINESE_SUFFIXES = ("\u7279\u522b\u884c\u653f\u533a", "\u81ea\u6cbb\u533a", "\u81ea\u6cbb\u5dde", "\u5730\u533a", "\u65b0\u533a", "\u7701", "\u5e02", "\u533a", "\u53bf", "\u65d7", "\u90fd", "\u5e9c")
_REGION_ENGLISH_SUFFIX_RE = re.compile(r"\b(city|province|district|county|prefecture|region|state|municipality|metropolis)\b", re.IGNORECASE)


def _region_display_lang(lang: str | None) -> str:
    # User requirement: every non-Simplified-Chinese UI language shows English place names.
    return "zh-CN" if (lang or "zh-CN") == "zh-CN" else "en"


def _has_cjk(value: str | None) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in str(value or ""))


def _load_region_translation_cache() -> dict[str, str]:
    global _REGION_TRANSLATION_CACHE
    if _REGION_TRANSLATION_CACHE is not None:
        return _REGION_TRANSLATION_CACHE
    try:
        with open(REGION_TRANSLATION_CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        _REGION_TRANSLATION_CACHE = data if isinstance(data, dict) else {}
    except Exception:
        _REGION_TRANSLATION_CACHE = {}
    return _REGION_TRANSLATION_CACHE


def _save_region_translation_cache() -> None:
    global _REGION_TRANSLATION_DIRTY
    if not _REGION_TRANSLATION_DIRTY or _REGION_TRANSLATION_CACHE is None:
        return
    try:
        os.makedirs(os.path.dirname(REGION_TRANSLATION_CACHE_FILE), exist_ok=True)
        tmp = REGION_TRANSLATION_CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_REGION_TRANSLATION_CACHE, f, ensure_ascii=False, indent=2, sort_keys=True)
        os.replace(tmp, REGION_TRANSLATION_CACHE_FILE)
        _REGION_TRANSLATION_DIRTY = False
    except Exception as exc:
        print(f"Region translation cache save failed: {exc}")


def _uapi_translation_headers() -> dict[str, str]:
    headers = {"User-Agent": "MusicCloud/region-translation"}
    api_key = os.getenv("UAPI_KEY") or os.getenv("UAPI_API_KEY") or ""
    if api_key:
        headers["uapikey"] = api_key
    return headers


def _translation_chunks(names: list[str]) -> list[list[str]]:
    chunks: list[list[str]] = []
    current: list[str] = []
    current_len = 0
    for name in names:
        extra = len(name) + (1 if current else 0)
        if current and current_len + extra > REGION_TRANSLATION_MAX_CHARS:
            chunks.append(current)
            current = []
            current_len = 0
        current.append(name)
        current_len += extra
    if current:
        chunks.append(current)
    return chunks


def _uapi_target_lang(lang: str | None) -> str:
    mapping = {"zh-CN": "zh", "zh-TW": "zh-TW", "en": "en", "ja": "ja", "ko": "ko"}
    return mapping.get(lang or "zh-CN", "en")


def _translate_region_names(names: list[str], lang: str | None, strict: bool = False) -> dict[str, str]:
    """Translate display labels through UAPI. Strict callers get an error instead of native fallback."""
    global _REGION_TRANSLATION_DIRTY
    target_lang = _uapi_target_lang(lang)
    cache = _load_region_translation_cache()
    ordered: list[str] = []
    for raw in names:
        name = str(raw or "").strip()
        if name and name not in ordered:
            ordered.append(name)
    missing = [name for name in ordered if cache.get(f"{target_lang}:{name}") is None]
    for chunk in _translation_chunks(missing):
        try:
            resp = httpx.post(
                REGION_TRANSLATION_API_URL,
                params={"to_lang": target_lang},
                json={"text": "\n".join(chunk)},
                headers=_uapi_translation_headers(),
                timeout=REGION_TRANSLATION_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            data = resp.json()
            translated = str(data.get("translate") or "")
            translated_lines = [line.strip() for line in translated.splitlines()]
            if len(translated_lines) == len(chunk):
                for source, target in zip(chunk, translated_lines):
                    if target:
                        cache[f"{target_lang}:{source}"] = target
                        _REGION_TRANSLATION_DIRTY = True
            elif len(chunk) == 1 and translated.strip():
                cache[f"{target_lang}:{chunk[0]}"] = translated.strip()
                _REGION_TRANSLATION_DIRTY = True
        except Exception as exc:
            message = f"Region translation failed for lang={target_lang}, count={len(chunk)}: {exc}"
            print(message)
            if strict:
                raise RuntimeError(message) from exc
            break
    if strict:
        unresolved = [name for name in ordered if cache.get(f"{target_lang}:{name}") is None]
        if unresolved:
            raise RuntimeError(f"Region translation incomplete for lang={target_lang}: {unresolved[:10]}")
    _save_region_translation_cache()
    return {name: (cache.get(f"{target_lang}:{name}") or name) for name in ordered}


def _cached_region_translation(name: str, lang: str | None) -> str:
    text = str(name or "").strip()
    if not text:
        return ""
    target_lang = _uapi_target_lang(lang)
    return _load_region_translation_cache().get(f"{target_lang}:{text}") or text


def _cached_region_translations(names: list[str], lang: str | None) -> dict[str, str]:
    return {str(name or "").strip(): _cached_region_translation(str(name or "").strip(), lang) for name in names if str(name or "").strip()}


def _display_region_option(payload: dict, lang: str | None = None) -> dict:
    item = dict(payload)
    native = _clean_region_value(
        item.get("native_name")
        or item.get("weather_name")
        or item.get("city")
        or item.get("name")
        or item.get("label")
        or item.get("value")
    )
    if native:
        item["native_name"] = native
    if _region_display_lang(lang) != "en":
        item["label"] = item.get("label") or native or item.get("value") or ""
        item["name"] = native or item.get("name") or item["label"]
        return item
    if _has_cjk(native):
        english = _cached_region_translation(native, lang)
    else:
        english = item.get("english_name") or item.get("label_en") or item.get("label") or native
    if english:
        item["label"] = english
        item["label_en"] = english
    if native:
        item["name"] = native
    return item


def _display_region_options(items: list[dict], lang: str | None = None) -> list[dict]:
    if _region_display_lang(lang) == "en":
        names = []
        for item in items:
            native = _clean_region_value(item.get("native_name") or item.get("weather_name") or item.get("city") or item.get("name") or item.get("label") or item.get("value"))
            if native and _has_cjk(native):
                names.append(native)
        # Do not call UAPI here. Region option loading must stay fast even on a
        # cold translation cache; the frontend asks /api/regions/translate after
        # options are visible.
        _cached_region_translations(names, lang)
    return [_display_region_option(item, lang) for item in items]


def _normalize_region_identity_text(value: str | None) -> str:
    text = str(value or "").strip().lower()
    text = _REGION_ENGLISH_SUFFIX_RE.sub("", text)
    text = re.sub(r"[\s,?/\\?'?`\-_.]+", "", text)
    changed = True
    while changed and text:
        changed = False
        for suffix in _REGION_CHINESE_SUFFIXES:
            if text.endswith(suffix.lower()) and len(text) > len(suffix):
                text = text[: -len(suffix)]
                changed = True
    return text


def _region_search_identity(item: dict) -> tuple[str, str, str]:
    country_code = str(item.get("country_code") or "")
    country = str(item.get("country_label") or item.get("country") or country_code or "")
    if country_code in {"CN", CHINA_ADCODE} or country in {"CN", "China", CHINA_NAME, CHINA_ADCODE}:
        country = "CN"
    raw_place = item.get("city") or item.get("native_name") or item.get("weather_name") or item.get("name") or item.get("label") or item.get("value") or ""
    if country == "CN":
        # AMap and GeoNames do not share adcodes, so China dedupe is name-based.
        return ("CN", "", _normalize_region_identity_text(raw_place))

    # For non-China results, use English display aliases when available. This
    # collapses script variants such as ?? / ?? / Tokyo while keeping countries
    # separate, so Paris, France and Paris, United States remain distinct.
    place = item.get("label_en") or item.get("english_name") or item.get("label") or raw_place
    if _has_cjk(str(place)):
        place = _translate_region_names([str(place)], "en").get(str(place), str(place))
    if _has_cjk(country):
        country = _translate_region_names([country], "en").get(country, country)
    return (_normalize_region_identity_text(country), "", _normalize_region_identity_text(str(place)))


def _dedupe_region_search_results(items: list[dict], limit: int) -> list[dict]:
    results = []
    seen: set[tuple[str, str, str]] = set()
    for item in items:
        key = _region_search_identity(item)
        if not key[2] or key in seen:
            continue
        seen.add(key)
        results.append(item)
        if len(results) >= limit:
            break
    return results

def _resolve_geonames_country_code(country: str | None) -> str | None:
    value = _clean_region_value(country)
    if not value or not has_geonames_db():
        return None
    if len(value) == 2 and value.isascii() and value.isalpha():
        return value.upper()
    try:
        for item in geonames_country_options("zh-CN"):
            candidates = {
                _clean_region_value(item.get("value")),
                _clean_region_value(item.get("label")),
                _clean_region_value(item.get("name")),
                _clean_region_value(item.get("native_name")),
                _clean_region_value(item.get("english_name")),
                _clean_region_value(item.get("country_code")),
            }
            if value in candidates:
                return _clean_region_value(item.get("country_code")) or _clean_region_value(item.get("value"))
    except Exception as exc:
        print(f"GeoNames country resolve failed: {exc}")
    return None


def _geonames_fallback_region_options(country: str | None, province: str | None, lang: str | None) -> list[dict]:
    code = _resolve_geonames_country_code(country)
    if not code:
        return []
    try:
        if not province:
            return _display_region_options(geonames_admin1_options(code, lang), lang)
        return _display_region_options(geonames_city_options(code, province, lang), lang)
    except Exception as exc:
        print(f"GeoNames region fallback failed: {exc}")
        return []

# ── Static files mount ────────────────────────────────────────────
os.makedirs(COVERS_DIR, exist_ok=True)
app.mount("/covers", StaticFiles(directory=COVERS_DIR), name="covers")

os.makedirs(AVATARS_DIR, exist_ok=True)
app.mount("/avatars", StaticFiles(directory=AVATARS_DIR), name="avatars")

os.makedirs(CUSTOM_COVERS_DIR, exist_ok=True)
app.mount("/custom-covers", StaticFiles(directory=CUSTOM_COVERS_DIR), name="custom-covers")
os.makedirs(CUSTOM_LYRICS_DIR, exist_ok=True)
os.makedirs(TICKET_ATTACHMENTS_DIR, exist_ok=True)
os.makedirs(ANNOUNCEMENT_ATTACHMENTS_DIR, exist_ok=True)

# ── CORS middleware ────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],                   # allow all origins in dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def infer_ban_scope_for_request(method: str, path: str) -> str:
    method = (method or "GET").upper()
    if path == "/api/auth/login":
        return "auth.login"
    if path == "/api/auth/refresh":
        return "auth.refresh"
    if path.startswith("/api/stream/") or path.startswith("/api/song_info/"):
        return "stream"
    if path == "/api/tickets" and method == "POST":
        return "ticket.create"
    if path.startswith("/api/tickets/") and path.endswith("/messages") and method == "POST":
        return "ticket.reply"
    if path == "/api/users/me/avatar" and method == "POST":
        return "avatar.upload"
    if path.startswith("/api/stats/") and method == "POST":
        return "stats.write"
    if path.startswith("/api/playlists") and method in {"POST", "PUT", "DELETE"}:
        return "playlist.write"
    if path.startswith("/api/favorites/") and method == "POST":
        return "favorite.write"
    if path == "/api/weather":
        return "weather"
    if path.startswith("/api/regions/search"):
        return "region.search"
    return "all"


@app.middleware("http")
async def abuse_ip_ban_middleware(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)

    client_ip = request.client.host if request.client else ""
    if not client_ip:
        return await call_next(request)

    scope = infer_ban_scope_for_request(request.method, path)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        ban = fetch_active_ban(cursor, "ip", client_ip, scope)
        if ban is not None:
            detail = {
                "message": "当前来源已被限制访问",
                "scope": ban.get("scope") or scope,
                "reason": ban.get("reason") or "存在异常访问行为",
                "banned_until": serialize_datetime(ban.get("banned_until")),
            }
            return JSONResponse(status_code=403, content={"detail": detail})
    except Exception as exc:
        # Do not make public API availability depend on the optional abuse table check.
        print(f"abuse_ip_ban_middleware skipped: {exc}")
    finally:
        try:
            if cursor is not None:
                cursor.close()
            if conn is not None:
                conn.close()
        except Exception:
            pass
    return await call_next(request)

# ── Auth header extractor ──────────────────────────────────────────
security = HTTPBearer(auto_error=False)

CHUNK_SIZE = 1 * 1024 * 1024  # 1 MB default streaming chunk


# ────────────────────────────────────────────────────────────────────
#  Pydantic models
# ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ProfileUpdate(BaseModel):
    nickname: str


class PasswordUpdate(BaseModel):
    old_password: str
    new_password: str


class AdminPasswordReset(BaseModel):
    new_password: str


class AdminBanRequest(BaseModel):
    scope: str = "all"
    reason: str
    hours: int | None = None
    permanent: bool = False


class AdminBanRevokeRequest(BaseModel):
    reason: str = "manual revoke"


class UserCreate(BaseModel):
    username: str
    password: str
    nickname: str
    role: str = "User"


class PlaylistCreate(BaseModel):
    name: str


class PlaylistSongAdd(BaseModel):
    song_id: int


class LastPlayedUpdate(BaseModel):
    song_id: int


class VisualizerPreferenceUpdate(BaseModel):
    enabled: bool


class AnnouncementPinUpdate(BaseModel):
    is_pinned: bool


class LocationUpdate(BaseModel):
    country: str
    province: str
    city: str
    district: str | None = None
    country_adcode: str | None = None
    province_adcode: str | None = None
    city_adcode: str | None = None
    district_adcode: str | None = None
    location_adcode: str | None = None
    location_name: str | None = None
    location_level: str | None = None
    location_center: str | None = None
    location_source: str | None = None
    location_country_code: str | None = None
    location_geoname_id: str | None = None
    location_latitude: float | None = None
    location_longitude: float | None = None
    location_timezone: str | None = None



CUSTOM_COVER_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif")
CUSTOM_COVER_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
CUSTOM_LYRICS_MAX_BYTES = 512 * 1024
CUSTOM_COVER_MAX_BYTES = 10 * 1024 * 1024
AVATAR_MAX_BYTES = 5 * 1024 * 1024
AVATAR_ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
TICKET_USER_MAX_ATTACHMENTS = 9
TICKET_USER_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
TICKET_BODY_MAX_BYTES = 1024 * 1024
TICKET_ALLOWED_EXTS = {
    ".jpg", ".jpeg", ".png", ".webp", ".gif",
    ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus",
    ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv",
}
TICKET_ALLOWED_CONTENT_PREFIXES = ("image/", "audio/", "video/")
TICKET_BLOCKED_CONTENT_TYPES = {"image/svg+xml", "text/html", "application/xhtml+xml"}
ANNOUNCEMENT_MAX_ATTACHMENTS = 10
ANNOUNCEMENT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
ANNOUNCEMENT_BODY_MAX_BYTES = 2 * 1024 * 1024
ANNOUNCEMENT_ALLOWED_EXTS = TICKET_ALLOWED_EXTS | {
    ".pdf", ".txt", ".md", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".csv", ".json", ".zip", ".rar", ".7z",
}
ANNOUNCEMENT_BLOCKED_EXTS = {".svg", ".html", ".htm", ".exe", ".bat", ".cmd", ".ps1", ".js", ".vbs", ".msi"}
ANNOUNCEMENT_BLOCKED_CONTENT_TYPES = TICKET_BLOCKED_CONTENT_TYPES | {"application/x-msdownload", "application/x-msi", "application/javascript", "text/javascript"}
TICKET_STATUS_LABELS = {
    "pending": "\u5f85\u5904\u7406",
    "in_progress": "\u6682\u65e0\u6cd5\u5904\u7406\uff0c\u8ddf\u8fdb\u4e2d",
    "resolved": "\u5df2\u5904\u7406",
    "rejected": "\u5df2\u62d2\u7edd",
}
TICKET_RESULT_TO_STATUS = {
    "processed": "resolved",
    "rejected": "rejected",
    "following": "in_progress",
}
TICKET_RESULT_LABELS = {
    "processed": "\u5df2\u5904\u7406",
    "rejected": "\u5df2\u62d2\u7edd",
    "following": "\u6682\u65e0\u6cd5\u5904\u7406\uff0c\u8ddf\u8fdb\u4e2d",
}

BAN_CONTACT_EMAIL = "misonomikahk@gmail.com"
BAN_ACCOUNT_MESSAGE = "该账户被封禁BAN"
BAN_ACCOUNT_PUBLIC_REASON = "可能原因：违反使用规则、异常访问行为、账号存在安全风险，或经管理员审核后被限制使用。"
BAN_ACCOUNT_CONTACT = f"如有问题，联系管理员邮箱 {BAN_CONTACT_EMAIL}"
LOGIN_FAILURE_WINDOW_MINUTES = 10
LOGIN_FAILURE_IP_THRESHOLD = 10
LOGIN_FAILURE_RISK_LEVELS = [
    (60, 72, "critical"),
    (30, 24, "high"),
    (10, 1, "medium"),
]


class RegionTranslateRequest(BaseModel):
    texts: list[str]
    lang: str | None = "zh-CN"


class CustomLyricsUpdate(BaseModel):
    lyrics: str = ""


def ensure_song_exists(song_id: int) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT SongID, CoverPath FROM Songs WHERE SongID = ?", (song_id,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return {"SongID": int(row.SongID), "CoverPath": row.CoverPath}


def require_admin(user: dict) -> None:
    if user.get("role") != "Admin" and user.get("Role") != "Admin":
        raise HTTPException(status_code=403, detail="Admin access required")


def is_root_admin(user: dict) -> bool:
    """Only the built-in admin account has highest administrative authority."""
    username = str(user.get("Username") or user.get("sub") or "").strip().casefold()
    return (user.get("role") == "Admin" or user.get("Role") == "Admin") and username == "admin"


def require_root_admin(user: dict) -> None:
    if not is_root_admin(user):
        raise HTTPException(status_code=403, detail="Only the admin account can delete users")


def get_custom_cover_file(song_id: int) -> tuple[str, str] | None:
    for ext in CUSTOM_COVER_EXTS:
        candidate = os.path.join(CUSTOM_COVERS_DIR, f"song_{song_id}{ext}")
        if os.path.isfile(candidate):
            return candidate, ext
    return None


def get_custom_cover_path(song_id: int) -> str | None:
    """Return global custom cover URL for a song when one exists on disk."""
    found = get_custom_cover_file(song_id)
    if found:
        return f"/custom-covers/song_{song_id}{found[1]}"
    return None


def get_custom_lyrics_path(song_id: int) -> str:
    return os.path.join(CUSTOM_LYRICS_DIR, f"song_{song_id}.lrc")


def remove_custom_cover_files(song_id: int) -> None:
    for ext in CUSTOM_COVER_EXTS:
        candidate = os.path.join(CUSTOM_COVERS_DIR, f"song_{song_id}{ext}")
        if os.path.isfile(candidate):
            os.remove(candidate)


def apply_custom_cover_to_song_payload(song: dict) -> dict:
    """Prefer global custom cover while retaining original cover as DefaultCoverPath."""
    try:
        song_id = int(song.get("SongID"))
    except (TypeError, ValueError):
        return song
    default_cover = song.get("DefaultCoverPath", song.get("CoverPath"))
    song["DefaultCoverPath"] = default_cover
    custom_cover = get_custom_cover_path(song_id)
    if custom_cover:
        song["CoverPath"] = custom_cover
        song["HasCustomCover"] = True
    else:
        song["CoverPath"] = default_cover
        song["HasCustomCover"] = False
    song["HasCustomLyrics"] = get_custom_lyrics_text(song_id) is not None
    return song


def get_custom_lyrics_text(song_id: int) -> str | None:
    """Return global custom lyrics text for a song when a .lrc file exists."""
    path = get_custom_lyrics_path(song_id)
    if not os.path.isfile(path):
        return None
    try:
        text = open(path, "r", encoding="utf-8-sig").read().strip()
    except UnicodeDecodeError:
        text = open(path, "r", encoding="utf-8", errors="replace").read().strip()
    return text or None


def build_custom_asset_payload(song_id: int) -> dict:
    song = ensure_song_exists(song_id)
    custom_lyrics = get_custom_lyrics_text(song_id)
    custom_cover = get_custom_cover_path(song_id)
    return {
        "song_id": song_id,
        "cover_path": custom_cover or song["CoverPath"],
        "default_cover_path": song["CoverPath"],
        "has_custom_cover": custom_cover is not None,
        "has_custom_lyrics": custom_lyrics is not None,
        "custom_lyrics": custom_lyrics or "",
    }

def serialize_datetime(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def get_ticket_status_label(status: str | None) -> str:
    return TICKET_STATUS_LABELS.get(status or "pending", status or "\u5f85\u5904\u7406")


def is_admin_user(user: dict) -> bool:
    return user.get("Role") == "Admin" or user.get("role") == "Admin"


def detect_avatar_image_ext(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def sanitize_ticket_filename(filename: str | None) -> str:
    base = os.path.basename(filename or "attachment")
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", base).strip(" .")
    if not base:
        base = "attachment"
    return base[:180]


def get_ticket_attachment_path(ticket_id: int, message_id: int, stored_name: str) -> str:
    return os.path.join(TICKET_ATTACHMENTS_DIR, str(ticket_id), str(message_id), stored_name)


def resolve_ticket_attachment_path(ticket_id: int, message_id: int, stored_name: str) -> str:
    root = os.path.abspath(TICKET_ATTACHMENTS_DIR)
    file_path = os.path.abspath(get_ticket_attachment_path(ticket_id, message_id, stored_name))
    if os.path.commonpath([root, file_path]) != root:
        raise HTTPException(status_code=400, detail="Invalid attachment path")
    return file_path


def normalize_ticket_body_format(value: str | None) -> str:
    value = (value or "markdown").strip().lower()
    return "text" if value == "text" else "markdown"


def validate_ticket_body_size(body: str) -> None:
    if len((body or "").encode("utf-8")) > TICKET_BODY_MAX_BYTES:
        raise HTTPException(status_code=413, detail="\u5de5\u5355\u6587\u672c\u6700\u5927 1MB")


def validate_ticket_media_file(filename: str | None, content_type: str | None) -> None:
    safe_name = sanitize_ticket_filename(filename)
    ext = os.path.splitext(safe_name)[1].lower()
    ctype = (content_type or mimetypes.guess_type(safe_name)[0] or "").lower()
    if ctype in TICKET_BLOCKED_CONTENT_TYPES or ext == ".svg":
        raise HTTPException(status_code=400, detail="\u4e0d\u652f\u6301\u4e0a\u4f20\u8be5\u7c7b\u578b\u7684\u9644\u4ef6")
    if ext not in TICKET_ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="\u5de5\u5355\u9644\u4ef6\u4ec5\u652f\u6301\u56fe\u7247\u3001\u97f3\u9891\u548c\u89c6\u9891\u6587\u4ef6")
    if ctype and not ctype.startswith(TICKET_ALLOWED_CONTENT_PREFIXES):
        raise HTTPException(status_code=400, detail="\u5de5\u5355\u9644\u4ef6\u4ec5\u652f\u6301\u56fe\u7247\u3001\u97f3\u9891\u548c\u89c6\u9891\u6587\u4ef6")


def fetch_ticket_for_access(cursor, ticket_id: int, user: dict) -> dict:
    cursor.execute("""
        SELECT t.TicketID, t.UserID, t.Title, t.Status, t.CreatedAt, t.UpdatedAt, t.ClosedAt,
               u.Username, u.Nickname
        FROM SupportTickets t
        LEFT JOIN Users u ON u.UserID = t.UserID
        WHERE t.TicketID = ?
    """, (ticket_id,))
    row = cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    is_admin = user.get("Role") == "Admin" or user.get("role") == "Admin"
    if not is_admin and int(row.UserID) != int(user["UserID"]):
        raise HTTPException(status_code=403, detail="No access to this ticket")
    return {
        "ticket_id": int(row.TicketID),
        "user_id": int(row.UserID),
        "title": row.Title,
        "status": row.Status,
        "status_label": get_ticket_status_label(row.Status),
        "created_at": serialize_datetime(row.CreatedAt),
        "updated_at": serialize_datetime(row.UpdatedAt),
        "closed_at": serialize_datetime(row.ClosedAt),
        "username": row.Username,
        "nickname": row.Nickname or row.Username,
    }


async def save_ticket_attachments(cursor, ticket_id: int, message_id: int, user_id: int, uploads, *, enforce_user_limits: bool) -> list[dict]:
    files = [f for f in (uploads or []) if f is not None and (f.filename or "").strip()]
    if not files:
        return []
    if enforce_user_limits and len(files) > TICKET_USER_MAX_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"\u6700\u591a\u53ea\u80fd\u4e0a\u4f20 {TICKET_USER_MAX_ATTACHMENTS} \u4e2a\u9644\u4ef6")

    target_dir = os.path.join(TICKET_ATTACHMENTS_DIR, str(ticket_id), str(message_id))
    os.makedirs(target_dir, exist_ok=True)
    saved_paths: list[str] = []
    temp_paths: list[str] = []
    saved_payloads: list[dict] = []

    try:
        for upload in files:
            validate_ticket_media_file(upload.filename, upload.content_type)
            original_name = sanitize_ticket_filename(upload.filename)
            ext = os.path.splitext(original_name)[1].lower()[:20]
            stored_name = f"{uuid.uuid4().hex}{ext}"
            file_path = resolve_ticket_attachment_path(ticket_id, message_id, stored_name)
            tmp_path = file_path + ".part"
            temp_paths.append(tmp_path)
            total = 0
            with open(tmp_path, "wb") as out:
                while True:
                    chunk = await upload.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    total += len(chunk)
                    if enforce_user_limits and total > TICKET_USER_MAX_ATTACHMENT_BYTES:
                        raise HTTPException(status_code=413, detail="\u5355\u4e2a\u9644\u4ef6\u6700\u5927 100MB")
                    out.write(chunk)
            if total <= 0:
                raise HTTPException(status_code=400, detail="\u9644\u4ef6\u4e0d\u80fd\u4e3a\u7a7a")
            os.replace(tmp_path, file_path)
            if tmp_path in temp_paths:
                temp_paths.remove(tmp_path)
            saved_paths.append(file_path)
            content_type = upload.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
            cursor.execute("""
                INSERT INTO SupportTicketAttachments
                    (TicketID, MessageID, UserID, OriginalName, StoredName, ContentType, FileSize, CreatedAt)
                OUTPUT INSERTED.AttachmentID
                VALUES (?, ?, ?, ?, ?, ?, ?, SYSUTCDATETIME())
            """, (ticket_id, message_id, user_id, original_name, stored_name, content_type, total))
            attachment_id = int(cursor.fetchone()[0])
            saved_payloads.append({
                "attachment_id": attachment_id,
                "ticket_id": ticket_id,
                "message_id": message_id,
                "original_name": original_name,
                "content_type": content_type,
                "file_size": total,
                "url": f"/api/ticket-attachments/{attachment_id}",
            })
    except Exception:
        for path in saved_paths + temp_paths:
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except OSError:
                pass
        try:
            if os.path.isdir(target_dir) and not os.listdir(target_dir):
                os.rmdir(target_dir)
        except OSError:
            pass
        raise
    return saved_payloads




def sanitize_announcement_filename(filename: str | None) -> str:
    base = os.path.basename(filename or "attachment")
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", base).strip(" .")
    if not base:
        base = "attachment"
    return base[:180]


def get_announcement_attachment_path(announcement_id: int, stored_name: str) -> str:
    return os.path.join(ANNOUNCEMENT_ATTACHMENTS_DIR, str(announcement_id), stored_name)


def resolve_announcement_attachment_path(announcement_id: int, stored_name: str) -> str:
    root = os.path.abspath(ANNOUNCEMENT_ATTACHMENTS_DIR)
    file_path = os.path.abspath(get_announcement_attachment_path(announcement_id, stored_name))
    if os.path.commonpath([root, file_path]) != root:
        raise HTTPException(status_code=400, detail="Invalid attachment path")
    return file_path


def normalize_announcement_body_format(value: str | None) -> str:
    value = (value or "markdown").strip().lower()
    return "text" if value == "text" else "markdown"


def parse_form_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def parse_optional_int(value) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = int(text)
    except ValueError:
        raise HTTPException(status_code=400, detail="\u76ee\u6807\u7528\u6237\u65e0\u6548")
    return parsed if parsed > 0 else None


def validate_announcement_body_size(body: str) -> None:
    if len((body or "").encode("utf-8")) > ANNOUNCEMENT_BODY_MAX_BYTES:
        raise HTTPException(status_code=413, detail="公告正文最大 2MB")


def validate_announcement_file(filename: str | None, content_type: str | None) -> None:
    safe_name = sanitize_announcement_filename(filename)
    ext = os.path.splitext(safe_name)[1].lower()
    ctype = (content_type or mimetypes.guess_type(safe_name)[0] or "").lower()
    if ext in ANNOUNCEMENT_BLOCKED_EXTS or ctype in ANNOUNCEMENT_BLOCKED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="公告附件类型不在允许范围内")
    if ext not in ANNOUNCEMENT_ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="公告附件类型不在允许范围内")


def ensure_announcement_target_user(cursor, target_user_id: int | None) -> None:
    if target_user_id is None:
        return
    cursor.execute("SELECT UserID FROM Users WHERE UserID = ? AND IsActive = 1", (target_user_id,))
    if cursor.fetchone() is None:
        raise HTTPException(status_code=404, detail="目标用户不存在或已停用")


def can_access_announcement_row(row, user: dict) -> bool:
    if is_admin_user(user):
        return True
    target_user_id = row.TargetUserID
    return target_user_id is None or int(target_user_id) == int(user["UserID"])


async def save_announcement_attachments(cursor, announcement_id: int, uploads) -> list[dict]:
    files = [f for f in (uploads or []) if f is not None and (f.filename or "").strip()]
    if not files:
        return []
    if len(files) > ANNOUNCEMENT_MAX_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"公告最多只能上传 {ANNOUNCEMENT_MAX_ATTACHMENTS} 个附件")

    target_dir = os.path.join(ANNOUNCEMENT_ATTACHMENTS_DIR, str(announcement_id))
    os.makedirs(target_dir, exist_ok=True)
    saved_paths: list[str] = []
    temp_paths: list[str] = []
    saved_payloads: list[dict] = []

    try:
        for upload in files:
            validate_announcement_file(upload.filename, upload.content_type)
            original_name = sanitize_announcement_filename(upload.filename)
            ext = os.path.splitext(original_name)[1].lower()[:20]
            stored_name = f"{uuid.uuid4().hex}{ext}"
            file_path = resolve_announcement_attachment_path(announcement_id, stored_name)
            tmp_path = file_path + ".part"
            temp_paths.append(tmp_path)
            total = 0
            with open(tmp_path, "wb") as out:
                while True:
                    chunk = await upload.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > ANNOUNCEMENT_MAX_ATTACHMENT_BYTES:
                        raise HTTPException(status_code=413, detail="单个公告附件最大 100MB")
                    out.write(chunk)
            if total <= 0:
                raise HTTPException(status_code=400, detail="\u9644\u4ef6\u4e0d\u80fd\u4e3a\u7a7a")
            os.replace(tmp_path, file_path)
            if tmp_path in temp_paths:
                temp_paths.remove(tmp_path)
            saved_paths.append(file_path)
            content_type = upload.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
            cursor.execute("""
                INSERT INTO AnnouncementAttachments
                    (AnnouncementID, OriginalName, StoredName, ContentType, FileSize, CreatedAt)
                OUTPUT INSERTED.AttachmentID
                VALUES (?, ?, ?, ?, ?, SYSUTCDATETIME())
            """, (announcement_id, original_name, stored_name, content_type, total))
            attachment_id = int(cursor.fetchone()[0])
            saved_payloads.append({
                "attachment_id": attachment_id,
                "announcement_id": announcement_id,
                "original_name": original_name,
                "content_type": content_type,
                "file_size": total,
                "url": f"/api/announcement-attachments/{attachment_id}",
            })
    except Exception:
        for path in saved_paths + temp_paths:
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except OSError:
                pass
        try:
            if os.path.isdir(target_dir) and not os.listdir(target_dir):
                os.rmdir(target_dir)
        except OSError:
            pass
        raise
    return saved_payloads


def build_announcement_payload(row, attachments: list[dict] | None = None) -> dict:
    target_user_id = row.TargetUserID
    target_label = "全体成员" if target_user_id is None else (row.TargetNickname or row.TargetUsername or f"用户 {int(target_user_id)}")
    return {
        "announcement_id": int(row.AnnouncementID),
        "sender_user_id": int(row.SenderUserID) if row.SenderUserID is not None else None,
        "sender_name": row.SenderNickname or row.SenderUsername or "管理员",
        "target_user_id": int(target_user_id) if target_user_id is not None else None,
        "target_label": target_label,
        "title": row.Title,
        "body": row.Body or "",
        "body_format": row.BodyFormat or "markdown",
        "is_pinned": bool(row.IsPinned),
        "created_at": serialize_datetime(row.CreatedAt),
        "updated_at": serialize_datetime(row.UpdatedAt),
        "attachments": attachments or [],
    }


def fetch_announcement_for_access(cursor, announcement_id: int, user: dict):
    cursor.execute("""
        SELECT a.AnnouncementID, a.SenderUserID, a.TargetUserID, a.Title, a.Body, a.BodyFormat,
               a.IsPinned, a.IsDeleted, a.CreatedAt, a.UpdatedAt,
               su.Username AS SenderUsername, su.Nickname AS SenderNickname,
               tu.Username AS TargetUsername, tu.Nickname AS TargetNickname
        FROM Announcements a
        LEFT JOIN Users su ON su.UserID = a.SenderUserID
        LEFT JOIN Users tu ON tu.UserID = a.TargetUserID
        WHERE a.AnnouncementID = ?
    """, (announcement_id,))
    row = cursor.fetchone()
    if row is None or bool(row.IsDeleted):
        raise HTTPException(status_code=404, detail="Announcement not found")
    if not can_access_announcement_row(row, user):
        raise HTTPException(status_code=403, detail="No access to this announcement")
    return row


def list_announcement_attachments(cursor, announcement_id: int) -> list[dict]:
    cursor.execute("""
        SELECT AttachmentID, AnnouncementID, OriginalName, ContentType, FileSize, CreatedAt
        FROM AnnouncementAttachments
        WHERE AnnouncementID = ?
        ORDER BY CreatedAt ASC, AttachmentID ASC
    """, (announcement_id,))
    return [{
        "attachment_id": int(row.AttachmentID),
        "announcement_id": int(row.AnnouncementID),
        "original_name": row.OriginalName,
        "content_type": row.ContentType or "application/octet-stream",
        "file_size": int(row.FileSize or 0),
        "created_at": serialize_datetime(row.CreatedAt),
        "url": f"/api/announcement-attachments/{int(row.AttachmentID)}",
    } for row in cursor.fetchall()]


def build_ticket_detail(cursor, ticket_id: int, user: dict) -> dict:
    ticket = fetch_ticket_for_access(cursor, ticket_id, user)
    cursor.execute("""
        SELECT m.MessageID, m.TicketID, m.UserID, m.AuthorRole, m.Body, m.BodyFormat, m.Result, m.CreatedAt,
               u.Username, u.Nickname
        FROM SupportTicketMessages m
        LEFT JOIN Users u ON u.UserID = m.UserID
        WHERE m.TicketID = ?
        ORDER BY m.CreatedAt ASC, m.MessageID ASC
    """, (ticket_id,))
    message_rows = cursor.fetchall()

    cursor.execute("""
        SELECT AttachmentID, TicketID, MessageID, OriginalName, ContentType, FileSize, CreatedAt
        FROM SupportTicketAttachments
        WHERE TicketID = ?
        ORDER BY CreatedAt ASC, AttachmentID ASC
    """, (ticket_id,))
    attachment_rows = cursor.fetchall()
    attachments_by_message: dict[int, list[dict]] = defaultdict(list)
    for row in attachment_rows:
        payload = {
            "attachment_id": int(row.AttachmentID),
            "ticket_id": int(row.TicketID),
            "message_id": int(row.MessageID),
            "original_name": row.OriginalName,
            "content_type": row.ContentType or "application/octet-stream",
            "file_size": int(row.FileSize or 0),
            "created_at": serialize_datetime(row.CreatedAt),
            "url": f"/api/ticket-attachments/{int(row.AttachmentID)}",
        }
        attachments_by_message[int(row.MessageID)].append(payload)

    messages = []
    for row in message_rows:
        result = row.Result
        messages.append({
            "message_id": int(row.MessageID),
            "ticket_id": int(row.TicketID),
            "user_id": int(row.UserID),
            "author_role": row.AuthorRole,
            "author_name": row.Nickname or row.Username or ("\u7ba1\u7406\u5458" if row.AuthorRole == "Admin" else "\u7528\u6237"),
            "body": row.Body or "",
            "body_format": row.BodyFormat or "markdown",
            "result": result,
            "result_label": TICKET_RESULT_LABELS.get(result) if result else None,
            "created_at": serialize_datetime(row.CreatedAt),
            "attachments": attachments_by_message.get(int(row.MessageID), []),
        })
    ticket["messages"] = messages
    return ticket


# ────────────────────────────────────────────────────────────────────
#  Auth dependency
# ────────────────────────────────────────────────────────────────────



def fetch_active_ban(cursor, subject_type: str, subject_value, scope: str = "all") -> dict | None:
    """Return an active BAN row for the subject and scope, or None."""
    normalized_scope = (scope or "all").strip() or "all"
    cursor.execute("""
        SELECT TOP 1 BanID, SubjectType, SubjectValue, Scope, Reason, BannedUntil
        FROM AbuseBans
        WHERE IsActive = 1
          AND SubjectType = ?
          AND SubjectValue = ?
          AND (Scope = 'all' OR Scope = ?)
          AND (BannedUntil IS NULL OR BannedUntil > SYSUTCDATETIME())
        ORDER BY
          CASE WHEN Scope = ? THEN 0 WHEN Scope = 'all' THEN 1 ELSE 2 END,
          BannedAt DESC,
          BanID DESC
    """, (subject_type, str(subject_value), normalized_scope, normalized_scope))
    row = cursor.fetchone()
    if row is None:
        return None
    return {
        "ban_id": int(row.BanID),
        "subject_type": row.SubjectType,
        "subject_value": row.SubjectValue,
        "scope": row.Scope,
        "reason": row.Reason,
        "banned_until": row.BannedUntil,
    }


def build_account_ban_detail(ban: dict | None = None, requested_scope: str = "all") -> dict:
    return {
        "message": BAN_ACCOUNT_MESSAGE,
        "scope": (ban or {}).get("scope") or requested_scope,
        "reason": BAN_ACCOUNT_PUBLIC_REASON,
        "contact": BAN_ACCOUNT_CONTACT,
        "banned_until": serialize_datetime((ban or {}).get("banned_until")),
    }


def raise_active_ban(ban: dict, requested_scope: str = "all") -> None:
    raise HTTPException(status_code=403, detail=build_account_ban_detail(ban, requested_scope))


def log_abuse_event(
    cursor,
    *,
    action: str,
    scope: str | None = None,
    user_id: int | None = None,
    username: str | None = None,
    ip: str | None = None,
    target_type: str | None = None,
    target_id: str | int | None = None,
    severity: str = "info",
    message: str | None = None,
    extra: dict | None = None,
) -> int | None:
    cursor.execute("""
        INSERT INTO AbuseEvents
            (UserID, Username, IP, Action, Scope, TargetType, TargetID, Severity, Message, ExtraJson, CreatedAt)
        OUTPUT INSERTED.EventID
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, SYSUTCDATETIME())
    """, (
        user_id,
        username,
        ip,
        action,
        scope,
        target_type,
        str(target_id) if target_id is not None else None,
        severity,
        message,
        json.dumps(extra or {}, ensure_ascii=False) if extra else None,
    ))
    row = cursor.fetchone()
    return int(row[0]) if row else None


def create_abuse_ban(
    cursor,
    *,
    subject_type: str,
    subject_value,
    scope: str,
    reason: str,
    evidence: str | None = None,
    banned_until=None,
    created_by_user_id: int | None = None,
    created_by_type: str = "admin",
    event_action: str = "ban_created",
    event_ip: str | None = None,
    event_severity: str = "high",
) -> int:
    cursor.execute("""
        INSERT INTO AbuseBans
            (SubjectType, SubjectValue, Scope, Reason, Evidence, BannedUntil, CreatedByUserID, CreatedByType, IsActive, CreatedAt)
        OUTPUT INSERTED.BanID
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, SYSUTCDATETIME())
    """, (
        subject_type,
        str(subject_value),
        normalize_ban_scope(scope),
        reason,
        evidence,
        banned_until,
        created_by_user_id,
        created_by_type,
    ))
    ban_id = int(cursor.fetchone()[0])
    log_abuse_event(
        cursor,
        action=event_action,
        scope=normalize_ban_scope(scope),
        user_id=created_by_user_id,
        ip=event_ip,
        target_type=subject_type,
        target_id=subject_value,
        severity=event_severity,
        message=reason,
        extra={"ban_id": ban_id, "created_by_type": created_by_type, "banned_until": serialize_datetime(banned_until)},
    )
    return ban_id


def normalize_ban_scope(scope: str | None) -> str:
    allowed = {
        "all", "auth.login", "auth.refresh", "ticket.create", "ticket.reply", "ticket.upload",
        "avatar.upload", "stream", "stats.write", "playlist.write", "favorite.write",
        "weather", "region.search", "admin",
    }
    value = (scope or "all").strip()
    if value not in allowed:
        raise HTTPException(status_code=400, detail="Invalid BAN scope")
    return value


def get_request_ip(request: Request | None) -> str | None:
    if request is None or request.client is None:
        return None
    return request.client.host


def compute_manual_banned_until(body: AdminBanRequest):
    if body.permanent or body.hours is None:
        return None
    hours = body.hours
    if hours <= 0 or hours > 24 * 365:
        raise HTTPException(status_code=400, detail="BAN duration is invalid")
    return datetime.utcnow() + timedelta(hours=hours)


def login_failure_risk(failures: int, *, target_role: str | None = None, known_user: bool = False) -> tuple[int, str, str]:
    if (target_role or "") == "Admin":
        return 72, "critical", "管理员账号登录失败次数过多"
    if known_user:
        return 24, "high", "已存在账号登录失败次数过多"
    for threshold, hours, severity in LOGIN_FAILURE_RISK_LEVELS:
        if failures >= threshold:
            return hours, severity, "未知账号或撞库登录失败次数过多"
    return 1, "medium", "未知账号或撞库登录失败次数过多"


def ensure_admin_can_manage_target(actor: dict, target_row, *, action: str = "ban") -> None:
    if target_row is None:
        raise HTTPException(status_code=404, detail="User not found")
    actor_id = int(actor.get("UserID"))
    target_id = int(target_row.UserID)
    target_username = str(target_row.Username or "")
    target_is_admin = str(target_row.Role or "") == "Admin"
    target_is_root = target_username.strip().casefold() == "admin"
    actor_is_root = is_root_admin(actor)

    if actor_id == target_id:
        raise HTTPException(status_code=403, detail="Cannot BAN or unban yourself")
    if target_is_root:
        raise HTTPException(status_code=403, detail="The highest admin account cannot be managed here")
    if target_is_admin and not actor_is_root:
        raise HTTPException(status_code=403, detail="Only the highest admin can manage other admins")




def assert_user_not_banned(cursor, user_id: int, username: str, scope: str = "all") -> None:
    for subject_type, subject_value in (("user", user_id), ("username", username)):
        ban = fetch_active_ban(cursor, subject_type, subject_value, scope)
        if ban is not None:
            raise_active_ban(ban, scope)

def record_login_failure_and_maybe_ban(cursor, *, request: Request, username: str, user_id: int | None = None, target_role: str | None = None) -> int | None:
    ip = get_request_ip(request)
    log_abuse_event(
        cursor,
        action="login_failed",
        scope="auth.login",
        user_id=user_id,
        username=username,
        ip=ip,
        severity="warning",
        message="登录失败",
    )
    if not ip:
        return None
    cursor.execute("""
        SELECT COUNT(*)
        FROM AbuseEvents
        WHERE Action = 'login_failed'
          AND IP = ?
          AND CreatedAt >= DATEADD(minute, -?, SYSUTCDATETIME())
    """, (ip, LOGIN_FAILURE_WINDOW_MINUTES))
    failures = int(cursor.fetchone()[0] or 0)
    if failures < LOGIN_FAILURE_IP_THRESHOLD:
        return None
    if fetch_active_ban(cursor, "ip", ip, "auth.login") is not None:
        return None
    ban_hours, severity, risk_reason = login_failure_risk(failures, target_role=target_role, known_user=user_id is not None)
    banned_until = datetime.utcnow() + timedelta(hours=ban_hours)
    reason = f"{risk_reason}，系统自动限制登录 {ban_hours} 小时?"
    evidence = f"{LOGIN_FAILURE_WINDOW_MINUTES} 分钟内登录失败 {failures} 次，风险等级 {severity}"
    return create_abuse_ban(
        cursor,
        subject_type="ip",
        subject_value=ip,
        scope="auth.login",
        reason=reason,
        evidence=evidence,
        banned_until=banned_until,
        created_by_user_id=None,
        created_by_type="system",
        event_action="auto_ban_created",
        event_ip=ip,
        event_severity=severity,
    )




def load_auth_user(cursor, username: str, scope: str = "all") -> dict:
    cursor.execute(
        "SELECT UserID, Username, Role, IsActive FROM Users WHERE Username = ?",
        (username,),
    )
    row = cursor.fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id, username, role, is_active = row
    if not is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    assert_user_not_banned(cursor, int(user_id), username, scope)
    return {
        "UserID": int(user_id),
        "Username": username,
        "Role": role,
        "IsActive": bool(is_active),
        "sub": username,
        "role": role,
    }


def assert_current_user_scope(user: dict, scope: str) -> None:
    """Check a scoped BAN for an already authenticated user."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        assert_user_not_banned(cursor, int(user["UserID"]), user["Username"], scope)
    finally:
        cursor.close()
        conn.close()

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Validate Bearer token and re-check the live database user state."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    token = credentials.credentials
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("type") == "refresh":
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        return load_auth_user(cursor, username, "all")
    finally:
        cursor.close()
        conn.close()


def get_user_from_query_token(token: str | None, scope: str = "all") -> dict:
    """Validate a URL token for media elements that cannot send Authorization headers."""
    if not token:
        raise HTTPException(status_code=401, detail="Missing media token")
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired media token")
    if payload.get("type") == "refresh" or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid or expired media token")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        return load_auth_user(cursor, payload["sub"], scope)
    finally:
        cursor.close()
        conn.close()


def get_current_user_full(
    user: dict = Depends(get_current_user),
) -> dict:
    """Return the full user row (UserID, Username, Nickname, AvatarUrl, Role)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT UserID, Username, Nickname, AvatarUrl, Role, IsActive,
               Country, Province, City, District,
               CountryAdcode, ProvinceAdcode, CityAdcode, DistrictAdcode,
               LocationAdcode, LocationName, LocationLevel, LocationCenter, LocationSource,
               LocationCountryCode, LocationGeonameID, LocationLatitude, LocationLongitude, LocationTimezone,
               LastSongID, VisualizerEnabled
        FROM Users WHERE Username = ?
        """,
        (user["sub"],),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not row.IsActive:
        raise HTTPException(status_code=403, detail="Account is disabled")

    return {
        "UserID": row.UserID,
        "Username": row.Username,
        "Nickname": row.Nickname or row.Username,
        "AvatarUrl": row.AvatarUrl,
        "Role": row.Role,
        "role": row.Role,
        "sub": row.Username,
        "IsActive": bool(row.IsActive),
        "Country": row.Country or "中国",
        "Province": row.Province or "北京",
        "City": row.City or "北京",
        "District": row.District or "",
        "CountryAdcode": row.CountryAdcode or "",
        "ProvinceAdcode": row.ProvinceAdcode or "",
        "CityAdcode": row.CityAdcode or "",
        "DistrictAdcode": row.DistrictAdcode or "",
        "LocationAdcode": row.LocationAdcode or "",
        "LocationName": row.LocationName or "",
        "LocationLevel": row.LocationLevel or "",
        "LocationCenter": row.LocationCenter or "",
        "LocationSource": row.LocationSource or "",
        "LocationCountryCode": row.LocationCountryCode or "",
        "LocationGeonameID": row.LocationGeonameID or "",
        "LocationLatitude": row.LocationLatitude,
        "LocationLongitude": row.LocationLongitude,
        "LocationTimezone": row.LocationTimezone or "",
        "LastSongID": row.LastSongID,
        "VisualizerEnabled": bool(row.VisualizerEnabled) if row.VisualizerEnabled is not None else True,
    }


# ────────────────────────────────────────────────────────────────────
#  POST /api/auth/login
# ────────────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
def login(body: LoginRequest, request: Request):
    """Authenticate a user and return access + refresh tokens."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        username_input = (body.username or "").strip()
        cursor.execute(
            "SELECT UserID, Username, PasswordHash, Role, IsActive FROM Users WHERE Username = ?",
            (username_input,),
        )
        row = cursor.fetchone()
        if row is None:
            record_login_failure_and_maybe_ban(cursor, request=request, username=username_input)
            conn.commit()
            raise HTTPException(status_code=401, detail="Invalid username or password")

        user_id, username, password_hash, role, is_active = row

        if not verify_password(body.password, password_hash):
            record_login_failure_and_maybe_ban(cursor, request=request, username=username, user_id=int(user_id), target_role=role)
            conn.commit()
            raise HTTPException(status_code=401, detail="Invalid username or password")

        if not is_active:
            raise HTTPException(status_code=403, detail=build_account_ban_detail(None, "all"))

        assert_user_not_banned(cursor, int(user_id), username, "auth.login")

        access_token = create_access_token(data={"sub": username, "role": role})
        refresh_token = create_refresh_token(data={"sub": username, "role": role})

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "role": role,
        }
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


# ────────────────────────────────────────────────────────────────────
#  POST /api/auth/refresh
# ────────────────────────────────────────────────────────────────────

@app.post("/api/auth/refresh")
def refresh(body: RefreshRequest):
    """Exchange a valid refresh token for a new access token."""
    try:
        payload = decode_token(body.refresh_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Not a refresh token")
    if not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        auth_user = load_auth_user(cursor, payload["sub"], "auth.refresh")
        new_access = create_access_token(
            data={"sub": auth_user["Username"], "role": auth_user["Role"]}
        )
        new_refresh = create_refresh_token(
            data={"sub": auth_user["Username"], "role": auth_user["Role"]}
        )
        return {
            "access_token": new_access,
            "refresh_token": new_refresh,
            "token_type": "bearer",
        }
    finally:
        cursor.close()
        conn.close()


# ════════════════════════════════════════════════════════════════════
#  User profile endpoints
# ════════════════════════════════════════════════════════════════════

# ────────────────────────────────────────────────────────────────────
#  GET /api/users/me
# ────────────────────────────────────────────────────────────────────

@app.get("/api/users/me")
def get_my_profile(user: dict = Depends(get_current_user_full)):
    """Return the current user's profile."""
    return user


@app.get("/api/users/me/last-played")
def get_last_played_song(user: dict = Depends(get_current_user_full)):
    """Return the current user's last selected song."""
    song_id = user.get("LastSongID")
    if not song_id:
        return {"song_id": None}

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT SongID FROM Songs WHERE SongID = ?", (song_id,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if row is None:
        return {"song_id": None}
    return {"song_id": int(row.SongID)}


@app.put("/api/users/me/last-played")
def update_last_played_song(body: LastPlayedUpdate, user: dict = Depends(get_current_user_full)):
    """Persist the current user's last selected song for cross-device resume."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT SongID FROM Songs WHERE SongID = ?", (body.song_id,))
    row = cursor.fetchone()
    if row is None:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Song not found")

    cursor.execute(
        "UPDATE Users SET LastSongID = ? WHERE UserID = ?",
        (body.song_id, user["UserID"]),
    )
    conn.commit()
    cursor.close()
    conn.close()
    return {"detail": "Last played song updated", "song_id": body.song_id}


@app.put("/api/users/me/visualizer")
def update_visualizer_preference(body: VisualizerPreferenceUpdate, user: dict = Depends(get_current_user_full)):
    """Persist the current user's rhythm bar / visualizer preference."""
    enabled = bool(body.enabled)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE Users SET VisualizerEnabled = ? WHERE UserID = ?",
        (1 if enabled else 0, user["UserID"]),
    )
    conn.commit()
    cursor.close()
    conn.close()
    return {"detail": "Visualizer preference updated", "enabled": enabled}


# ────────────────────────────────────────────────────────────────────
#  PUT /api/users/me/profile
# ────────────────────────────────────────────────────────────────────

@app.put("/api/users/me/profile")
def update_nickname(body: ProfileUpdate, user: dict = Depends(get_current_user_full)):
    """Update the current user's nickname."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE Users SET Nickname = ? WHERE UserID = ?",
        (body.nickname, user["UserID"]),
    )
    conn.commit()
    cursor.close()
    conn.close()
    return {"detail": "Nickname updated", "nickname": body.nickname}


# ────────────────────────────────────────────────────────────────────
#  PUT /api/users/me/location
# ────────────────────────────────────────────────────────────────────

@app.put("/api/users/me/location")
def update_location(body: LocationUpdate, user: dict = Depends(get_current_user_full)):
    """Persist the user's preferred weather region and selector metadata."""
    location_adcode = (
        body.location_adcode
        or body.district_adcode
        or body.city_adcode
        or body.province_adcode
        or body.country_adcode
        or ""
    )
    location_name = body.location_name or body.district or body.city or body.province or body.country
    location_level = body.location_level or ("district" if body.district else "city" if body.city else "province")
    location_source = body.location_source or ("amap" if location_adcode else "legacy")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE Users
        SET Country = ?, Province = ?, City = ?, District = ?,
            CountryAdcode = ?, ProvinceAdcode = ?, CityAdcode = ?, DistrictAdcode = ?,
            LocationAdcode = ?, LocationName = ?, LocationLevel = ?, LocationCenter = ?, LocationSource = ?,
            LocationCountryCode = ?, LocationGeonameID = ?, LocationLatitude = ?, LocationLongitude = ?, LocationTimezone = ?
        WHERE UserID = ?
        """,
        (
            body.country, body.province, body.city, body.district or "",
            body.country_adcode or "", body.province_adcode or "", body.city_adcode or "", body.district_adcode or "",
            location_adcode, location_name or "", location_level or "", body.location_center or "", location_source or "",
            body.location_country_code or ("CN" if body.country == CHINA_NAME else ""),
            body.location_geoname_id or "", body.location_latitude, body.location_longitude, body.location_timezone or "",
            user["UserID"],
        ),
    )
    conn.commit()
    cursor.close()
    conn.close()
    return {
        "detail": "Location updated",
        "city": body.city,
        "district": body.district or "",
        "location_adcode": location_adcode,
        "location_source": location_source,
    }


# ────────────────────────────────────────────────────────────────────
#  POST /api/users/me/avatar
# ────────────────────────────────────────────────────────────────────

@app.post("/api/users/me/avatar")
async def upload_avatar(
    avatar: UploadFile = File(...),
    user: dict = Depends(get_current_user_full),
):
    """Upload a new avatar image for the current user."""
    assert_current_user_scope(user, "avatar.upload")

    data = await avatar.read()
    if not data:
        raise HTTPException(status_code=400, detail="Avatar file is empty")
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Avatar file is too large")

    detected_ext = detect_avatar_image_ext(data)
    content_type = (avatar.content_type or "").lower()
    declared_ext = AVATAR_ALLOWED_CONTENT_TYPES.get(content_type)
    original_ext = os.path.splitext(avatar.filename or "")[1].lower()
    if detected_ext is None or (declared_ext and declared_ext != detected_ext):
        raise HTTPException(status_code=400, detail="Only JPG, PNG, or WebP avatars are supported")
    if original_ext and original_ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, or WebP avatars are supported")

    unique_name = f"user_{user['UserID']}_{uuid.uuid4().hex}{detected_ext}"
    file_path = os.path.join(AVATARS_DIR, unique_name)
    with open(file_path, "wb") as buffer:
        buffer.write(data)

    avatar_url = f"/avatars/{unique_name}"
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE Users SET AvatarUrl = ? WHERE UserID = ?",
            (avatar_url, user["UserID"]),
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()

    return {"detail": "Avatar uploaded", "avatar_url": avatar_url}


# ────────────────────────────────────────────────────────────────────
#  PUT /api/users/me/password
# ────────────────────────────────────────────────────────────────────

@app.put("/api/users/me/password")
def change_password(body: PasswordUpdate, user: dict = Depends(get_current_user_full)):
    """Change the current user's password after verifying the old one."""
    if user.get("Role") == "Admin" or user.get("role") == "Admin":
        raise HTTPException(status_code=403, detail="Admin password cannot be changed")
    if len(body.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT PasswordHash FROM Users WHERE UserID = ?",
        (user["UserID"],),
    )
    row = cursor.fetchone()

    if row is None or not verify_password(body.old_password, row.PasswordHash):
        cursor.close()
        conn.close()
        raise HTTPException(status_code=400, detail="Old password is incorrect")

    new_hash = get_password_hash(body.new_password)
    cursor.execute(
        "UPDATE Users SET PasswordHash = ? WHERE UserID = ?",
        (new_hash, user["UserID"]),
    )
    conn.commit()
    cursor.close()
    conn.close()

    return {"detail": "Password changed successfully"}


# ════════════════════════════════════════════════════════════════════
#  Admin endpoints
# ════════════════════════════════════════════════════════════════════

# ────────────────────────────────────────────────────────────────────
#  Admin user management
# ────────────────────────────────────────────────────────────────────

@app.get("/api/admin/users")
def admin_list_users(user: dict = Depends(get_current_user)):
    """Admin user list for account management. Plaintext passwords are never exposed."""
    require_admin(user)

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT UserID, Username, Nickname, Role, IsActive
            FROM Users
            ORDER BY CASE WHEN Role = 'Admin' THEN 0 ELSE 1 END, Username ASC
            """
        )
        rows = cursor.fetchall()
        cursor.execute("""
            SELECT BanID, SubjectValue, Scope, Reason, BannedAt, BannedUntil
            FROM AbuseBans
            WHERE SubjectType = 'user'
              AND IsActive = 1
              AND (BannedUntil IS NULL OR BannedUntil > SYSUTCDATETIME())
            ORDER BY BannedAt DESC, BanID DESC
        """)
        bans_by_user: dict[int, list[dict]] = defaultdict(list)
        for ban in cursor.fetchall():
            try:
                subject_user_id = int(ban.SubjectValue)
            except (TypeError, ValueError):
                continue
            bans_by_user[subject_user_id].append({
                "ban_id": int(ban.BanID),
                "scope": ban.Scope,
                "reason": ban.Reason,
                "banned_at": serialize_datetime(ban.BannedAt),
                "banned_until": serialize_datetime(ban.BannedUntil),
            })
    finally:
        cursor.close()
        conn.close()

    root_admin = is_root_admin(user)
    actor_id = int(user.get("UserID"))
    result = []
    for row in rows:
        target_id = int(row.UserID)
        target_username = row.Username or ""
        target_is_root = target_username.strip().casefold() == "admin"
        target_is_admin = row.Role == "Admin"
        can_manage_ban = (
            actor_id != target_id
            and not target_is_root
            and (root_admin or not target_is_admin)
        )
        active_bans = bans_by_user.get(target_id, [])
        result.append({
            "user_id": target_id,
            "username": target_username,
            "nickname": row.Nickname or target_username,
            "role": row.Role,
            "is_active": bool(row.IsActive),
            "is_banned": bool(active_bans),
            "active_bans": active_bans,
            "password_status": "encrypted_unreadable",
            "password_display": "\u4e0d\u53ef\u67e5\u770b\uff08\u5df2\u52a0\u5bc6\u5b58\u50a8\uff09",
            "can_reset_password": (not target_is_admin) or (root_admin and not target_is_root and actor_id != target_id),
            "can_delete_user": root_admin and target_username.strip().casefold() != "admin",
            "can_ban_user": can_manage_ban,
            "can_unban_user": can_manage_ban and bool(active_bans),
            "can_create_admin": root_admin,
        })
    return result


def can_admin_view_ban_row(actor: dict, row) -> bool:
    if is_root_admin(actor):
        return True
    if row.SubjectType != "user" or row.TargetUserID is None:
        return False
    if int(actor.get("UserID")) == int(row.TargetUserID):
        return False
    target_role = row.TargetRole or "User"
    target_username = str(row.TargetUsername or "")
    return target_role != "Admin" and target_username.strip().casefold() != "admin"


def build_ban_record_payload(row) -> dict:
    created_by_name = "系统自动" if (row.CreatedByType or "") == "system" else (row.CreatedByUsername or (f"用户 {row.CreatedByUserID}" if row.CreatedByUserID is not None else (row.CreatedByType or "未知")))
    revoked_by_name = row.RevokedByUsername or (f"用户 {row.RevokedByUserID}" if row.RevokedByUserID is not None else None)
    return {
        "ban_id": int(row.BanID),
        "subject_type": row.SubjectType,
        "subject_value": row.SubjectValue,
        "target_user_id": int(row.TargetUserID) if row.TargetUserID is not None else None,
        "target_username": row.TargetUsername,
        "target_nickname": row.TargetNickname,
        "target_role": row.TargetRole,
        "scope": row.Scope,
        "reason": row.Reason or "",
        "evidence": row.Evidence or "",
        "banned_at": serialize_datetime(row.BannedAt),
        "banned_until": serialize_datetime(row.BannedUntil),
        "is_permanent": row.BannedUntil is None,
        "is_active": bool(row.IsActive),
        "created_by_type": row.CreatedByType,
        "created_by_user_id": int(row.CreatedByUserID) if row.CreatedByUserID is not None else None,
        "created_by_name": created_by_name,
        "revoked_at": serialize_datetime(row.RevokedAt),
        "revoked_by_user_id": int(row.RevokedByUserID) if row.RevokedByUserID is not None else None,
        "revoked_by_name": revoked_by_name,
        "revoke_reason": row.RevokeReason or "",
    }


@app.get("/api/admin/bans")
def admin_list_bans(
    active_only: bool = False,
    limit: int = 100,
    user: dict = Depends(get_current_user),
):
    """List BAN records visible to the current admin, including create/revoke metadata."""
    require_admin(user)
    limit = max(1, min(int(limit or 100), 300))
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        where = "WHERE 1 = 1"
        if active_only:
            where += " AND b.IsActive = 1 AND (b.BannedUntil IS NULL OR b.BannedUntil > SYSUTCDATETIME())"
        cursor.execute(f"""
            SELECT TOP (?)
                b.BanID, b.SubjectType, b.SubjectValue, b.Scope, b.Reason, b.Evidence,
                b.BannedAt, b.BannedUntil, b.CreatedByUserID, b.CreatedByType, b.IsActive,
                b.RevokedAt, b.RevokedByUserID, b.RevokeReason,
                target.UserID AS TargetUserID, target.Username AS TargetUsername,
                target.Nickname AS TargetNickname, target.Role AS TargetRole,
                creator.Username AS CreatedByUsername, creator.Nickname AS CreatedByNickname,
                revoker.Username AS RevokedByUsername, revoker.Nickname AS RevokedByNickname
            FROM AbuseBans b
            LEFT JOIN Users target
                ON b.SubjectType = 'user' AND TRY_CONVERT(INT, b.SubjectValue) = target.UserID
            LEFT JOIN Users creator ON b.CreatedByUserID = creator.UserID
            LEFT JOIN Users revoker ON b.RevokedByUserID = revoker.UserID
            {where}
            ORDER BY b.BanID DESC
        """, (limit,))
        rows = cursor.fetchall()
        return [build_ban_record_payload(row) for row in rows if can_admin_view_ban_row(user, row)]
    finally:
        cursor.close()
        conn.close()


@app.post("/api/admin/users/{user_id}/ban")
def admin_ban_user(
    user_id: int,
    body: AdminBanRequest,
    user: dict = Depends(get_current_user),
):
    """Create a manual BAN record for a user. Highest admin can manage admins except self/root."""
    require_admin(user)
    scope = normalize_ban_scope(body.scope)
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="BAN reason is required")
    banned_until = compute_manual_banned_until(body)

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT UserID, Username, Role FROM Users WHERE UserID = ?", (user_id,))
        target = cursor.fetchone()
        ensure_admin_can_manage_target(user, target, action="ban")
        ban_id = create_abuse_ban(
            cursor,
            subject_type="user",
            subject_value=int(target.UserID),
            scope=scope,
            reason=reason,
            evidence="manual admin action",
            banned_until=banned_until,
            created_by_user_id=int(user["UserID"]),
            created_by_type="admin",
            event_action="manual_ban_created",
            event_severity="high",
        )
        conn.commit()
        return {
            "detail": "User banned",
            "ban_id": ban_id,
            "user_id": int(target.UserID),
            "username": target.Username,
            "scope": scope,
            "banned_until": serialize_datetime(banned_until),
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to BAN user: {exc}")
    finally:
        cursor.close()
        conn.close()


@app.post("/api/admin/bans/{ban_id}/revoke")
def admin_revoke_ban(
    ban_id: int,
    body: AdminBanRevokeRequest,
    user: dict = Depends(get_current_user),
):
    """Revoke a BAN record when the admin has authority over the subject."""
    require_admin(user)
    reason = (body.reason or "manual revoke").strip() or "manual revoke"
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT BanID, SubjectType, SubjectValue, Scope, Reason, IsActive
            FROM AbuseBans
            WHERE BanID = ? AND IsActive = 1
        """, (ban_id,))
        ban = cursor.fetchone()
        if ban is None:
            raise HTTPException(status_code=404, detail="Active BAN not found")

        if ban.SubjectType == "user":
            cursor.execute("SELECT UserID, Username, Role FROM Users WHERE UserID = ?", (int(ban.SubjectValue),))
            target = cursor.fetchone()
            ensure_admin_can_manage_target(user, target, action="unban")
        elif not is_root_admin(user):
            raise HTTPException(status_code=403, detail="Only the highest admin can revoke this BAN")

        cursor.execute("""
            UPDATE AbuseBans
            SET IsActive = 0, RevokedAt = SYSUTCDATETIME(), RevokedByUserID = ?, RevokeReason = ?
            WHERE BanID = ? AND IsActive = 1
        """, (int(user["UserID"]), reason, ban_id))
        log_abuse_event(
            cursor,
            action="manual_ban_revoked",
            scope=ban.Scope,
            user_id=int(user["UserID"]),
            target_type=ban.SubjectType,
            target_id=ban.SubjectValue,
            severity="high",
            message=reason,
            extra={"ban_id": int(ban_id)},
        )
        conn.commit()
        return {"detail": "BAN revoked", "ban_id": ban_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to revoke BAN: {exc}")
    finally:
        cursor.close()
        conn.close()


@app.put("/api/admin/users/{user_id}/password")
def admin_reset_user_password(
    user_id: int,
    body: AdminPasswordReset,
    user: dict = Depends(get_current_user),
):
    """Admin resets user passwords. The built-in admin can reset other admins, but never itself."""
    require_admin(user)
    root_admin = is_root_admin(user)
    actor_id = int(user.get("UserID")) if user.get("UserID") is not None else None

    new_password = (body.new_password or "").strip()
    if len(new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT UserID, Username, Role FROM Users WHERE UserID = ?",
        (user_id,),
    )
    target = cursor.fetchone()
    if target is None:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")

    target_username = (target.Username or "").strip().casefold()
    target_is_root = target_username == "admin"
    target_is_admin = target.Role == "Admin"
    target_is_self = actor_id is not None and int(target.UserID) == actor_id

    if target_is_root:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=403, detail="The admin account password cannot be changed here")

    if target_is_admin and (not root_admin or target_is_self):
        cursor.close()
        conn.close()
        raise HTTPException(status_code=403, detail="Only the admin account can reset other admin passwords")

    password_hash = get_password_hash(new_password)
    cursor.execute(
        "UPDATE Users SET PasswordHash = ? WHERE UserID = ?",
        (password_hash, user_id),
    )
    conn.commit()
    cursor.close()
    conn.close()

    return {
        "detail": "Password reset successfully",
        "user_id": user_id,
        "username": target.Username,
    }


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, user: dict = Depends(get_current_user)):
    """Delete a user account. Only username 'admin' with Admin role may do this."""
    require_root_admin(user)

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT UserID, Username, Role FROM Users WHERE UserID = ?",
            (user_id,),
        )
        target = cursor.fetchone()
        if target is None:
            raise HTTPException(status_code=404, detail="User not found")

        if str(target.Username or "").strip().casefold() == "admin":
            raise HTTPException(status_code=403, detail="The admin account cannot be deleted")

        # Explicitly remove dependent rows so deletion is stable even on older schemas
        # where not every foreign key has ON DELETE CASCADE.
        cursor.execute("""
            DELETE FROM SupportTicketAttachments
            WHERE UserID = ? OR TicketID IN (SELECT TicketID FROM SupportTickets WHERE UserID = ?)
        """, (user_id, user_id))
        cursor.execute("""
            DELETE FROM SupportTicketMessages
            WHERE UserID = ? OR TicketID IN (SELECT TicketID FROM SupportTickets WHERE UserID = ?)
        """, (user_id, user_id))
        cursor.execute("DELETE FROM SupportTickets WHERE UserID = ?", (user_id,))
        cursor.execute("DELETE FROM RefreshTokens WHERE UserID = ?", (user_id,))
        cursor.execute("DELETE FROM Favorites WHERE UserID = ?", (user_id,))
        cursor.execute("DELETE FROM PlayStats WHERE UserID = ?", (user_id,))
        cursor.execute("""
            DELETE FROM PlaylistSongs
            WHERE PlaylistID IN (SELECT PlaylistID FROM Playlists WHERE UserID = ?)
        """, (user_id,))
        cursor.execute("DELETE FROM Playlists WHERE UserID = ?", (user_id,))
        cursor.execute("DELETE FROM Users WHERE UserID = ?", (user_id,))
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {exc}")
    finally:
        cursor.close()
        conn.close()

    return {
        "detail": "User deleted",
        "user_id": user_id,
        "username": target.Username,
    }


@app.post("/api/admin/users")
def admin_create_user(
    body: UserCreate,
    user: dict = Depends(get_current_user),
):
    """Admin creates a new user.  Only callable by users with Role='Admin'."""
    # ── Permission check ──────────────────────────────────────────
    require_admin(user)
    requested_role = (body.role or "User").strip()
    if requested_role not in {"User", "Admin"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    if requested_role == "Admin" and not is_root_admin(user):
        raise HTTPException(status_code=403, detail="Only the highest admin can create admin users")

    conn = get_db_connection()
    cursor = conn.cursor()

    # ── Duplicate username check ──────────────────────────────────
    cursor.execute("SELECT COUNT(*) FROM Users WHERE Username = ?", (body.username,))
    if cursor.fetchone()[0] > 0:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=400, detail="Username already exists")

    # ── Insert new user ───────────────────────────────────────────
    password_hash = get_password_hash(body.password)
    cursor.execute(
        """INSERT INTO Users (Username, PasswordHash, Nickname, Role, IsActive)
           VALUES (?, ?, ?, ?, 1)""",
        (body.username, password_hash, body.nickname, requested_role),
    )
    conn.commit()
    cursor.close()
    conn.close()

    return {"detail": "User created", "username": body.username, "role": requested_role}


# ════════════════════════════════════════════════════════════════════
#  Playlist endpoints
# ════════════════════════════════════════════════════════════════════

# ────────────────────────────────────────────────────────────────────
#  POST /api/playlists
# ────────────────────────────────────────────────────────────────────

@app.post("/api/playlists")
def create_playlist(
    body: PlaylistCreate,
    user: dict = Depends(get_current_user_full),
):
    """Create a new playlist for the current user."""
    import datetime
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO Playlists (UserID, Name, CreatedAt) OUTPUT INSERTED.PlaylistID VALUES (?, ?, ?)",
        (user["UserID"], body.name, datetime.datetime.now()),
    )
    playlist_id = cursor.fetchone()[0]
    conn.commit()
    cursor.close()
    conn.close()
    return {"playlist_id": playlist_id, "name": body.name}


# ────────────────────────────────────────────────────────────────────
#  GET /api/playlists
# ────────────────────────────────────────────────────────────────────

@app.get("/api/playlists")
def list_playlists(user: dict = Depends(get_current_user_full)):
    """Return all playlists belonging to the current user."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT PlaylistID, Name, CreatedAt FROM Playlists WHERE UserID = ? ORDER BY CreatedAt DESC",
        (user["UserID"],),
    )
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return [
        {"PlaylistID": r.PlaylistID, "Name": r.Name, "CreatedAt": str(r.CreatedAt)}
        for r in rows
    ]


# ────────────────────────────────────────────────────────────────────
#  POST /api/playlists/{playlist_id}/songs
# ────────────────────────────────────────────────────────────────────

@app.post("/api/playlists/{playlist_id}/songs")
def add_song_to_playlist(
    playlist_id: int,
    body: PlaylistSongAdd,
    user: dict = Depends(get_current_user_full),
):
    """Add a song to one of the current user's playlists."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # ── Ownership check ───────────────────────────────────────────
    cursor.execute(
        "SELECT UserID FROM Playlists WHERE PlaylistID = ?", (playlist_id,)
    )
    row = cursor.fetchone()
    if row is None:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Playlist not found")
    if row.UserID != user["UserID"]:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=403, detail="Access denied")

    # ── Insert (ignore duplicates) ────────────────────────────────
    try:
        cursor.execute(
            "INSERT INTO PlaylistSongs (PlaylistID, SongID) VALUES (?, ?)",
            (playlist_id, body.song_id),
        )
        conn.commit()
    except Exception:
        # Primary-key violation → song already in playlist
        pass

    cursor.close()
    conn.close()
    return {"detail": "Song added to playlist"}


# ────────────────────────────────────────────────────────────────────
#  GET /api/playlists/{playlist_id}/songs
# ────────────────────────────────────────────────────────────────────

@app.get("/api/playlists/{playlist_id}/songs")
def get_playlist_songs(
    playlist_id: int,
    user: dict = Depends(get_current_user_full),
):
    """Return all songs in a playlist (same structure as /api/songs)."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # ── Ownership check ───────────────────────────────────────────
    cursor.execute(
        "SELECT UserID FROM Playlists WHERE PlaylistID = ?", (playlist_id,)
    )
    row = cursor.fetchone()
    if row is None:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Playlist not found")
    if row.UserID != user["UserID"]:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=403, detail="Access denied")

    # ── Join query (same shape as /api/songs) ─────────────────────
    cursor.execute("""
        SELECT
            s.SongID,
            s.Title,
            s.Album,
            s.Duration,
            s.CoverPath,
            s.Bitrate,
            s.SampleRate,
            s.FilePath,
            a.Name AS ArtistName
        FROM Songs s
        INNER JOIN PlaylistSongs ps ON s.SongID = ps.SongID
        LEFT JOIN Song_Artist_Mapping sam ON s.SongID = sam.SongID
        LEFT JOIN Artists a ON sam.ArtistID = a.ArtistID
        WHERE ps.PlaylistID = ?
        ORDER BY s.SongID
    """, (playlist_id,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    base_dir = r"D:\RegularStorage\Music"

    songs: dict[int, dict] = {}
    for row in rows:
        sid = row.SongID
        if sid not in songs:
            try:
                rel = os.path.relpath(row.FilePath, base_dir)
            except ValueError:
                rel = ""
            parts = rel.split(os.sep)
            folder = parts[0] if len(parts) > 1 else ""

            songs[sid] = {
                "SongID": sid,
                "Title": row.Title,
                "Album": row.Album,
                "Duration": row.Duration,
                "CoverPath": get_custom_cover_path(sid) or row.CoverPath,
                "DefaultCoverPath": row.CoverPath,
                "HasCustomCover": bool(get_custom_cover_path(sid)),
                "HasCustomLyrics": get_custom_lyrics_text(sid) is not None,
                "Bitrate": row.Bitrate,
                "SampleRate": row.SampleRate,
                "Folder": folder,
                "Artists": [],
            }
        if row.ArtistName:
            songs[sid]["Artists"].append(row.ArtistName)

    return list(songs.values())


# ────────────────────────────────────────────────────────────────────
#  DELETE /api/playlists/{playlist_id}
# ────────────────────────────────────────────────────────────────────

@app.delete("/api/playlists/{playlist_id}")
def delete_playlist(
    playlist_id: int,
    user: dict = Depends(get_current_user_full),
):
    """Delete a playlist.  Only the owner may delete their own playlist."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Ownership check
    cursor.execute(
        "SELECT UserID FROM Playlists WHERE PlaylistID = ?", (playlist_id,)
    )
    row = cursor.fetchone()
    if row is None:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="歌单不存在")
    if row.UserID != user["UserID"]:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=403, detail="无权删除此歌单")

    cursor.execute("DELETE FROM Playlists WHERE PlaylistID = ?", (playlist_id,))
    conn.commit()
    cursor.close()
    conn.close()
    return {"message": "歌单删除成功"}


# ════════════════════════════════════════════════════════════════════
#  Favorites & Stats endpoints
# ════════════════════════════════════════════════════════════════════

# ────────────────────────────────────────────────────────────────────
#  POST /api/favorites/{song_id}  (toggle red‑heart)
# ────────────────────────────────────────────────────────────────────

@app.post("/api/favorites/{song_id}")
def toggle_favorite(
    song_id: int,
    user: dict = Depends(get_current_user_full),
):
    """Toggle the favorite (red‑heart) status for a song.

    If the user already favourited the song the record is removed;
    otherwise a new favourite row is inserted.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT COUNT(*) FROM Favorites WHERE UserID = ? AND SongID = ?",
        (user["UserID"], song_id),
    )
    exists = cursor.fetchone()[0] > 0

    if exists:
        cursor.execute(
            "DELETE FROM Favorites WHERE UserID = ? AND SongID = ?",
            (user["UserID"], song_id),
        )
        conn.commit()
        cursor.close()
        conn.close()
        return {"is_favorite": False}

    cursor.execute(
        "INSERT INTO Favorites (UserID, SongID) VALUES (?, ?)",
        (user["UserID"], song_id),
    )
    conn.commit()
    cursor.close()
    conn.close()
    return {"is_favorite": True}


# ────────────────────────────────────────────────────────────────────
#  GET /api/favorites  (list favourites — same shape as /api/songs)
# ────────────────────────────────────────────────────────────────────

@app.get("/api/favorites")
def list_favorites(user: dict = Depends(get_current_user_full)):
    """Return all favourite songs for the current user.

    The response shape is identical to ``/api/songs`` (artist
    aggregation included).
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            s.SongID,
            s.Title,
            s.Album,
            s.Duration,
            s.CoverPath,
            s.Bitrate,
            s.SampleRate,
            s.FilePath,
            a.Name AS ArtistName
        FROM Songs s
        INNER JOIN Favorites uf ON s.SongID = uf.SongID
        LEFT JOIN Song_Artist_Mapping sam ON s.SongID = sam.SongID
        LEFT JOIN Artists a ON sam.ArtistID = a.ArtistID
        WHERE uf.UserID = ?
        ORDER BY s.SongID
    """, (user["UserID"],))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    base_dir = r"D:\RegularStorage\Music"

    songs: dict[int, dict] = {}
    for row in rows:
        sid = row.SongID
        if sid not in songs:
            try:
                rel = os.path.relpath(row.FilePath, base_dir)
            except ValueError:
                rel = ""
            parts = rel.split(os.sep)
            folder = parts[0] if len(parts) > 1 else ""

            songs[sid] = {
                "SongID": sid,
                "Title": row.Title,
                "Album": row.Album,
                "Duration": row.Duration,
                "CoverPath": get_custom_cover_path(sid) or row.CoverPath,
                "DefaultCoverPath": row.CoverPath,
                "HasCustomCover": bool(get_custom_cover_path(sid)),
                "HasCustomLyrics": get_custom_lyrics_text(sid) is not None,
                "Bitrate": row.Bitrate,
                "SampleRate": row.SampleRate,
                "Folder": folder,
                "Artists": [],
            }
        if row.ArtistName:
            songs[sid]["Artists"].append(row.ArtistName)

    return list(songs.values())


# ════════════════════════════════════════════════════════════════════
#  Play‑stats endpoints
# ════════════════════════════════════════════════════════════════════

# ────────────────────────────────────────────────────────────────────
#  POST /api/stats/{song_id}  (increment play count)
# ────────────────────────────────────────────────────────────────────

@app.post("/api/stats/{song_id}")
def record_play(
    song_id: int,
    user: dict = Depends(get_current_user_full),
):
    """Record one play for a song.

    Called when the user finishes a track (or after a sufficient
    playback duration).  Inserts a new row or increments the existing
    counter.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT COUNT(*) FROM PlayStats WHERE UserID = ? AND SongID = ?",
        (user["UserID"], song_id),
    )
    exists = cursor.fetchone()[0] > 0

    if exists:
        cursor.execute(
            "UPDATE PlayStats SET play_count = play_count + 1, LastPlayed = GETDATE() WHERE UserID = ? AND SongID = ?",
            (user["UserID"], song_id),
        )
    else:
        cursor.execute(
            "INSERT INTO PlayStats (UserID, SongID, play_count) VALUES (?, ?, 1)",
            (user["UserID"], song_id),
        )

    conn.commit()
    cursor.close()
    conn.close()
    return {"detail": "Play recorded"}


# ────────────────────────────────────────────────────────────────────
#  GET /api/stats/summary  (Top 5 songs & artists)
# ────────────────────────────────────────────────────────────────────

@app.get("/api/stats/summary")
def get_listening_stats(user: dict = Depends(get_current_user_full)):
    """Return the user's top-5 most‑played songs and top-5 most‑played artists."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            s.SongID,
            s.Title,
            s.CoverPath,
            ups.play_count,
            a.Name AS ArtistName
        FROM PlayStats ups
        JOIN Songs s ON ups.SongID = s.SongID
        LEFT JOIN Song_Artist_Mapping sam ON s.SongID = sam.SongID
        LEFT JOIN Artists a ON sam.ArtistID = a.ArtistID
        WHERE ups.UserID = ?
    """, (user["UserID"],))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    if not rows:
        return {"top_songs": [], "top_artists": []}

    artist_counts: dict[str, int] = defaultdict(int)
    song_plays: dict[int, dict] = {}

    for row in rows:
        sid = row.SongID
        if sid not in song_plays:
            song_plays[sid] = {
                "title": row.Title,
                "cover": get_custom_cover_path(sid) or row.CoverPath,
                "default_cover": row.CoverPath,
                "has_custom_cover": bool(get_custom_cover_path(sid)),
                "has_custom_lyrics": get_custom_lyrics_text(sid) is not None,
                "play_count": row.play_count,
            }
        if row.ArtistName:
            artist_counts[row.ArtistName] += row.play_count

    # Sort and take top 5
    top_songs = sorted(
        song_plays.values(), key=lambda x: x["play_count"], reverse=True
    )[:5]

    top_artists = sorted(
        [{"name": k, "play_count": v} for k, v in artist_counts.items()],
        key=lambda x: x["play_count"],
        reverse=True,
    )[:5]

    if not top_artists:
        top_artists = [{"name": "未知歌手", "play_count": 0}]

    return {"top_songs": top_songs, "top_artists": top_artists}


# ────────────────────────────────────────────────────────────────────
#  GET /api/weather  (proxy — hide API key from frontend)
# ────────────────────────────────────────────────────────────────────

@app.get("/api/weather")
async def get_weather_proxy(city: str | None = None, adcode: str | None = None):
    """Proxy weather requests. For China, prefer AMap adcode when provided."""
    if adcode:
        try:
            amap_data = get_amap_weather(AMAP_KEY, adcode)
            has_weather = bool(amap_data.get("weather") or amap_data.get("temperature") or amap_data.get("temp"))
            if has_weather or not city:
                return {
                    "code": 200,
                    "source": "amap",
                    "data": amap_data,
                    **amap_data,
                }
            print(f"AMap weather empty for {adcode}; falling back to city={city}")
        except AMapError as exc:
            if not city:
                raise HTTPException(status_code=502, detail=f"????????: {str(exc)}")

    if not city:
        raise HTTPException(status_code=400, detail="city or adcode is required")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://uapis.cn/api/v1/misc/weather",
                params={"city": city, "token": WEATHER_API_KEY},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"????????: {exc.response.status_code}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"?????????: {str(exc)}")


# ────────────────────────────────────────────────────────────────────
#  GET /api/get-ip-info  (IP geolocation via UAPI — proxy‑aware)
# ────────────────────────────────────────────────────────────────────

@app.get("/api/get-ip-info")
def get_ip_info(request: Request):
    import ipaddress

    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    else:
        client_ip = request.headers.get("X-Real-IP", request.client.host)

    # 1. 检测是否为内网/隧道 IP（Tailscale、VPN、局域网等）
    use_server_ip = False
    try:
        addr = ipaddress.ip_address(client_ip)
        if addr.is_private or addr.is_loopback or addr.is_link_local:
            use_server_ip = True
        # Tailscale / ZeroTier 使用 CGNAT 段 100.64.0.0/10
        elif isinstance(addr, ipaddress.IPv4Address) and addr in ipaddress.IPv4Network("100.64.0.0/10"):
            use_server_ip = True
        # IPv6 ULA (fc00::/7)
        elif isinstance(addr, ipaddress.IPv6Address) and addr.is_private:
            use_server_ip = True
    except ValueError:
        use_server_ip = True  # 无法解析的 IP → 直接用服务器出口

    if use_server_ip:
        print(f"[IP-INFO] 检测到隧道/内网 IP ({client_ip})，改用服务器公网出口定位")

    try:
        token = WEATHER_API_KEY

        # 2. 内网/隧道/VPN → 用 myip 获取服务器公网出口
        if use_server_ip or not client_ip:
            url = "https://uapis.cn/api/v1/network/myip"
        else:
            url = f"https://uapis.cn/api/v1/network/ipv4?ip={client_ip}"

        res = requests.get(url, params={"token": token}, timeout=5).json()

        # 3. 核心修复：把 UAPI 的真实反馈打印到终端！
        print(f"--- UAPI 定位接口调试 ---")
        print(f"访客 IP: {client_ip} | 请求 URL: {url}")
        print(f"UAPI 返回: {res}")
        print(f"-------------------------")

        # 核心修复：兼容 UAPI 的多种返回格式

        # 1. 扁平结构（针对 myip 接口返回的数据）
        if "region" in res:
            # res["region"] 通常是 "中国 江苏 " 或 "中国 江苏 南京"
            # 使用 split 去除多余的空格
            region_parts = [p for p in res.get("region", "").split(" ") if p]

            if len(region_parts) >= 3:
                display_city = f"{region_parts[1]} {region_parts[2]}"
            elif len(region_parts) == 2:
                display_city = region_parts[1]
            elif len(region_parts) == 1:
                display_city = region_parts[0]
            else:
                display_city = "未知地区"

            # 抛弃局域网 IP 伪装，直接显示真实的公网出口 IP
            final_ip = res.get("ip", client_ip)
            return {"ip": final_ip, "city": display_city}

        # 2. 嵌套结构（针对 ipv4 等规范接口返回的数据）
        elif res.get("code") == 200:
            data = res.get("data", {})
            country = data.get("country", "")
            prov = data.get("prov", "")
            city = data.get("city", "")

            if country in ("中国", "CN"):
                display_city = city if prov == city else f"{prov} {city}".strip()
            else:
                display_city = city if city else country

            # 抛弃局域网 IP 伪装，直接显示真实的公网出口 IP
            final_ip = data.get("ip", client_ip)
            return {"ip": final_ip, "city": display_city or "未知"}

        # 3. 兼容更多 UAPI 返回格式
        elif "country" in res or "prov" in res or "city" in res:
            # 扁平混合格式（部分 ipv4 变体）
            parts = []
            for k in ("country", "prov", "city"):
                v = res.get(k, "")
                if v and v not in parts:
                    parts.append(v)
            display_city = " ".join(parts).strip() or "未知"
            final_ip = res.get("ip", client_ip)
            return {"ip": final_ip, "city": display_city}

        # 4. 彻底失败 — 打印完整响应以便排查
        else:
            print(f"[IP-INFO] 未识别的 UAPI 响应格式: {res}")
            error_msg = res.get("msg", res.get("message", "接口数据格式不匹配"))
            return {"ip": client_ip, "city": f"错误: {error_msg}"}

    except Exception as e:
        print(f"UAPI 请求崩溃: {e}")
        return {"ip": client_ip, "city": "网络请求异常"}


# ────────────────────────────────────────────────────────────────────
#  POST /api/library/scan  (manual music library scan trigger)
# ────────────────────────────────────────────────────────────────────

@app.post("/api/library/scan")
def manual_scan(user: dict = Depends(get_current_user)):
    """Trigger a manual scan of the music library.  Admin only."""
    if user.get("role") != "Admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        scan_and_sync()
        return {"message": "音乐库扫描入库完成"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"扫描异常: {str(e)}")


# ────────────────────────────────────────────────────────────────────
#  GET /api/regions  (cascading region data from local JSON)
# ────────────────────────────────────────────────────────────────────

def _clean_region_value(value: str | None) -> str:
    return str(value or "").strip()


def _is_china_region(value: str | None) -> bool:
    return _clean_region_value(value) in {CHINA_NAME, "CN", "China", CHINA_ADCODE}


def _legacy_region_option(value: str, label: str | None = None, **extra):
    native = label or value
    payload = {"value": value, "label": native, "name": native, "native_name": native, "source": "legacy"}
    payload.update({k: v for k, v in extra.items() if v not in (None, "")})
    return payload


def _enrich_amap_option(item: dict) -> dict:
    payload = dict(item)
    adcode = _clean_region_value(payload.get("adcode") or payload.get("value"))
    level = _clean_region_value(payload.get("level")) or "region"
    payload["source"] = "amap"
    payload["value"] = adcode or payload.get("name") or payload.get("label") or ""
    payload["label"] = payload.get("label") or payload.get("name") or payload["value"]
    payload["name"] = payload.get("name") or payload["label"]
    payload.setdefault("native_name", payload["name"])
    payload["country"] = CHINA_NAME
    payload["country_code"] = "CN"
    payload["terminal"] = level == "district"
    payload["has_children"] = level in {"country", "province", "city"}
    if level == "country":
        payload["next_level"] = "province"
    elif level == "province":
        is_direct = len(adcode) == 6 and adcode[:2] in {"11", "12", "31", "50", "81", "82"} and adcode[2:] == "0000"
        payload["is_direct_admin"] = is_direct
        payload["next_level"] = "district" if is_direct else "city"
    elif level == "city":
        payload["next_level"] = "district"
    else:
        payload["next_level"] = ""
    return payload


def _region_options_response(items: list[dict], options_mode: bool):
    if options_mode:
        return items
    return [item.get("name") or item.get("label") or item.get("value") for item in items]


@app.post("/api/regions/translate")
def translate_regions_endpoint(body: RegionTranslateRequest):
    texts = [str(item or "").strip() for item in (body.texts or []) if str(item or "").strip()]
    texts = texts[:300]
    return {"translations": _translate_region_names(texts, body.lang, strict=False)}


@app.get("/api/regions/status")
def get_regions_status():
    return {
        "amap_enabled": bool(AMAP_KEY),
        "china_primary_source": "AMap adcode",
        "geonames_db_available": has_geonames_db(),
        "legacy_country_count": len(GLOBAL_REGIONS),
    }


@app.get("/api/regions/resolve")
def resolve_region(adcode: str | None = None, value: str | None = None):
    target = adcode or value
    if not target:
        raise HTTPException(status_code=400, detail="adcode or value is required")
    try:
        resolved = resolve_amap_location(AMAP_KEY, target)
        return {
            key: _enrich_amap_option(val) if isinstance(val, dict) else val
            for key, val in resolved.items()
        }
    except AMapError as exc:
        raise HTTPException(status_code=502, detail=f"AMap resolve failed: {str(exc)}")


@app.get("/api/regions/search")
def search_regions_endpoint(
    q: str,
    lang: str | None = None,
    country: str | None = None,
    province: str | None = None,
    city: str | None = None,
    limit: int = 20,
):
    limit = max(1, min(int(limit or 20), 50))
    results: list[dict] = []
    seen: set[str] = set()

    if not country or _is_china_region(country):
        for item in search_amap_with_context(AMAP_KEY, q, country, province, city, limit):
            enriched = _enrich_amap_option(item)
            results.append(enriched)

    for item in search_geonames_regions(GLOBAL_REGIONS, q, lang, None if _is_china_region(country) else country, limit):
        payload = dict(item)
        payload.setdefault("source", "geonames")
        payload.setdefault("native_name", payload.get("city") or payload.get("weather_name") or payload.get("name") or payload.get("label"))
        results.append(payload)

    return _display_region_options(_dedupe_region_search_results(results, limit), lang)


@app.get("/api/regions")
def get_regions(
    country: str | None = None,
    province: str | None = None,
    city: str | None = None,
    lang: str | None = None,
    format: str | None = None,
):
    """Return cascading region data. China uses AMap adcodes; legacy JSON remains fallback."""
    options_mode = (format or "").lower() == "options" or lang is not None or city is not None or _is_china_region(country)

    if country is None:
        countries = sorted(GLOBAL_REGIONS.keys())
        if options_mode:
            items = []
            if CHINA_NAME in GLOBAL_REGIONS:
                items.append(_enrich_amap_option(china_root_option()))
            items.extend(_legacy_region_option(c, c, country_code=("CN" if c == CHINA_NAME else "")) for c in countries if c != CHINA_NAME)
            return _display_region_options(items, lang)
        return countries

    if _is_china_region(country):
        try:
            if not province:
                return _display_region_options([_enrich_amap_option(item) for item in china_province_options(AMAP_KEY)], lang)
            if not city:
                return _display_region_options([_enrich_amap_option(item) for item in amap_child_options(AMAP_KEY, province)], lang)
            return _display_region_options([_enrich_amap_option(item) for item in amap_child_options(AMAP_KEY, city)], lang)
        except AMapError as exc:
            raise HTTPException(status_code=502, detail=f"AMap regions failed: {str(exc)}")

    country_data = GLOBAL_REGIONS.get(country)
    if country_data is None:
        fallback = _geonames_fallback_region_options(country, province, lang)
        if fallback:
            return _region_options_response(fallback, options_mode)
        raise HTTPException(status_code=404, detail=f"Unknown country: {country}")
    if province is None:
        items = [_legacy_region_option(p, p, level="province", has_children=True, next_level="city") for p in sorted(country_data.keys())]
        if items:
            return _region_options_response(_display_region_options(items, lang), options_mode)
        fallback = _geonames_fallback_region_options(country, None, lang)
        return _region_options_response(fallback, options_mode)
    cities = country_data.get(province)
    if cities is None:
        fallback = _geonames_fallback_region_options(country, province, lang)
        if fallback:
            return _region_options_response(fallback, options_mode)
        raise HTTPException(status_code=404, detail=f"Unknown province: {province} in {country}")
    items = [_legacy_region_option(c, c, level="city", has_children=False, terminal=True) for c in cities]
    if items:
        return _region_options_response(_display_region_options(items, lang), options_mode)
    fallback = _geonames_fallback_region_options(country, province, lang)
    return _region_options_response(fallback, options_mode)


# ────────────────────────────────────────────────────────────────────
#  GET /api/songs  (multi-table JOIN, artists aggregated)
# ────────────────────────────────────────────────────────────────────

@app.get("/api/songs")
def list_songs(user: dict = Depends(get_current_user)):
    """Return every song with its artist list aggregated."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            s.SongID,
            s.Title,
            s.Album,
            s.Duration,
            s.CoverPath,
            s.Bitrate,
            s.SampleRate,
            s.FilePath,
            a.Name AS ArtistName
        FROM Songs s
        LEFT JOIN Song_Artist_Mapping sam ON s.SongID = sam.SongID
        LEFT JOIN Artists a ON sam.ArtistID = a.ArtistID
    """)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    base_dir = r"D:\RegularStorage\Music"

    # Aggregate artists per song in Python
    songs: dict[int, dict] = {}
    for row in rows:
        sid = row.SongID
        if sid not in songs:
            # Compute folder relative to base_dir
            try:
                rel = os.path.relpath(row.FilePath, base_dir)
            except ValueError:
                rel = ""
            parts = rel.split(os.sep)
            folder = parts[0] if len(parts) > 1 else ""

            songs[sid] = {
                "SongID": sid,
                "Title": row.Title,
                "Album": row.Album,
                "Duration": row.Duration,
                "CoverPath": get_custom_cover_path(sid) or row.CoverPath,
                "DefaultCoverPath": row.CoverPath,
                "HasCustomCover": bool(get_custom_cover_path(sid)),
                "HasCustomLyrics": get_custom_lyrics_text(sid) is not None,
                "Bitrate": row.Bitrate,
                "SampleRate": row.SampleRate,
                "Folder": folder,
                "Artists": [],
            }
        if row.ArtistName:
            songs[sid]["Artists"].append(row.ArtistName)

    return list(songs.values())


# ────────────────────────────────────────────────────────────────────
#  GET /api/lyrics/{song_id}
# ────────────────────────────────────────────────────────────────────


# -------------------------------------------------------------------
#  Announcement endpoints
# -------------------------------------------------------------------

@app.get("/api/announcements")
def list_announcements(user: dict = Depends(get_current_user_full)):
    """List announcements visible to the current user; admins see all active announcements."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if is_admin_user(user):
            cursor.execute("""
                SELECT a.AnnouncementID, a.SenderUserID, a.TargetUserID, a.Title, a.Body, a.BodyFormat,
                       a.IsPinned, a.IsDeleted, a.CreatedAt, a.UpdatedAt,
                       su.Username AS SenderUsername, su.Nickname AS SenderNickname,
                       tu.Username AS TargetUsername, tu.Nickname AS TargetNickname
                FROM Announcements a
                LEFT JOIN Users su ON su.UserID = a.SenderUserID
                LEFT JOIN Users tu ON tu.UserID = a.TargetUserID
                WHERE a.IsDeleted = 0
                ORDER BY a.IsPinned DESC, a.UpdatedAt DESC, a.AnnouncementID DESC
            """)
        else:
            cursor.execute("""
                SELECT a.AnnouncementID, a.SenderUserID, a.TargetUserID, a.Title, a.Body, a.BodyFormat,
                       a.IsPinned, a.IsDeleted, a.CreatedAt, a.UpdatedAt,
                       su.Username AS SenderUsername, su.Nickname AS SenderNickname,
                       tu.Username AS TargetUsername, tu.Nickname AS TargetNickname
                FROM Announcements a
                LEFT JOIN Users su ON su.UserID = a.SenderUserID
                LEFT JOIN Users tu ON tu.UserID = a.TargetUserID
                WHERE a.IsDeleted = 0 AND (a.TargetUserID IS NULL OR a.TargetUserID = ?)
                ORDER BY a.IsPinned DESC, a.UpdatedAt DESC, a.AnnouncementID DESC
            """, (user["UserID"],))
        rows = cursor.fetchall()
        return [build_announcement_payload(row, []) for row in rows]
    finally:
        cursor.close()
        conn.close()


@app.post("/api/announcements")
async def create_announcement(
    title: str = Form(...),
    body: str = Form(""),
    body_format: str = Form("markdown"),
    target_user_id: str = Form(""),
    is_pinned: str = Form("false"),
    attachments: list[UploadFile] | None = File(None),
    user: dict = Depends(get_current_user_full),
):
    """Admin creates an announcement for all users or one user."""
    require_admin(user)
    clean_title = (title or "").strip()[:200]
    clean_body = (body or "").strip()
    target_id = parse_optional_int(target_user_id)
    pinned = parse_form_bool(is_pinned)
    validate_announcement_body_size(clean_body)
    has_files = bool([f for f in (attachments or []) if f and (f.filename or "").strip()])
    if not clean_title:
        raise HTTPException(status_code=400, detail="请填写公告标题")
    if not clean_body and not has_files:
        raise HTTPException(status_code=400, detail="请填写公告内容或上传附件")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        ensure_announcement_target_user(cursor, target_id)
        cursor.execute("""
            INSERT INTO Announcements
                (SenderUserID, TargetUserID, Title, Body, BodyFormat, IsPinned, IsDeleted, CreatedAt, UpdatedAt)
            OUTPUT INSERTED.AnnouncementID
            VALUES (?, ?, ?, ?, ?, ?, 0, SYSUTCDATETIME(), SYSUTCDATETIME())
        """, (
            user["UserID"], target_id, clean_title, clean_body,
            normalize_announcement_body_format(body_format), 1 if pinned else 0,
        ))
        announcement_id = int(cursor.fetchone()[0])
        await save_announcement_attachments(cursor, announcement_id, attachments)
        conn.commit()
        row = fetch_announcement_for_access(cursor, announcement_id, user)
        return build_announcement_payload(row, list_announcement_attachments(cursor, announcement_id))
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        print(f"create_announcement failed: {exc}")
        raise HTTPException(status_code=500, detail="公告创建失败")
    finally:
        cursor.close()
        conn.close()


@app.get("/api/announcements/{announcement_id}")
def get_announcement_detail(announcement_id: int, user: dict = Depends(get_current_user_full)):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        row = fetch_announcement_for_access(cursor, announcement_id, user)
        return build_announcement_payload(row, list_announcement_attachments(cursor, announcement_id))
    finally:
        cursor.close()
        conn.close()


@app.put("/api/announcements/{announcement_id}/pin")
def update_announcement_pin(
    announcement_id: int,
    body: AnnouncementPinUpdate,
    user: dict = Depends(get_current_user_full),
):
    require_admin(user)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        fetch_announcement_for_access(cursor, announcement_id, user)
        cursor.execute("""
            UPDATE Announcements
            SET IsPinned = ?, UpdatedAt = SYSUTCDATETIME()
            WHERE AnnouncementID = ? AND IsDeleted = 0
        """, (1 if body.is_pinned else 0, announcement_id))
        conn.commit()
        row = fetch_announcement_for_access(cursor, announcement_id, user)
        return build_announcement_payload(row, list_announcement_attachments(cursor, announcement_id))
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        print(f"update_announcement_pin failed: {exc}")
        raise HTTPException(status_code=500, detail="公告置顶状态更新失败")
    finally:
        cursor.close()
        conn.close()


@app.delete("/api/announcements/{announcement_id}")
def delete_announcement(announcement_id: int, user: dict = Depends(get_current_user_full)):
    require_admin(user)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        fetch_announcement_for_access(cursor, announcement_id, user)
        cursor.execute("""
            UPDATE Announcements
            SET IsDeleted = 1, IsPinned = 0, UpdatedAt = SYSUTCDATETIME(), DeletedAt = SYSUTCDATETIME()
            WHERE AnnouncementID = ? AND IsDeleted = 0
        """, (announcement_id,))
        conn.commit()
        return {"detail": "Announcement deleted", "announcement_id": announcement_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        print(f"delete_announcement failed: {exc}")
        raise HTTPException(status_code=500, detail="公告创建失败")
    finally:
        cursor.close()
        conn.close()


@app.get("/api/announcement-attachments/{attachment_id}")
def get_announcement_attachment(attachment_id: int, user: dict = Depends(get_current_user_full)):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT att.AttachmentID, att.AnnouncementID, att.OriginalName, att.StoredName, att.ContentType,
                   a.TargetUserID, a.IsDeleted
            FROM AnnouncementAttachments att
            INNER JOIN Announcements a ON a.AnnouncementID = att.AnnouncementID
            WHERE att.AttachmentID = ?
        """, (attachment_id,))
        row = cursor.fetchone()
        if row is None or bool(row.IsDeleted):
            raise HTTPException(status_code=404, detail="Attachment not found")
        if not (is_admin_user(user) or row.TargetUserID is None or int(row.TargetUserID) == int(user["UserID"])):
            raise HTTPException(status_code=403, detail="No access to this attachment")
        file_path = resolve_announcement_attachment_path(int(row.AnnouncementID), row.StoredName)
        if not os.path.isfile(file_path):
            raise HTTPException(status_code=404, detail="Attachment file is missing")
        return FileResponse(
            file_path,
            media_type=row.ContentType or "application/octet-stream",
            filename=row.OriginalName or "attachment",
        )
    finally:
        cursor.close()
        conn.close()


# -------------------------------------------------------------------
#  Support ticket endpoints
# -------------------------------------------------------------------

@app.post("/api/tickets")
async def create_support_ticket(
    title: str = Form(...),
    body: str = Form(...),
    body_format: str = Form("markdown"),
    attachments: list[UploadFile] | None = File(None),
    user: dict = Depends(get_current_user_full),
):
    """Create a user support ticket with optional media attachments."""
    assert_current_user_scope(user, "ticket.create")
    has_files = bool([f for f in (attachments or []) if f and (f.filename or "").strip()])
    if has_files:
        assert_current_user_scope(user, "ticket.upload")
    clean_title = (title or "").strip()[:200]
    clean_body = (body or "").strip()
    validate_ticket_body_size(clean_body)
    if not clean_title:
        raise HTTPException(status_code=400, detail="\u8bf7\u586b\u5199\u5de5\u5355\u6807\u9898")
    if not clean_body and not has_files:
        raise HTTPException(status_code=400, detail="\u8bf7\u586b\u5199\u95ee\u9898\u63cf\u8ff0\u6216\u4e0a\u4f20\u9644\u4ef6")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO SupportTickets (UserID, Title, Status, CreatedAt, UpdatedAt)
            OUTPUT INSERTED.TicketID
            VALUES (?, ?, 'pending', SYSUTCDATETIME(), SYSUTCDATETIME())
        """, (user["UserID"], clean_title))
        ticket_id = int(cursor.fetchone()[0])
        cursor.execute("""
            INSERT INTO SupportTicketMessages (TicketID, UserID, AuthorRole, Body, BodyFormat, Result, CreatedAt)
            OUTPUT INSERTED.MessageID
            VALUES (?, ?, ?, ?, ?, NULL, SYSUTCDATETIME())
        """, (ticket_id, user["UserID"], user.get("Role", "User"), clean_body or "", normalize_ticket_body_format(body_format)))
        message_id = int(cursor.fetchone()[0])
        await save_ticket_attachments(
            cursor, ticket_id, message_id, user["UserID"], attachments, enforce_user_limits=True
        )
        conn.commit()
        return build_ticket_detail(cursor, ticket_id, user)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        print(f"create_support_ticket failed: {exc}")
        raise HTTPException(status_code=500, detail="\u5de5\u5355\u521b\u5efa\u5931\u8d25")
    finally:
        cursor.close()
        conn.close()


@app.get("/api/tickets")
def list_support_tickets(user: dict = Depends(get_current_user_full)):
    """List current user's tickets; admins see all tickets."""
    is_admin = user.get("Role") == "Admin" or user.get("role") == "Admin"
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        where_sql = "" if is_admin else "WHERE t.UserID = ?"
        params = () if is_admin else (user["UserID"],)
        cursor.execute(f"""
            SELECT t.TicketID, t.UserID, t.Title, t.Status, t.CreatedAt, t.UpdatedAt, t.ClosedAt,
                   u.Username, u.Nickname,
                   COUNT(m.MessageID) AS MessageCount,
                   MAX(m.CreatedAt) AS LastMessageAt
            FROM SupportTickets t
            LEFT JOIN Users u ON u.UserID = t.UserID
            LEFT JOIN SupportTicketMessages m ON m.TicketID = t.TicketID
            {where_sql}
            GROUP BY t.TicketID, t.UserID, t.Title, t.Status, t.CreatedAt, t.UpdatedAt, t.ClosedAt, u.Username, u.Nickname
            ORDER BY t.UpdatedAt DESC, t.TicketID DESC
        """, params)
        rows = cursor.fetchall()
        return [{
            "ticket_id": int(row.TicketID),
            "user_id": int(row.UserID),
            "title": row.Title,
            "status": row.Status,
            "status_label": get_ticket_status_label(row.Status),
            "created_at": serialize_datetime(row.CreatedAt),
            "updated_at": serialize_datetime(row.UpdatedAt),
            "closed_at": serialize_datetime(row.ClosedAt),
            "last_message_at": serialize_datetime(row.LastMessageAt),
            "message_count": int(row.MessageCount or 0),
            "username": row.Username,
            "nickname": row.Nickname or row.Username,
        } for row in rows]
    finally:
        cursor.close()
        conn.close()


@app.get("/api/tickets/{ticket_id}")
def get_support_ticket(ticket_id: int, user: dict = Depends(get_current_user_full)):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        return build_ticket_detail(cursor, ticket_id, user)
    finally:
        cursor.close()
        conn.close()


@app.post("/api/tickets/{ticket_id}/messages")
async def add_support_ticket_message(
    ticket_id: int,
    body: str = Form(""),
    body_format: str = Form("markdown"),
    result: str | None = Form(None),
    attachments: list[UploadFile] | None = File(None),
    user: dict = Depends(get_current_user_full),
):
    """Add a user supplement or an admin reply to a support ticket."""
    assert_current_user_scope(user, "ticket.reply")
    clean_body = (body or "").strip()
    validate_ticket_body_size(clean_body)
    has_files = bool([f for f in (attachments or []) if f and (f.filename or "").strip()])
    if has_files:
        assert_current_user_scope(user, "ticket.upload")
    if not clean_body and not has_files:
        raise HTTPException(status_code=400, detail="\u8bf7\u586b\u5199\u56de\u590d\u5185\u5bb9\u6216\u4e0a\u4f20\u9644\u4ef6")

    is_admin = user.get("Role") == "Admin" or user.get("role") == "Admin"
    normalized_result = (result or "").strip() or None
    if normalized_result and normalized_result not in TICKET_RESULT_TO_STATUS:
        raise HTTPException(status_code=400, detail="\u672a\u77e5\u7684\u5de5\u5355\u5904\u7406\u7ed3\u679c")
    if normalized_result and not is_admin:
        raise HTTPException(status_code=403, detail="\u53ea\u6709\u7ba1\u7406\u5458\u53ef\u4ee5\u8bbe\u7f6e\u5904\u7406\u7ed3\u679c")

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        ticket = fetch_ticket_for_access(cursor, ticket_id, user)
        if ticket["status"] in ("resolved", "rejected"):
            raise HTTPException(status_code=400, detail="\u8be5\u5de5\u5355\u5df2\u7ed3\u675f\uff0c\u4e0d\u80fd\u7ee7\u7eed\u56de\u590d")
        if not is_admin and ticket["status"] not in ("pending", "in_progress"):
            raise HTTPException(status_code=400, detail="\u8be5\u5de5\u5355\u5df2\u7ed3\u675f\uff0c\u4e0d\u80fd\u7ee7\u7eed\u8865\u5145")

        cursor.execute("""
            INSERT INTO SupportTicketMessages (TicketID, UserID, AuthorRole, Body, BodyFormat, Result, CreatedAt)
            OUTPUT INSERTED.MessageID
            VALUES (?, ?, ?, ?, ?, ?, SYSUTCDATETIME())
        """, (
            ticket_id,
            user["UserID"],
            "Admin" if is_admin else "User",
            clean_body or "",
            normalize_ticket_body_format(body_format),
            normalized_result,
        ))
        message_id = int(cursor.fetchone()[0])
        await save_ticket_attachments(
            cursor,
            ticket_id,
            message_id,
            user["UserID"],
            attachments,
            enforce_user_limits=not is_admin,
        )

        if is_admin and normalized_result:
            new_status = TICKET_RESULT_TO_STATUS[normalized_result]
            if new_status in ("resolved", "rejected"):
                cursor.execute("""
                    UPDATE SupportTickets
                    SET Status = ?, UpdatedAt = SYSUTCDATETIME(), ClosedAt = SYSUTCDATETIME()
                    WHERE TicketID = ?
                """, (new_status, ticket_id))
            else:
                cursor.execute("""
                    UPDATE SupportTickets
                    SET Status = ?, UpdatedAt = SYSUTCDATETIME(), ClosedAt = NULL
                    WHERE TicketID = ?
                """, (new_status, ticket_id))
        else:
            cursor.execute("""
                UPDATE SupportTickets
                SET UpdatedAt = SYSUTCDATETIME()
                WHERE TicketID = ?
            """, (ticket_id,))

        conn.commit()
        return build_ticket_detail(cursor, ticket_id, user)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        print(f"add_support_ticket_message failed: {exc}")
        raise HTTPException(status_code=500, detail="\u5de5\u5355\u56de\u590d\u5931\u8d25")
    finally:
        cursor.close()
        conn.close()


@app.get("/api/ticket-attachments/{attachment_id}")
def get_ticket_attachment(attachment_id: int, user: dict = Depends(get_current_user_full)):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT a.AttachmentID, a.TicketID, a.MessageID, a.OriginalName, a.StoredName, a.ContentType,
                   t.UserID AS TicketOwnerID
            FROM SupportTicketAttachments a
            INNER JOIN SupportTickets t ON t.TicketID = a.TicketID
            WHERE a.AttachmentID = ?
        """, (attachment_id,))
        row = cursor.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Attachment not found")
        is_admin = user.get("Role") == "Admin" or user.get("role") == "Admin"
        if not is_admin and int(row.TicketOwnerID) != int(user["UserID"]):
            raise HTTPException(status_code=403, detail="No access to this attachment")
        file_path = resolve_ticket_attachment_path(int(row.TicketID), int(row.MessageID), row.StoredName)
        if not os.path.isfile(file_path):
            raise HTTPException(status_code=404, detail="Attachment file is missing")
        return FileResponse(
            file_path,
            media_type=row.ContentType or "application/octet-stream",
            filename=row.OriginalName or "attachment",
        )
    finally:
        cursor.close()
        conn.close()


@app.get("/api/custom-assets/{song_id}")
def get_custom_assets(song_id: int, user: dict = Depends(get_current_user)):
    """Return custom asset status for one song. Custom assets are global per song."""
    return build_custom_asset_payload(song_id)


@app.post("/api/custom-assets/{song_id}/cover")
async def upload_custom_cover(
    song_id: int,
    cover: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Save a global custom cover under backend/custom_covers/song_<id>.<ext>."""
    require_admin(user)
    song = ensure_song_exists(song_id)

    content_type = (cover.content_type or "").lower()
    ext = CUSTOM_COVER_CONTENT_TYPES.get(content_type)
    if ext is None:
        original_ext = os.path.splitext(cover.filename or "")[1].lower()
        if original_ext in CUSTOM_COVER_EXTS:
            ext = ".jpg" if original_ext == ".jpeg" else original_ext
        else:
            raise HTTPException(status_code=400, detail="Only JPG, PNG, WebP, or GIF covers are supported")

    data = await cover.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded cover is empty")
    if len(data) > CUSTOM_COVER_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Cover file is too large")

    remove_custom_cover_files(song_id)
    file_path = os.path.join(CUSTOM_COVERS_DIR, f"song_{song_id}{ext}")
    with open(file_path, "wb") as f:
        f.write(data)

    cover_path = f"/custom-covers/song_{song_id}{ext}"
    return {
        "song_id": song_id,
        "cover_path": cover_path,
        "default_cover_path": song["CoverPath"],
        "has_custom_cover": True,
    }


@app.delete("/api/custom-assets/{song_id}/cover")
def delete_custom_cover(song_id: int, user: dict = Depends(get_current_user)):
    """Remove global custom cover and fall back to the database/default cover."""
    require_admin(user)
    song = ensure_song_exists(song_id)
    remove_custom_cover_files(song_id)
    return {
        "song_id": song_id,
        "cover_path": song["CoverPath"],
        "default_cover_path": song["CoverPath"],
        "has_custom_cover": False,
    }


@app.put("/api/custom-assets/{song_id}/lyrics")
def save_custom_lyrics(
    song_id: int,
    body: CustomLyricsUpdate,
    user: dict = Depends(get_current_user),
):
    """Save global custom lyrics as UTF-8 LRC text under backend/custom_lyrics."""
    require_admin(user)
    ensure_song_exists(song_id)
    lyrics_text = (body.lyrics or "").strip()
    path = get_custom_lyrics_path(song_id)
    if not lyrics_text:
        if os.path.isfile(path):
            os.remove(path)
        return {"song_id": song_id, "has_custom_lyrics": False, "custom_lyrics": ""}
    if len(lyrics_text.encode("utf-8")) > CUSTOM_LYRICS_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Lyrics text is too large")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(lyrics_text + "\n")
    return {"song_id": song_id, "has_custom_lyrics": True, "custom_lyrics": lyrics_text}


@app.delete("/api/custom-assets/{song_id}/lyrics")
def delete_custom_lyrics(song_id: int, user: dict = Depends(get_current_user)):
    """Remove global custom lyrics and fall back to cached/fetched default lyrics."""
    require_admin(user)
    ensure_song_exists(song_id)
    path = get_custom_lyrics_path(song_id)
    if os.path.isfile(path):
        os.remove(path)
    return {"song_id": song_id, "has_custom_lyrics": False, "custom_lyrics": ""}


@app.get("/api/lyrics/{song_id}")
def lyrics(song_id: int, user: dict = Depends(get_current_user)):
    """Return global custom lyrics first; otherwise return normal cached/fetched lyrics."""
    custom_lyrics = get_custom_lyrics_text(song_id)
    if custom_lyrics is not None:
        return {"song_id": song_id, "lyrics": custom_lyrics, "source": "custom"}
    lyrics_text = get_or_fetch_lyrics(song_id)
    if lyrics_text is None:
        return {"song_id": song_id, "lyrics": None, "source": "default"}
    return {"song_id": song_id, "lyrics": lyrics_text, "source": "default"}


# ────────────────────────────────────────────────────────────────────
#  GET /api/stream/{song_id}  (HTTP 206 Partial Content)
# ────────────────────────────────────────────────────────────────────

DEFAULT_RANGE_CHUNK = 2 * 1024 * 1024  # 2 MB per chunk when no end given


@app.get("/api/song_info/{song_id}")
async def get_song_info(song_id: int, token: str | None = None):
    """Return real audio metadata from ffprobe for the quality selector."""
    get_user_from_query_token(token, "stream")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT FilePath FROM Songs WHERE SongID = ?", (song_id,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if row is None:
        raise HTTPException(status_code=404, detail="Song not found")

    file_path = row.FilePath
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File missing on disk")

    try:
        cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", "-show_format", file_path
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="ignore")
        data = json.loads(result.stdout)

        # 精准提取音频流
        audio_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
        if not audio_stream:
            raise HTTPException(status_code=400, detail="未找到音频流")

        codec_name = audio_stream.get("codec_name", "")
        sample_rate = int(audio_stream.get("sample_rate", 0))

        # 位深字段兼容 flac(bits_per_sample) / 部分格式(bits_per_raw_sample)
        bits_per_sample = audio_stream.get("bits_per_raw_sample") or audio_stream.get("bits_per_sample") or 16
        bits_per_sample = int(bits_per_sample)

        # 整体码率优先从 format 节点取
        bit_rate = data.get("format", {}).get("bit_rate") or audio_stream.get("bit_rate") or 0
        bit_rate = int(bit_rate)

        is_lossless = codec_name.lower() in ['flac', 'alac', 'wav', 'ape']

        return {
            "codec_name": codec_name,
            "sample_rate": sample_rate,
            "bit_rate": bit_rate,
            "bits_per_sample": bits_per_sample,
            "is_lossless": is_lossless,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"探针读取失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stream/{song_id}")
def stream_song(song_id: int, request: Request, token: str | None = None):
    """Serve an audio file with HTTP 206 Range support.

    - No ``Range`` header → 200 OK, stream the entire file.
    - ``Range: bytes=0-`` → 206 Partial Content, serve the first 2 MB
      (browser will issue follow‑up requests for the rest).
    - ``Range: bytes=1024-2047`` → 206, serve that exact byte range.
    """
    get_user_from_query_token(token, "stream")
    # ── Look up file path ─────────────────────────────────────────
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT FilePath FROM Songs WHERE SongID = ?", (song_id,))
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if row is None:
        raise HTTPException(status_code=404, detail="Song not found")

    file_path = row.FilePath
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File missing on disk")

    file_size = os.path.getsize(file_path)

    # ── Determine MIME type ────────────────────────────────────────
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type is None:
        mime_type = "audio/mpeg"

    # ── Parse Range header ─────────────────────────────────────────
    range_header = request.headers.get("range")

    if not range_header:
        # ── No Range → 200 OK, stream full file ────────────────────
        def full_file_iterator():
            with open(file_path, "rb") as f:
                while True:
                    data = f.read(DEFAULT_RANGE_CHUNK)
                    if not data:
                        break
                    yield data

        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": mime_type,
            "Access-Control-Allow-Origin": "*",
        }
        return StreamingResponse(
            full_file_iterator(),
            status_code=200,
            headers=headers,
            media_type=mime_type,
        )

    # ── Range header present → parse start / end ───────────────────
    try:
        range_value = range_header.strip().replace("bytes=", "")
        parts = range_value.split("-", 1)

        start = int(parts[0]) if parts[0] else 0

        if parts[1]:
            end = int(parts[1])
        else:
            # Browser didn't provide an end → serve 2 MB from start
            end = min(start + DEFAULT_RANGE_CHUNK - 1, file_size - 1)

        if start >= file_size:
            raise HTTPException(status_code=416, detail="Range not satisfiable")

        # Clamp end to the last byte
        if end >= file_size:
            end = file_size - 1

    except (ValueError, IndexError):
        # Malformed header → fall back to serving the full file
        start = 0
        end = file_size - 1

    chunk_length = end - start + 1

    # ── Byte‑range generator ───────────────────────────────────────
    def range_file_iterator():
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = chunk_length
            while remaining > 0:
                read_size = min(DEFAULT_RANGE_CHUNK, remaining)
                data = f.read(read_size)
                if not data:
                    break
                remaining -= len(data)
                yield data

    # ── 206 headers ────────────────────────────────────────────────
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(chunk_length),
        "Content-Type": mime_type,
        "Access-Control-Allow-Origin": "*",
    }

    return StreamingResponse(
        range_file_iterator(),
        status_code=206,
        headers=headers,
        media_type=mime_type,
    )


# ────────────────────────────────────────────────────────────────────
#  Entry point
# ────────────────────────────────────────────────────────────────────

# ── Mount frontend static site (must be last to avoid shadowing /api) ─
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
