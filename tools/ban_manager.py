"""Local BAN manager for MusicCloud.

This is an administrator-only local tool. It manages AbuseBans and reads
AbuseEvents directly from MusicCloudDB through the existing backend connection.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(TOOL_DIR)
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
LOG_DIR = os.path.join(PROJECT_ROOT, "logs")
LOG_FILE = os.path.join(LOG_DIR, "ban_manager.log")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def get_db_connection():
    from database import get_db_connection as _get_db_connection
    return _get_db_connection()

VALID_SCOPES = {
    "all",
    "auth.login",
    "auth.refresh",
    "ticket.create",
    "ticket.reply",
    "ticket.upload",
    "avatar.upload",
    "stream",
    "stats.write",
    "playlist.write",
    "favorite.write",
    "weather",
    "region.search",
    "admin",
}


def log_action(message: str) -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8", newline="\n") as f:
        f.write(f"{datetime.now().isoformat(timespec='seconds')} {message}\n")


def ensure_abuse_tables(cursor) -> None:
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
                CreatedByType NVARCHAR(30) NOT NULL DEFAULT 'local_tool',
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


def validate_scope(scope: str) -> str:
    scope = (scope or "all").strip()
    if scope not in VALID_SCOPES:
        raise SystemExit(f"无效 scope: {scope}\n可用 scope: {', '.join(sorted(VALID_SCOPES))}")
    return scope


def parse_until(args) -> datetime | None:
    if args.permanent:
        return None
    if args.hours is not None:
        return datetime.now() + timedelta(hours=float(args.hours))
    if args.until:
        text = args.until.strip().replace("T", " ")
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                pass
        raise SystemExit("--until 格式应为 YYYY-MM-DD、YYYY-MM-DD HH:MM 或 YYYY-MM-DD HH:MM:SS")
    return None


def resolve_user(cursor, value: str) -> tuple[int, str]:
    if value.isdigit():
        cursor.execute("SELECT UserID, Username FROM Users WHERE UserID = ?", (int(value),))
    else:
        cursor.execute("SELECT UserID, Username FROM Users WHERE Username = ?", (value,))
    row = cursor.fetchone()
    if row is None:
        raise SystemExit(f"用户不存在: {value}")
    return int(row.UserID), row.Username


def cmd_users(args) -> None:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        keyword = f"%{args.keyword.strip()}%" if args.keyword else "%"
        cursor.execute("""
            SELECT TOP (?) UserID, Username, Nickname, Role, IsActive
            FROM Users
            WHERE Username LIKE ? OR Nickname LIKE ?
            ORDER BY CASE WHEN Role = 'Admin' THEN 0 ELSE 1 END, UserID ASC
        """, (args.limit, keyword, keyword))
        rows = cursor.fetchall()
        for row in rows:
            print(f"{int(row.UserID):>4}  {row.Username:<24}  {row.Role:<8}  active={bool(row.IsActive)}  {row.Nickname or ''}")
    finally:
        cursor.close()
        conn.close()


def create_ban(subject_type: str, subject_value: str, scope: str, reason: str, evidence: str, until: datetime | None) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        ensure_abuse_tables(cursor)
        cursor.execute("""
            INSERT INTO AbuseBans
                (SubjectType, SubjectValue, Scope, Reason, Evidence, BannedUntil, CreatedByType, IsActive, CreatedAt)
            OUTPUT INSERTED.BanID
            VALUES (?, ?, ?, ?, ?, ?, 'local_tool', 1, SYSUTCDATETIME())
        """, (subject_type, str(subject_value), scope, reason, evidence or None, until))
        ban_id = int(cursor.fetchone()[0])
        conn.commit()
        log_action(f"BAN id={ban_id} subject={subject_type}:{subject_value} scope={scope} until={until} reason={reason}")
        return ban_id
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def cmd_ban_user(args) -> None:
    scope = validate_scope(args.scope)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        user_id, username = resolve_user(cursor, args.user)
    finally:
        cursor.close()
        conn.close()
    until = parse_until(args)
    ban_id = create_ban("user", str(user_id), scope, args.reason, args.evidence, until)
    print(f"已封禁用户 {username} (UserID={user_id})，BAN ID={ban_id}，scope={scope}，until={until or '永久'}")


def cmd_ban_ip(args) -> None:
    scope = validate_scope(args.scope)
    until = parse_until(args)
    ban_id = create_ban("ip", args.ip.strip(), scope, args.reason, args.evidence, until)
    print(f"已封禁 IP {args.ip}，BAN ID={ban_id}，scope={scope}，until={until or '永久'}")


def cmd_unban(args) -> None:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        ensure_abuse_tables(cursor)
        cursor.execute("""
            UPDATE AbuseBans
            SET IsActive = 0, RevokedAt = SYSUTCDATETIME(), RevokeReason = ?
            WHERE BanID = ? AND IsActive = 1
        """, (args.reason, args.ban_id))
        changed = cursor.rowcount
        conn.commit()
        log_action(f"UNBAN id={args.ban_id} changed={changed} reason={args.reason}")
        print("已解封" if changed else "未找到有效 BAN 或已解封")
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def cmd_bans(args) -> None:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        ensure_abuse_tables(cursor)
        where = "WHERE IsActive = 1 AND (BannedUntil IS NULL OR BannedUntil > SYSUTCDATETIME())" if args.active_only else ""
        cursor.execute(f"""
            SELECT TOP (?) BanID, SubjectType, SubjectValue, Scope, Reason, BannedAt, BannedUntil, IsActive
            FROM AbuseBans
            {where}
            ORDER BY BanID DESC
        """, (args.limit,))
        for row in cursor.fetchall():
            print(f"#{int(row.BanID):<5} {row.SubjectType}:{row.SubjectValue:<18} scope={row.Scope:<14} active={bool(row.IsActive)} until={row.BannedUntil or '永久'} reason={row.Reason or ''}")
    finally:
        cursor.close()
        conn.close()


def cmd_events(args) -> None:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        ensure_abuse_tables(cursor)
        cursor.execute("""
            SELECT TOP (?) EventID, UserID, Username, IP, Action, Scope, Severity, Message, CreatedAt
            FROM AbuseEvents
            ORDER BY EventID DESC
        """, (args.limit,))
        for row in cursor.fetchall():
            who = row.Username or row.UserID or row.IP or "-"
            print(f"#{int(row.EventID):<6} {row.CreatedAt} {row.Severity:<8} {row.Action:<18} {who} {row.Message or ''}")
    finally:
        cursor.close()
        conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MusicCloud 本地 BAN 管理工具")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("users", help="搜索用户")
    p.add_argument("--keyword", default="", help="用户名或昵称关键词")
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=cmd_users)

    p = sub.add_parser("ban-user", help="封禁用户")
    p.add_argument("--user", required=True, help="用户名或 UserID")
    p.add_argument("--scope", default="all")
    p.add_argument("--reason", required=True)
    p.add_argument("--evidence", default="")
    p.add_argument("--hours", type=float, default=None, help="从现在起封禁多少小时，默认 24 小时")
    p.add_argument("--until", default="", help="解封时间")
    p.add_argument("--permanent", action="store_true", help="永久封禁")
    p.set_defaults(func=cmd_ban_user)

    p = sub.add_parser("ban-ip", help="封禁 IP")
    p.add_argument("--ip", required=True)
    p.add_argument("--scope", default="all")
    p.add_argument("--reason", required=True)
    p.add_argument("--evidence", default="")
    p.add_argument("--hours", type=float, default=None)
    p.add_argument("--until", default="")
    p.add_argument("--permanent", action="store_true")
    p.set_defaults(func=cmd_ban_ip)

    p = sub.add_parser("unban", help="按 BAN ID 解封")
    p.add_argument("--ban-id", type=int, required=True)
    p.add_argument("--reason", default="manual revoke")
    p.set_defaults(func=cmd_unban)

    p = sub.add_parser("bans", help="查看 BAN 记录")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--active-only", action="store_true")
    p.set_defaults(func=cmd_bans)

    p = sub.add_parser("events", help="查看违规事件")
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=cmd_events)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
