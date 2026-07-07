"""
db_rebuild.py -- Destroy and rebuild MusicCloud database.

Steps:
  1. Drop all FK constraints + tables via raw T-SQL (reliable ordering)
  2. create_all() via SQLAlchemy Base.metadata (exact schema from models.py)
  3. Seed default admin user
  4. Scan music files from disk via scan_and_sync()

Usage:
  cd D:/MusicCloud
  python db_rebuild.py
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), 'backend', '.env'))

from database import engine, get_db_connection
from models import Base
from scanner import scan_and_sync


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


def drop_everything():
    """Drop all FK constraints then all tables via raw T-SQL."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Phase A: drop every FK constraint
    cursor.execute("""
        SELECT fk.name AS FK_Name,
               OBJECT_NAME(fk.parent_object_id) AS TableName
        FROM sys.foreign_keys fk
    """)
    fks = cursor.fetchall()
    for row in fks:
        try:
            cursor.execute(
                f"ALTER TABLE dbo.[{row.TableName}] DROP CONSTRAINT [{row.FK_Name}]"
            )
            _safe_print(f"  DROP FK [{row.FK_Name}] on [{row.TableName}]")
        except Exception as e:
            _safe_print(f"  WARN: {e}")
    conn.commit()
    _safe_print(f"  ({len(fks)} FK constraints dropped)\n")

    # Phase B: drop every user table
    cursor.execute("""
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
    """)
    tables = [r.TABLE_NAME for r in cursor.fetchall()]
    for table in tables:
        try:
            cursor.execute(f"DROP TABLE dbo.[{table}]")
            _safe_print(f"  DROP TABLE [{table}]")
        except Exception as e:
            _safe_print(f"  FAIL: {e}")
    conn.commit()
    cursor.close()
    conn.close()
    _safe_print(f"  ({len(tables)} tables dropped)\n")


def main():
    _safe_print("=" * 60)
    _safe_print("  MusicCloud Database Rebuild")
    _safe_print("=" * 60)

    # Step 1: Destroy everything
    _safe_print("\n[Step 1/3] Dropping all constraints and tables...\n")
    drop_everything()

    # Step 2: Recreate schema via SQLAlchemy
    _safe_print("[Step 2/3] Creating schema from models.py...")
    Base.metadata.create_all(bind=engine)
    _safe_print("  Schema created (11 tables).\n")

    # Seed default admin
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM Users")
    if cursor.fetchone()[0] == 0:
        cursor.execute(
            "INSERT INTO Users (Username, PasswordHash, Role, IsActive) "
            "VALUES ('admin', "
            "'$2b$12$7q0vIXe693HscJ73tfWwre0YXer0CKneBvQjGAdMdPFgxg38MJcw2', "
            "'Admin', 1)"
        )
        conn.commit()
    cursor.close()
    conn.close()

    # Step 3: Full library scan
    _safe_print("\n[Step 3/3] Scanning music files from disk...")
    _safe_print("=" * 60)
    scan_and_sync()

    _safe_print("\n" + "=" * 60)
    _safe_print("  Database rebuild complete!")
    _safe_print("=" * 60)


if __name__ == '__main__':
    main()
