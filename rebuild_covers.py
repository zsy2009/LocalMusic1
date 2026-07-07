r"""
rebuild_covers.py — 彻底销毁并重建所有歌曲封面。

核心设计：
  - 强制使用 SongID 命名封面文件（cover_{SongID}.jpg），100% 杜绝重名覆盖。
  - 从原始音频文件中重新提取内嵌封面，不使用任何缓存。
  - 单首失败不影响整体流程，每 100 条自动提交。

依赖：
  - mutagen   : 解析 MP3/FLAC/WAV 元数据
  - pyodbc    : 数据库读写
  - os, shutil: 文件系统操作

使用方式：
  cd D:\MusicCloud
  python rebuild_covers.py
"""

import os
import sys
import shutil
import base64
import traceback

import mutagen
from mutagen.id3 import ID3
from mutagen.flac import Picture

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), 'backend', '.env'))

from database import get_db_connection

# ═══════════════════════════════════════════════════════════════════
# 路径配置
# ═══════════════════════════════════════════════════════════════════

# 封面存放的物理目录（与 FastAPI StaticFiles mount 保持一致）
COVERS_DIR = os.path.join(os.path.dirname(__file__), 'backend', 'covers')

# 写入数据库的 URL 前缀
COVER_URL_PREFIX = '/covers'


def _safe_print(*args, **kwargs):
    """Print that survives GBK terminal encoding errors."""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        safe_args = []
        for a in args:
            if isinstance(a, str):
                a = a.encode('ascii', errors='replace').decode('ascii')
            safe_args.append(a)
        print(*safe_args, **kwargs)


# ═══════════════════════════════════════════════════════════════════
# 步骤辅助函数
# ═══════════════════════════════════════════════════════════════════

def _detect_image_ext(data: bytes) -> str:
    """根据二进制头检测图片格式，返回扩展名（含点号）。"""
    if data[:3] == b'\xFF\xD8\xFF':
        return '.jpg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return '.png'
    if data[:4] == b'GIF8':
        return '.gif'
    if data[:2] == b'BM':
        return '.bmp'
    if data[:4] == b'RIFF' and len(data) > 8 and data[8:12] == b'WEBP':
        return '.webp'
    # 默认回退为 jpg（绝大多数音频内嵌封面是 JPEG）
    return '.jpg'


def extract_cover_data(file_path: str) -> bytes | None:
    """从音频文件中提取内嵌封面图片的原始字节。

    支持:
      - MP3: ID3 APIC 帧
      - FLAC: metadata_block_picture
      - 通用: mutagen pictures 属性

    Returns
    -------
    bytes or None
    """
    try:
        audio = mutagen.File(file_path)
    except Exception:
        return None

    if audio is None:
        return None

    # 通用路径: mutagen pictures 列表
    if hasattr(audio, 'pictures') and audio.pictures:
        return audio.pictures[0].data

    # 标签级探测
    if not hasattr(audio, 'tags') or audio.tags is None:
        return None

    tags = audio.tags

    # MP3: ID3 APIC 帧
    if isinstance(tags, ID3):
        for key in tags.keys():
            if key.startswith('APIC'):
                return tags[key].data
        return None

    # FLAC: metadata_block_picture (Base64 编码)
    if hasattr(tags, 'get'):
        pics = tags.get('metadata_block_picture')
        if pics:
            try:
                pic = Picture(base64.b64decode(pics[0]))
                return pic.data
            except Exception:
                pass

    return None


def wipe_cover_directory():
    """暴力清空封面目录：删除 → 重建空目录。"""
    if os.path.isdir(COVERS_DIR):
        shutil.rmtree(COVERS_DIR)
        _safe_print(f"[清空] 已删除旧封面目录: {COVERS_DIR}")
    os.makedirs(COVERS_DIR, exist_ok=True)
    _safe_print(f"[创建] 全新空目录: {COVERS_DIR}")


def fetch_all_songs(cursor):
    """返回所有歌曲的 (SongID, FilePath, Title) 列表。"""
    cursor.execute("SELECT SongID, FilePath, Title FROM Songs ORDER BY SongID")
    rows = cursor.fetchall()
    _safe_print(f"[查询] 共 {len(rows)} 首歌曲待处理。")
    return [(r.SongID, r.FilePath, r.Title) for r in rows]


def process_one_song(cursor, song_id: int, file_path: str, title: str) -> bool:
    """处理单首歌曲：提取封面 → 保存 → 更新 CoverPath。

    Returns True on success, False on skip/failure.
    """
    # ── 校验物理文件是否存在 ──────────────────────────────────────
    if not os.path.isfile(file_path):
        _safe_print(f"  [跳过] SID={song_id} 文件缺失: {file_path}")
        return False

    # ── 提取内嵌封面 ──────────────────────────────────────────────
    cover_data = extract_cover_data(file_path)
    if cover_data is None or len(cover_data) == 0:
        _safe_print(f"  [无封面] SID={song_id} {title}")
        return False

    # ── 命名：cover_{SongID}.{ext}（使用主键，绝对无冲突） ─────────
    ext = _detect_image_ext(cover_data)
    filename = f"cover_{song_id}{ext}"
    disk_path = os.path.join(COVERS_DIR, filename)

    try:
        with open(disk_path, 'wb') as f:
            f.write(cover_data)
    except OSError as e:
        _safe_print(f"  [写入失败] SID={song_id} {filename}: {e}")
        return False

    # ── 更新数据库 CoverPath ──────────────────────────────────────
    cover_url = f"{COVER_URL_PREFIX}/{filename}"
    cursor.execute(
        "UPDATE Songs SET CoverPath = ? WHERE SongID = ?",
        (cover_url, song_id),
    )

    return True


# ═══════════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════════

def main():
    _safe_print("=" * 60)
    _safe_print("  MusicCloud 封面重建（SongID 命名法）")
    _safe_print("=" * 60)

    # ── 步骤 1: 清空封面目录 ──────────────────────────────────────
    _safe_print("\n[步骤 1/4] 暴力清空旧封面...")
    wipe_cover_directory()

    # ── 步骤 2: 连接数据库，获取歌曲列表 ──────────────────────────
    _safe_print("\n[步骤 2/4] 加载歌曲数据库记录...")
    conn = get_db_connection()
    cursor = conn.cursor()
    songs = fetch_all_songs(cursor)

    # ── 步骤 3 & 4: 逐首提取并保存封面 ────────────────────────────
    _safe_print(f"\n[步骤 3/4] 开始逐首重新提取封面...")
    _safe_print("-" * 60)

    success_count = 0
    skip_count = 0

    for idx, (song_id, file_path, title) in enumerate(songs, start=1):
        try:
            ok = process_one_song(cursor, song_id, file_path, title)
            if ok:
                success_count += 1
                _safe_print(f"  [{idx}/{len(songs)}] OK  SID={song_id} -> cover_{song_id}.jpg")
            else:
                skip_count += 1
        except Exception:
            skip_count += 1
            _safe_print(f"  [{idx}/{len(songs)}] ERROR SID={song_id}: {traceback.format_exc().strip().split(chr(10))[-1]}")

        # ── 步骤 5: 每 100 条提交一次 ────────────────────────────
        if idx % 100 == 0:
            conn.commit()
            _safe_print(f"  --- 已提交 ({idx}/{len(songs)}) ---")

    # ── 最终提交 ──────────────────────────────────────────────────
    conn.commit()
    cursor.close()
    conn.close()

    # ── 结果 ──────────────────────────────────────────────────────
    _safe_print("\n" + "=" * 60)
    _safe_print(f"  封面重建完成")
    _safe_print(f"  成功: {success_count}")
    _safe_print(f"  跳过: {skip_count} (无内嵌封面 / 文件缺失)")
    _safe_print(f"  总计: {len(songs)}")
    _safe_print("=" * 60)


if __name__ == '__main__':
    main()
