"""
emergency_restore.py -- Rebuild test user accounts after database wipe.

Idempotent: skips any account that already exists.

Usage:
  cd D:/MusicCloud
  python emergency_restore.py
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), 'backend', '.env'))

from database import get_db_connection
from auth import get_password_hash


ACCOUNTS = [
    {
        "username":     "admin",
        "password":     "123456",
        "nickname":     "Super Admin",
        "role":         "Admin",
    },
    {
        "username":     "test01",
        "password":     "123456",
        "nickname":     "Tester 01",
        "role":         "User",
    },
]


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


def restore_accounts():
    conn = get_db_connection()
    cursor = conn.cursor()

    created = 0
    reset = 0

    for acct in ACCOUNTS:
        pw_hash = get_password_hash(acct["password"])

        cursor.execute(
            "SELECT UserID FROM Users WHERE Username = ?",
            (acct["username"],),
        )
        existing = cursor.fetchone()

        if existing:
            # Force-overwrite password hash to guarantee known credentials
            cursor.execute(
                "UPDATE Users SET PasswordHash = ?, Nickname = ?, Role = ? "
                "WHERE Username = ?",
                (pw_hash, acct["nickname"], acct["role"], acct["username"]),
            )
            _safe_print(f"  [RESET] {acct['username']} (hash overwritten)")
            reset += 1
        else:
            cursor.execute(
                "INSERT INTO Users (Username, PasswordHash, Nickname, Role, IsActive) "
                "VALUES (?, ?, ?, ?, 1)",
                (acct["username"], pw_hash, acct["nickname"], acct["role"]),
            )
            _safe_print(f"  [CREATE] {acct['username']} ({acct['role']})")
            created += 1

        conn.commit()

    cursor.close()
    conn.close()

    _safe_print("")
    _safe_print("=" * 50)
    _safe_print("  Account restore complete")
    _safe_print("=" * 50)
    _safe_print(f"  Created : {created}")
    _safe_print(f"  Reset   : {reset} (password forced)")
    _safe_print("")
    _safe_print("  admin  / 123456  (Admin -- can trigger library scan)")
    _safe_print("  test01 / 123456  (User  -- mobile / separate testing)")
    _safe_print("=" * 50)


if __name__ == '__main__':
    restore_accounts()
