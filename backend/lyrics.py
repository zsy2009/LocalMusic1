import requests
from database import get_db_connection

# ── NetEase Cloud Music API ────────────────────────────────────────
NETEASE_SEARCH_API = "http://music.163.com/api/search/get/web"
NETEASE_LYRIC_API = "http://music.163.com/api/song/lyric"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "http://music.163.com/",
}


def _cache_and_return(cursor, conn, song_id: int, lyrics_text: str | None) -> str | None:
    """Persist lyrics into SongLyrics and return the text."""
    if lyrics_text:
        cursor.execute(
            "INSERT INTO SongLyrics (SongID, LyricsText) VALUES (?, ?)",
            (song_id, lyrics_text),
        )
        conn.commit()
    return lyrics_text


def get_or_fetch_lyrics(song_id: int) -> str | None:
    """Return synced lyrics for *song_id*, fetching from NetEase on cache miss.

    Steps
    -----
    1. Check the ``SongLyrics`` cache table.
    2. If missing, look up Title / first Artist from ``Songs`` + ``Artists``.
    3. Search NetEase for the track ID via ``/api/search/get/web``.
    4. Fetch LRC lyrics via ``/api/song/lyric`` using the ID.
    5. Persist the result and return it.  Return ``None`` if nothing found.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # ── Step 1: check local cache ───────────────────────────────────
    cursor.execute(
        "SELECT LyricsText FROM SongLyrics WHERE SongID = ?", (song_id,)
    )
    row = cursor.fetchone()
    if row:
        cursor.close()
        conn.close()
        return row.LyricsText

    # ── Step 2: fetch song metadata (Title, first Artist) ───────────
    cursor.execute("""
        SELECT s.Title,
               (SELECT TOP 1 a.Name
                FROM Song_Artist_Mapping sam
                JOIN Artists a ON a.ArtistID = sam.ArtistID
                WHERE sam.SongID = s.SongID
                ORDER BY a.ArtistID) AS FirstArtist
        FROM Songs s
        WHERE s.SongID = ?
    """, (song_id,))
    meta = cursor.fetchone()

    if meta is None:
        cursor.close()
        conn.close()
        return None

    title = meta.Title or ""
    artist = meta.FirstArtist or ""

    # ── Step 3: search NetEase for the song ID ──────────────────────
    netease_song_id: int | None = None

    try:
        query = f"{title} {artist}".strip()
        print(f"🔍 [网易云搜索] s={query}")
        resp = requests.get(
            NETEASE_SEARCH_API,
            params={"s": query, "type": 1, "limit": 1, "offset": 0},
            headers=HEADERS,
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()

        songs = data.get("result", {}).get("songs")
        if songs and isinstance(songs, list) and len(songs) > 0:
            netease_song_id = songs[0].get("id")
            if netease_song_id:
                print(f"✅ 找到网易云歌曲 ID: {netease_song_id}")
            else:
                print("⚠️ 搜索结果无有效 id")
        else:
            print("⚠️ 网易云未搜索到匹配歌曲")

    except requests.exceptions.Timeout:
        print("⚠️ 网易云搜索超时")
    except Exception as exc:
        print(f"⚠️ 网易云搜索异常: {exc}")

    if netease_song_id is None:
        cursor.close()
        conn.close()
        return None

    # ── Step 4: fetch LRC lyrics by song ID ─────────────────────────
    lyrics_text: str | None = None

    try:
        print(f"🔍 [网易云歌词] id={netease_song_id}")
        resp = requests.get(
            NETEASE_LYRIC_API,
            params={"id": netease_song_id, "lv": 1, "kv": 1, "tv": -1},
            headers=HEADERS,
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()

        lrc = data.get("lrc") or data.get("tlyric")
        if lrc and lrc.get("lyric"):
            lyrics_text = lrc["lyric"]
            print(f"✅ 成功获取 LRC 歌词 ({len(lyrics_text)} 字符)")
        else:
            print("⚠️ 网易云返回数据中无歌词")

    except requests.exceptions.Timeout:
        print("⚠️ 网易云歌词接口超时")
    except Exception as exc:
        print(f"⚠️ 网易云歌词接口异常: {exc}")

    # ── Step 5: cache & return ──────────────────────────────────────
    result = _cache_and_return(cursor, conn, song_id, lyrics_text)
    cursor.close()
    conn.close()
    return result
