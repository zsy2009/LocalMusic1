import os
import re
import hashlib
from collections import defaultdict

import mutagen
from mutagen.id3 import ID3
from mutagen.flac import FLAC
from mutagen.mp3 import MP3
from mutagen.wave import WAVE
from database import get_db_connection

from dotenv import load_dotenv
load_dotenv()
MUSIC_DIR = os.getenv("MUSIC_DIR", r"D:\RegularStorage\Music")
COVERS_DIR = r'D:\MusicCloud\backend\covers'

os.makedirs(COVERS_DIR, exist_ok=True)

# Supported file extensions
AUDIO_EXTENSIONS = {'.mp3', '.flac', '.wav'}


def _safe_print(*args, **kwargs):
    """Print that survives GBK terminal encoding errors."""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        # Fallback: replace unencodable chars with ?
        safe_args = []
        for a in args:
            if isinstance(a, str):
                a = a.encode('ascii', errors='replace').decode('ascii')
            safe_args.append(a)
        print(*safe_args, **kwargs)


def extract_metadata(file_path):
    """
    Read metadata and embedded cover art from an audio file.

    Returns a dict with keys:
        title, album, duration, bitrate, sample_rate, artists, cover_path
    """
    try:
        audio = mutagen.File(file_path)
    except Exception:
        return None

    if audio is None:
        return None

    title = None
    album = None
    artist_str = None

    if hasattr(audio, 'tags') and audio.tags:
        tags = audio.tags
        if isinstance(tags, mutagen.id3.ID3):
            title = str(tags.get('TIT2', ''))
            album = str(tags.get('TALB', ''))
            artist_str = str(tags.get('TPE1', ''))
        else:
            title = tags.get('title', [''])[0] if tags.get('title') else ''
            album = tags.get('album', [''])[0] if tags.get('album') else ''
            artist_str = tags.get('artist', [''])[0] if tags.get('artist') else ''

    if not title:
        title = os.path.splitext(os.path.basename(file_path))[0]

    album = (album or '').strip()

    duration = 0
    bitrate = 0
    sample_rate = 0

    if hasattr(audio, 'info') and audio.info:
        info = audio.info
        duration = int(getattr(info, 'length', 0))
        bitrate = int(getattr(info, 'bitrate', 0) or 0)
        sample_rate = int(getattr(info, 'sample_rate', 0) or 0)

    artists = []
    if artist_str and artist_str.strip():
        raw_names = re.split(r'[;；,，/\\|&]+', artist_str)
        artists = [name.strip() for name in raw_names if name.strip()]

    cover_path = None
    cover_data = None

    if hasattr(audio, 'pictures') and audio.pictures:
        cover_data = audio.pictures[0].data
    elif hasattr(audio, 'tags'):
        tags = audio.tags
        if isinstance(tags, mutagen.id3.ID3):
            for key in tags.keys():
                if key.startswith('APIC'):
                    cover_data = tags[key].data
                    break
        elif hasattr(tags, 'get'):
            pics = tags.get('metadata_block_picture')
            if pics:
                try:
                    from mutagen.flac import Picture
                    import base64
                    pic = Picture(base64.b64decode(pics[0]))
                    cover_data = pic.data
                except Exception:
                    pass

    if cover_data:
        dedup_key = album if album else title
        cover_hash = hashlib.md5(dedup_key.encode('utf-8')).hexdigest()
        cover_filename = f'{cover_hash}.jpg'
        cover_disk_path = os.path.join(COVERS_DIR, cover_filename)

        if not os.path.exists(cover_disk_path):
            try:
                with open(cover_disk_path, 'wb') as f:
                    f.write(cover_data)
            except Exception:
                pass

        cover_path = f'/covers/{cover_filename}'

    return {
        'title': title,
        'album': album or None,
        'duration': duration,
        'bitrate': bitrate,
        'sample_rate': sample_rate,
        'artists': artists,
        'cover_path': cover_path,
    }


# ═══════════════════════════════════════════════════════════════════
#  辅助函数
# ═══════════════════════════════════════════════════════════════════

def _artists_key(artists):
    """规范化的艺术家字符串：排序后用 '; ' 连接。"""
    return "; ".join(sorted(artists)) if artists else ""


def _normalize_album(album):
    """Normalize album: None / empty → ''."""
    return (album or '').strip()


def _discover_child_tables(cursor):
    """发现所有包含 SongID 列的用户表（Songs 自身除外）。"""
    tables = []
    cursor.execute("""
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE COLUMN_NAME = 'SongID'
          AND TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME != 'Songs'
        ORDER BY TABLE_NAME
    """)
    for row in cursor.fetchall():
        tables.append(row.TABLE_NAME)
    return tables


def _sync_artists_for_song(cursor, song_id, artist_names):
    """确保 song_id 的 Song_Artist_Mapping 与 artist_names 集合一致。

    会插入缺失的 Artist 记录，添加缺失的映射关系。
    （不会删除已有的映射，因为合并场景下我们需要保留所有艺术家。）
    """
    for name in artist_names:
        if not name or not name.strip():
            continue
        name = name.strip()
        cursor.execute("SELECT ArtistID FROM Artists WHERE Name = ?", (name,))
        row = cursor.fetchone()
        if row:
            artist_id = row[0]
        else:
            cursor.execute(
                "INSERT INTO Artists (Name) OUTPUT INSERTED.ArtistID VALUES (?)",
                (name,),
            )
            artist_id = cursor.fetchone()[0]

        cursor.execute("""
            IF NOT EXISTS (
                SELECT 1 FROM Song_Artist_Mapping
                WHERE SongID = ? AND ArtistID = ?
            )
            BEGIN
                INSERT INTO Song_Artist_Mapping (SongID, ArtistID)
                VALUES (?, ?)
            END
        """, (song_id, artist_id, song_id, artist_id))


def _load_existing_sets(cursor):
    """一次性加载已有路径和元数据到 Python set，O(1) 查重。

    Returns
    -------
    existing_paths : set[str]
    existing_metadata : set[tuple[str, str]]
        (Title, canonical_artists_string)  — Title + Artist 复合去重键
    """
    existing_paths = set()
    cursor.execute("SELECT FilePath FROM Songs")
    for row in cursor.fetchall():
        existing_paths.add(row.FilePath)

    existing_metadata = set()
    # 使用 Title + Artist 复合键：同一首歌由同一批艺术家演绎即视为重复，
    # 不区分专辑（不同专辑中的同一录音应合并而非重复入库）。
    cursor.execute("""
        SELECT
            s.Title,
            COALESCE(
                STRING_AGG(a.Name, '; ') WITHIN GROUP (ORDER BY a.Name),
                ''
            ) AS ArtistsStr
        FROM Songs s
        LEFT JOIN Song_Artist_Mapping sam ON s.SongID = sam.SongID
        LEFT JOIN Artists a ON sam.ArtistID = a.ArtistID
        GROUP BY s.SongID, s.Title
    """)
    for row in cursor.fetchall():
        existing_metadata.add((row.Title, row.ArtistsStr))

    return existing_paths, existing_metadata


# ═══════════════════════════════════════════════════════════════════
#  核心：三轮递进式去重
# ═══════════════════════════════════════════════════════════════════

def _load_all_song_rows(cursor):
    """加载全部歌曲的规范化元数据，用于 Pass 2/3。"""
    cursor.execute("""
        SELECT
            s.SongID,
            s.Title,
            ISNULL(s.Album, '') AS Album,
            s.CoverPath,
            COALESCE(
                STRING_AGG(a.Name, '; ') WITHIN GROUP (ORDER BY a.Name),
                ''
            ) AS ArtistsStr
        FROM Songs s
        LEFT JOIN Song_Artist_Mapping sam ON s.SongID = sam.SongID
        LEFT JOIN Artists a ON sam.ArtistID = a.ArtistID
        GROUP BY s.SongID, s.Title, s.Album, s.CoverPath
        ORDER BY s.Title, ISNULL(s.Album, ''), s.SongID
    """)
    rows = cursor.fetchall()
    result = []
    for row in rows:
        artist_set = set()
        if row.ArtistsStr:
            for name in row.ArtistsStr.split('; '):
                stripped = name.strip()
                if stripped:
                    artist_set.add(stripped)
        result.append({
            'SongID': row.SongID,
            'Title': row.Title,
            'Album': row.Album,
            'CoverPath': row.CoverPath,
            'ArtistsStr': row.ArtistsStr,
            'ArtistSet': artist_set,
        })
    return result


def _delete_songs_bottom_up(cursor, child_tables, song_ids, label):
    """自下而上删除一批 SongID。"""
    if not song_ids:
        return 0
    ids_str = ",".join(str(sid) for sid in song_ids)
    for table in child_tables:
        try:
            cursor.execute(f"DELETE FROM {table} WHERE SongID IN ({ids_str})")
            if cursor.rowcount > 0:
                print(f"    → {table}: 清理 {cursor.rowcount} 行")
        except Exception as e:
            print(f"    → {table}: 清理失败 - {e}")
    cursor.execute(f"DELETE FROM Songs WHERE SongID IN ({ids_str})")
    deleted = cursor.rowcount
    cursor.commit()
    return deleted


def _cleanup_duplicates(cursor):
    """自下而上清理重复歌曲。

    Pass 1 — (Title, Album, Artist) 完全一致 → 先物化 ID 列表再删除。
    Pass 2 — (Title, Artist) 完全相同但跨不同专辑 → 合并（同一首歌
             出现在多张专辑中）。
    """

    child_tables = _discover_child_tables(cursor)
    total_deleted = 0

    # ── 加载全量数据 ───────────────────────────────────────────
    all_rows = _load_all_song_rows(cursor)

    # ═══════════════════════════════════════════════════════════
    # Pass 1: (Title, Album, Artist) 三字段精确匹配
    # 关键修复：先物化待删除 ID 列表到 Python list，再用固定列表
    # 删子表和主表，避免 CTE 在子表删除后被重新求值导致结果漂移。
    # ═══════════════════════════════════════════════════════════
    groups_exact = defaultdict(list)
    for s in all_rows:
        key = (s['Title'], s['Album'], frozenset(s['ArtistSet']))
        groups_exact[key].append(s)

    pass1_sids = []
    for key, songs in groups_exact.items():
        if len(songs) <= 1:
            continue
        songs_sorted = sorted(songs, key=lambda s: s['SongID'])
        # 保留 SongID 最小的一条，其余标记删除
        for d in songs_sorted[1:]:
            pass1_sids.append(d['SongID'])

    if pass1_sids:
        print(f"  Pass 1 (Title+Album+Artist 全匹配): 发现 {len(pass1_sids)} 条重复")
        deleted = _delete_songs_bottom_up(cursor, child_tables, pass1_sids, "Pass 1")
        total_deleted += deleted
        print(f"    → Songs: 删除 {deleted} 条")
        deleted_set = set(pass1_sids)
        all_rows = [s for s in all_rows if s['SongID'] not in deleted_set]

    # ═══════════════════════════════════════════════════════════
    # Pass 2: (Title, Artist) 完全相同 + 跨不同专辑 → 合并
    # 安全条件：艺术家集合完全一致才合并，避免误杀独唱/合唱等不同版本。
    # 反例："好きだから。" by "『ユイカ』" (独唱) 和
    #       "好きだから。" by "『ユイカ』; れん" (合唱) —
    #       艺术家集合不同 → 各自保留。
    # ═══════════════════════════════════════════════════════════
    title_artist_groups = defaultdict(list)
    for s in all_rows:
        key = (s['Title'], frozenset(s['ArtistSet']))
        title_artist_groups[key].append(s)

    pass2_sids = []
    pass2_count = 0

    for (title, artist_set), songs in title_artist_groups.items():
        if len(songs) <= 1:
            continue

        unique_albums = set(s['Album'] for s in songs)
        if len(unique_albums) <= 1:
            continue

        songs_sorted = sorted(songs, key=lambda s: s['SongID'])
        keeper = songs_sorted[0]
        dupes = songs_sorted[1:]

        best_cover = keeper['CoverPath']
        best_album = keeper['Album']
        for s in songs:
            if not best_cover and s['CoverPath']:
                best_cover = s['CoverPath']
            if not best_album and s['Album']:
                best_album = s['Album']

        if best_cover and best_cover != keeper['CoverPath']:
            cursor.execute(
                "UPDATE Songs SET CoverPath = ? WHERE SongID = ?",
                (best_cover, keeper['SongID']),
            )
        if best_album and best_album != keeper['Album']:
            cursor.execute(
                "UPDATE Songs SET Album = ? WHERE SongID = ?",
                (best_album, keeper['SongID']),
            )

        artist_disp = "; ".join(sorted(artist_set)) if artist_set else "(无)"
        print(f"  Pass 2: \"{title}\" by [{artist_disp}] 跨 {len(unique_albums)} 张专辑 → 合并")

        for d in dupes:
            pass2_sids.append(d['SongID'])
        pass2_count += 1

    if pass2_sids:
        print(f"  Pass 2 (同Title+同Artist·跨专辑合并): "
              f"{pass2_count} 组, 共 {len(pass2_sids)} 条")
        deleted = _delete_songs_bottom_up(cursor, child_tables, pass2_sids, "Pass 2")
        total_deleted += deleted
        print(f"    → Songs: 删除 {deleted} 条")

    if total_deleted == 0:
        print("去重检查: 无重复记录，数据库整洁。")

    return total_deleted


def _cleanup_missing_files(cursor):
    """清理 FilePath 指向不存在文件的歌曲（文件已被移动/删除）。

    自下而上删除：先子表，再主表。
    """
    child_tables = _discover_child_tables(cursor)
    cursor.execute(
        "SELECT SongID, FilePath FROM Songs"
    )
    missing_ids = []
    for row in cursor.fetchall():
        if not os.path.isfile(row.FilePath):
            missing_ids.append(row.SongID)
            print(f"  文件缺失: SID={row.SongID} {row.FilePath}")

    if not missing_ids:
        print("文件存在性校验: 所有音频文件存在。")
        return 0

    ids_str = ",".join(str(sid) for sid in missing_ids)
    for table in child_tables:
        try:
            cursor.execute(f"DELETE FROM {table} WHERE SongID IN ({ids_str})")
            if cursor.rowcount > 0:
                print(f"  → {table}: 清理 {cursor.rowcount} 行")
        except Exception as e:
            print(f"  → {table}: 清理失败 - {e}")

    cursor.execute(f"DELETE FROM Songs WHERE SongID IN ({ids_str})")
    deleted = cursor.rowcount
    cursor.commit()
    print(f"  → Songs: 删除 {deleted} 条（文件已丢失）")
    return deleted


def _verify_and_fix_covers(cursor):
    """遍历所有歌曲，清理指向不存在文件的 CoverPath。

    封面文件名为 MD5(album or title).jpg，因此同专辑/同歌名的歌曲
    共享同一个封面文件是正确的。
    """
    cursor.execute("SELECT SongID, Title, Album, CoverPath FROM Songs WHERE CoverPath IS NOT NULL")
    broken = 0
    for row in cursor.fetchall():
        if not row.CoverPath:
            continue
        # CoverPath 形如 /covers/abc123.jpg
        cover_file = os.path.join(COVERS_DIR, os.path.basename(row.CoverPath))
        if not os.path.isfile(cover_file):
            cursor.execute(
                "UPDATE Songs SET CoverPath = NULL WHERE SongID = ?",
                (row.SongID,),
            )
            broken += 1
    if broken > 0:
        cursor.commit()
        print(f"封面校验: 修复 {broken} 首歌曲的无效封面引用（已置空）")
    else:
        print("封面校验: 所有封面引用有效。")


# ═══════════════════════════════════════════════════════════════════
#  主函数
# ═══════════════════════════════════════════════════════════════════

def scan_and_sync():
    """Walk MUSIC_DIR, upsert metadata, and manage artist mappings.

    Deduplication strategy (enforced strictly every sync):
      1. 扫描时 — (Title, Album, Artist) 三元组防重复入
      2. 扫描后 — 两轮去重清洗:
           Pass 1: (Title, Album, Artist) 全匹配 → 直接删
           Pass 2: (Title, Album) 分组 → 合并艺术家 → 删除剩余重复
      3. 封面完整性校验
    """

    file_list = []
    for root, dirs, files in os.walk(MUSIC_DIR):
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in AUDIO_EXTENSIONS:
                file_list.append(os.path.join(root, fname))

    total = len(file_list)
    if total == 0:
        print("No audio files found in", MUSIC_DIR)
        return

    conn = get_db_connection()
    cursor = conn.cursor()

    # ── 一次性加载已有集合，O(1) 查重 ────────────────────────────
    existing_paths, existing_metadata = _load_existing_sets(cursor)
    print(f"已加载 {len(existing_paths)} 条已有路径, "
          f"{len(existing_metadata)} 条已有 (Title, Artist) 复合去重键")

    success_count = 0
    skip_count = 0
    fail_count = 0

    for idx, file_path in enumerate(file_list, start=1):
        try:
            # 路径级去重（防御性检查：相同文件绝对不会重复入库）
            if file_path in existing_paths:
                skip_count += 1
                _safe_print(f"[{idx}/{total}] 跳过(路径已存在): {os.path.basename(file_path)}")
                continue

            meta = extract_metadata(file_path)
            if meta is None:
                fail_count += 1
                _safe_print(f"[{idx}/{total}] 读取失败: {os.path.basename(file_path)}")
                continue

            # 元数据级去重：Title + Artist 复合去重
            # 同一首歌由同一批艺术家演绎即视为重复，不区分专辑
            artists_canonical = _artists_key(meta['artists'])
            dedup_key = (meta['title'], artists_canonical)

            if dedup_key in existing_metadata:
                skip_count += 1
                artist_disp = meta['artists'][0] if meta['artists'] else 'Unknown'
                _safe_print(f"[{idx}/{total}] 跳过(Title+Artist重复): "
                      f"{meta['title']} - {artist_disp}")
                continue

            # Folder name (immediate parent directory)
            folder = os.path.basename(os.path.dirname(file_path))

            # Insert song
            cursor.execute("""
                INSERT INTO Songs (Title, Artist, FilePath, Album, Duration, CoverPath, Bitrate, SampleRate, Folder)
                OUTPUT INSERTED.SongID
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                meta['title'], artists_canonical, file_path, meta['album'],
                meta['duration'], meta['cover_path'],
                meta['bitrate'], meta['sample_rate'], folder,
            ))
            song_id = cursor.fetchone()[0]

            # Insert artists
            _sync_artists_for_song(cursor, song_id, meta['artists'])

            cursor.commit()

            existing_paths.add(file_path)
            existing_metadata.add(dedup_key)

            success_count += 1
            artist_disp = meta['artists'][0] if meta['artists'] else 'Unknown'
            _safe_print(f"[{idx}/{total}] 成功入库: {meta['title']} - {artist_disp}")

        except Exception as e:
            fail_count += 1
            _safe_print(f"[{idx}/{total}] 错误: {os.path.basename(file_path)} - {e}")
            try:
                cursor.rollback()
            except Exception:
                pass

    # ═══════════════════════════════════════════════════════════════
    # 同步后：文件存在性 → 去重 → 封面校验
    # ═══════════════════════════════════════════════════════════════

    print("\n" + "=" * 60)
    print("同步后: 文件存在性校验（清理已丢失的音频文件记录）")
    print("=" * 60)
    try:
        _cleanup_missing_files(cursor)
    except Exception as e:
        print(f"文件校验失败: {e}")
        import traceback
        traceback.print_exc()

    print("\n" + "=" * 60)
    print("同步后去重: Pass 1 (全匹配) + Pass 2 (同Artist跨专辑合并)")
    print("=" * 60)
    try:
        removed = _cleanup_duplicates(cursor)
        if removed > 0:
            print(f"共计清理 {removed} 条重复记录，事务已提交。")
    except Exception as e:
        print(f"去重清洗失败: {e}")
        import traceback
        traceback.print_exc()
        conn.rollback()

    print("\n" + "=" * 60)
    print("封面完整性校验")
    print("=" * 60)
    try:
        _verify_and_fix_covers(cursor)
    except Exception as e:
        print(f"封面校验失败: {e}")

    cursor.close()
    conn.close()

    print(f"\n扫描完成: 成功 {success_count} / 跳过 {skip_count} / 失败 {fail_count}")


if __name__ == '__main__':
    scan_and_sync()
