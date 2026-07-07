import os
import subprocess
import uuid
import json
import shutil
import mimetypes
from collections import defaultdict
from contextlib import asynccontextmanager

from dotenv import load_dotenv
import httpx
import requests
from apscheduler.schedulers.background import BackgroundScheduler

# ── Load .env file at startup ───────────────────────────────────────
load_dotenv()
from auth import verify_password, create_access_token, get_password_hash
from fastapi import FastAPI, HTTPException, Request, Depends, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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

        conn.commit()
        print("Database schema migration checked — Country/Province/City columns ready.")
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
REGIONS_FILE = os.path.join(os.path.dirname(__file__), "global_regions.json")
with open(REGIONS_FILE, "r", encoding="utf-8") as f:
    GLOBAL_REGIONS = json.load(f)
print(f"Loaded {len(GLOBAL_REGIONS)} countries from global_regions.json")

# ── Static files mount ────────────────────────────────────────────
app.mount("/covers", StaticFiles(directory="covers"), name="covers")

AVATARS_DIR = os.path.join(os.path.dirname(__file__), "avatars")
os.makedirs(AVATARS_DIR, exist_ok=True)
app.mount("/avatars", StaticFiles(directory="avatars"), name="avatars")

# ── CORS middleware ────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],                   # allow all origins in dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


class UserCreate(BaseModel):
    username: str
    password: str
    nickname: str
    role: str = "User"


class PlaylistCreate(BaseModel):
    name: str


class PlaylistSongAdd(BaseModel):
    song_id: int


class LocationUpdate(BaseModel):
    country: str
    province: str
    city: str
    district: str | None = None


# ────────────────────────────────────────────────────────────────────
#  Auth dependency
# ────────────────────────────────────────────────────────────────────

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """Extract and validate the Bearer token.  Returns the decoded payload."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    token = credentials.credentials
    try:
        payload = decode_token(token)
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_current_user_full(
    user: dict = Depends(get_current_user),
) -> dict:
    """Return the full user row (UserID, Username, Nickname, AvatarUrl, Role)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT UserID, Username, Nickname, AvatarUrl, Role, Country, Province, City, District FROM Users WHERE Username = ?",
        (user["sub"],),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if row is None:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "UserID": row.UserID,
        "Username": row.Username,
        "Nickname": row.Nickname or row.Username,
        "AvatarUrl": row.AvatarUrl,
        "Role": row.Role,
        "Country": row.Country or "中国",
        "Province": row.Province or "北京",
        "City": row.City or "北京",
        "District": row.District or "",
    }


# ────────────────────────────────────────────────────────────────────
#  POST /api/auth/login
# ────────────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
def login(body: LoginRequest):
    """Authenticate a user and return access + refresh tokens."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT Username, PasswordHash, Role, IsActive FROM Users WHERE Username = ?",
        (body.username,),
    )
    row = cursor.fetchone()
    cursor.close()
    conn.close()

    if row is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    username, password_hash, role, is_active = row

    if not is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    if not verify_password(body.password, password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    access_token = create_access_token(data={"sub": username, "role": role})
    refresh_token = create_refresh_token(data={"sub": username, "role": role})

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "role": role,
    }


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

    new_access = create_access_token(
        data={"sub": payload["sub"], "role": payload.get("role", "User")}
    )
    new_refresh = create_refresh_token(
        data={"sub": payload["sub"], "role": payload.get("role", "User")}
    )

    return {
        "access_token": new_access,
        "refresh_token": new_refresh,
        "token_type": "bearer",
    }


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
    """Persist the user's preferred weather region."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE Users SET Country = ?, Province = ?, City = ?, District = ? WHERE UserID = ?",
        (body.country, body.province, body.city, body.district or "", user["UserID"]),
    )
    conn.commit()
    cursor.close()
    conn.close()
    return {"detail": "Location updated", "city": body.city, "district": body.district or ""}


# ────────────────────────────────────────────────────────────────────
#  POST /api/users/me/avatar
# ────────────────────────────────────────────────────────────────────

@app.post("/api/users/me/avatar")
async def upload_avatar(
    avatar: UploadFile = File(...),
    user: dict = Depends(get_current_user_full),
):
    """Upload a new avatar image for the current user."""
    # Build unique filename
    ext = os.path.splitext(avatar.filename or ".jpg")[1] or ".jpg"
    unique_name = f"user_{user['UserID']}_{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(AVATARS_DIR, unique_name)

    # Save file to disk
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(avatar.file, buffer)

    # Persist path in database
    avatar_url = f"/avatars/{unique_name}"
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE Users SET AvatarUrl = ? WHERE UserID = ?",
        (avatar_url, user["UserID"]),
    )
    conn.commit()
    cursor.close()
    conn.close()

    return {"detail": "Avatar uploaded", "avatar_url": avatar_url}


# ────────────────────────────────────────────────────────────────────
#  PUT /api/users/me/password
# ────────────────────────────────────────────────────────────────────

@app.put("/api/users/me/password")
def change_password(body: PasswordUpdate, user: dict = Depends(get_current_user_full)):
    """Change the current user's password after verifying the old one."""
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
#  POST /api/admin/users
# ────────────────────────────────────────────────────────────────────

@app.post("/api/admin/users")
def admin_create_user(
    body: UserCreate,
    user: dict = Depends(get_current_user),
):
    """Admin creates a new user.  Only callable by users with Role='Admin'."""
    # ── Permission check ──────────────────────────────────────────
    if user.get("role") != "Admin":
        raise HTTPException(status_code=403, detail="Admin access required")

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
        (body.username, password_hash, body.nickname, body.role),
    )
    conn.commit()
    cursor.close()
    conn.close()

    return {"detail": "User created", "username": body.username, "role": body.role}


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
                "CoverPath": row.CoverPath,
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
                "CoverPath": row.CoverPath,
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
                "cover": row.CoverPath,
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
async def get_weather_proxy(city: str):
    """Proxy weather requests to uapis.cn.  No auth required — the
    hover card may load before the user logs in."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://uapis.cn/api/v1/misc/weather",
                params={"city": city, "token": WEATHER_API_KEY},
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"上游天气接口异常: {exc.response.status_code}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"上游天气接口不可达: {str(exc)}")


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

@app.get("/api/regions")
def get_regions(country: str | None = None, province: str | None = None):
    """Return cascading region data from the local GlobalRegion dataset.

    - No params  → list of all country names.
    - ``country`` → dict of {province: [city, ...], ...} for that country.
    - ``country`` + ``province`` → list of city names for that province.
    """
    if country is None:
        # Return all country names
        return sorted(GLOBAL_REGIONS.keys())

    country_data = GLOBAL_REGIONS.get(country)
    if country_data is None:
        raise HTTPException(status_code=404, detail=f"Unknown country: {country}")

    if province is None:
        # Return {province_name: city_list} for this country
        return country_data

    cities = country_data.get(province)
    if cities is None:
        raise HTTPException(status_code=404, detail=f"Unknown province: {province} in {country}")

    return cities


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
                "CoverPath": row.CoverPath,
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

@app.get("/api/lyrics/{song_id}")
def lyrics(song_id: int, user: dict = Depends(get_current_user)):
    """Return synced lyrics for a song (fetches from LRCLIB on first call)."""
    lyrics_text = get_or_fetch_lyrics(song_id)
    if lyrics_text is None:
        return {"song_id": song_id, "lyrics": None}
    return {"song_id": song_id, "lyrics": lyrics_text}


# ────────────────────────────────────────────────────────────────────
#  GET /api/stream/{song_id}  (HTTP 206 Partial Content)
# ────────────────────────────────────────────────────────────────────

DEFAULT_RANGE_CHUNK = 2 * 1024 * 1024  # 2 MB per chunk when no end given


@app.get("/api/song_info/{song_id}")
async def get_song_info(song_id: int):
    """Return real audio metadata from ffprobe for the quality selector."""
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
def stream_song(song_id: int, request: Request):
    """Serve an audio file with HTTP 206 Range support.

    - No ``Range`` header → 200 OK, stream the entire file.
    - ``Range: bytes=0-`` → 206 Partial Content, serve the first 2 MB
      (browser will issue follow‑up requests for the rest).
    - ``Range: bytes=1024-2047`` → 206, serve that exact byte range.
    """
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
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
