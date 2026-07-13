# -*- coding: utf-8 -*-
"""
MusicCloud ???????/???????

????????????????????????/?????????????
??????????????????????????????
?????
  - backend/custom_covers/song_<SongID>.<jpg|jpeg|png|webp|gif>
  - backend/custom_lyrics/song_<SongID>.lrc
?????
  - ???????????????? backups/custom-assets-tool/<???>/
  - ?????? logs/custom_assets_manager.log
"""

from __future__ import annotations

import datetime as _dt
import os
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = PROJECT_ROOT / "backend"
CUSTOM_COVERS_DIR = BACKEND_DIR / "custom_covers"
CUSTOM_LYRICS_DIR = BACKEND_DIR / "custom_lyrics"
BACKUP_ROOT = PROJECT_ROOT / "backups" / "custom-assets-tool"
LOG_FILE = PROJECT_ROOT / "logs" / "custom_assets_manager.log"
COVER_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

sys.path.insert(0, str(BACKEND_DIR))
try:
    from database import get_db_connection
except Exception as exc:  # pragma: no cover - interactive tool
    print("???????????????? MusicCloud ???????")
    print(f"???{exc}")
    input("? Enter ??...")
    raise SystemExit(1)


def now_stamp() -> str:
    return _dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def ensure_dirs() -> None:
    CUSTOM_COVERS_DIR.mkdir(parents=True, exist_ok=True)
    CUSTOM_LYRICS_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)


def log(message: str) -> None:
    ensure_dirs()
    line = f"[{_dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}\n"
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line)


def backup_file(path: Path, reason: str) -> Path | None:
    if not path.exists():
        return None
    backup_dir = BACKUP_ROOT / now_stamp()
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / path.name
    counter = 1
    while target.exists():
        target = backup_dir / f"{path.stem}_{counter}{path.suffix}"
        counter += 1
    shutil.copy2(path, target)
    log(f"BACKUP {reason}: {path} -> {target}")
    return target


def query_songs(keyword: str, limit: int = 30) -> list[dict]:
    keyword_like = f"%{keyword}%"
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT TOP (?)
                s.SongID,
                s.Title,
                s.Album,
                s.FilePath,
                STUFF((
                    SELECT ', ' + a2.Name
                    FROM Song_Artist_Mapping sam2
                    JOIN Artists a2 ON sam2.ArtistID = a2.ArtistID
                    WHERE sam2.SongID = s.SongID
                    FOR XML PATH(''), TYPE
                ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS Artists
            FROM Songs s
            LEFT JOIN Song_Artist_Mapping sam ON s.SongID = sam.SongID
            LEFT JOIN Artists a ON sam.ArtistID = a.ArtistID
            WHERE s.Title LIKE ? OR s.Album LIKE ? OR a.Name LIKE ? OR CAST(s.SongID AS NVARCHAR(30)) = ?
            GROUP BY s.SongID, s.Title, s.Album, s.FilePath
            ORDER BY s.SongID
            """,
            (limit, keyword_like, keyword_like, keyword_like, keyword.strip()),
        )
        rows = cursor.fetchall()
        return [
            {
                "SongID": int(row.SongID),
                "Title": row.Title or "",
                "Album": row.Album or "",
                "Artists": row.Artists or "",
                "FilePath": row.FilePath or "",
            }
            for row in rows
        ]
    finally:
        cursor.close()
        conn.close()


def custom_cover_files(song_id: int) -> list[Path]:
    return [CUSTOM_COVERS_DIR / f"song_{song_id}{ext}" for ext in sorted(COVER_EXTS)]


def current_custom_cover(song_id: int) -> Path | None:
    for path in custom_cover_files(song_id):
        if path.exists():
            return path
    return None


def current_custom_lyrics(song_id: int) -> Path:
    return CUSTOM_LYRICS_DIR / f"song_{song_id}.lrc"


def show_song(song: dict) -> None:
    sid = song["SongID"]
    cover = current_custom_cover(sid)
    lyrics = current_custom_lyrics(sid)
    print("\n?????")
    print(f"  ID: {sid}")
    print(f"  ??: {song['Title']}")
    print(f"  ??: {song['Artists'] or '??'}")
    print(f"  ??: {song['Album'] or '??'}")
    print(f"  ??: {song['FilePath']}")
    print(f"  ?????: {cover if cover else '?'}")
    print(f"  ?????: {lyrics if lyrics.exists() else '?'}")


def set_cover(song: dict) -> None:
    sid = song["SongID"]
    src_text = input("?????????????").strip().strip('"')
    src = Path(src_text)
    if not src.is_file():
        print("??????")
        return
    ext = src.suffix.lower()
    if ext not in COVER_EXTS:
        print("????? jpg/jpeg/png/webp/gif?")
        return
    ensure_dirs()
    old = current_custom_cover(sid)
    if old:
        backup_file(old, f"replace-cover-song-{sid}")
        old.unlink()
    dst = CUSTOM_COVERS_DIR / f"song_{sid}{ext}"
    shutil.copy2(src, dst)
    log(f"SET_COVER song={sid} title={song['Title']} src={src} dst={dst}")
    print(f"?????????{dst}")


def delete_cover(song: dict) -> None:
    sid = song["SongID"]
    old = current_custom_cover(sid)
    if not old:
        print("??????????")
        return
    confirm = input(f"????????? {old.name}??? YES ???").strip()
    if confirm != "YES":
        print("????")
        return
    backup_file(old, f"delete-cover-song-{sid}")
    old.unlink()
    log(f"DELETE_COVER song={sid} title={song['Title']} file={old}")
    print("?????????")


def set_lyrics(song: dict) -> None:
    sid = song["SongID"]
    print("???????")
    print("  1. ? .lrc/.txt ????")
    print("  2. ??????????? END ???")
    choice = input("????").strip()
    if choice == "1":
        src_text = input("????????????").strip().strip('"')
        src = Path(src_text)
        if not src.is_file():
            print("??????")
            return
        text = src.read_text(encoding="utf-8-sig", errors="replace").strip()
    elif choice == "2":
        print("??? LRC ??????????? END?")
        buf: list[str] = []
        while True:
            line = input()
            if line == "END":
                break
            buf.append(line)
        text = "\n".join(buf).strip()
    else:
        print("?????")
        return
    if not text:
        print("???????????")
        return
    ensure_dirs()
    dst = current_custom_lyrics(sid)
    if dst.exists():
        backup_file(dst, f"replace-lyrics-song-{sid}")
    dst.write_text(text + "\n", encoding="utf-8")
    log(f"SET_LYRICS song={sid} title={song['Title']} file={dst} chars={len(text)}")
    print(f"?????????{dst}")


def delete_lyrics(song: dict) -> None:
    sid = song["SongID"]
    dst = current_custom_lyrics(sid)
    if not dst.exists():
        print("??????????")
        return
    confirm = input(f"????????? {dst.name}??? YES ???").strip()
    if confirm != "YES":
        print("????")
        return
    backup_file(dst, f"delete-lyrics-song-{sid}")
    dst.unlink()
    log(f"DELETE_LYRICS song={sid} title={song['Title']} file={dst}")
    print("?????????")


def select_song() -> dict | None:
    keyword = input("\n????ID/??/??/??????????????").strip()
    if not keyword:
        return None
    try:
        songs = query_songs(keyword)
    except Exception as exc:
        print(f"????????{exc}")
        return None
    if not songs:
        print("?????????")
        return None
    print("\n?????")
    for idx, song in enumerate(songs, 1):
        artists = song["Artists"] or "????"
        album = song["Album"] or "????"
        print(f"  {idx:02d}. [{song['SongID']}] {song['Title']} - {artists} / {album}")
    choice = input("???????????").strip()
    if not choice:
        return None
    if not choice.isdigit() or not (1 <= int(choice) <= len(songs)):
        print("?????")
        return None
    return songs[int(choice) - 1]


def manage_song(song: dict) -> None:
    while True:
        show_song(song)
        print("\n???")
        print("  1. ???????")
        print("  2. ???????")
        print("  3. ???????")
        print("  4. ???????")
        print("  5. ????")
        choice = input("????").strip()
        if choice == "1":
            set_cover(song)
        elif choice == "2":
            delete_cover(song)
        elif choice == "3":
            set_lyrics(song)
        elif choice == "4":
            delete_lyrics(song)
        elif choice == "5" or choice == "":
            return
        else:
            print("?????")


def main() -> None:
    ensure_dirs()
    print("MusicCloud ???????/??????")
    print("????????????????????????")
    print(f"?????{CUSTOM_COVERS_DIR}")
    print(f"?????{CUSTOM_LYRICS_DIR}")
    print(f"?????{BACKUP_ROOT}")
    log("OPEN_TOOL")
    while True:
        song = select_song()
        if song is None:
            break
        manage_song(song)
    log("CLOSE_TOOL")
    input("\n????? Enter ????...")


if __name__ == "__main__":
    main()
