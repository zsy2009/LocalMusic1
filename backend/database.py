"""
MusicCloud database layer.

Provides:
  - get_db_connection()     raw pyodbc connection (for existing route code)
  - engine                   SQLAlchemy engine
  - SessionLocal             SQLAlchemy session factory
  - init_db()                schema creation + admin seed via SQLAlchemy
"""

import pyodbc
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# ═══════════════════════════════════════════════════════════════════
# MSSQL connection configuration
# ═══════════════════════════════════════════════════════════════════

_DRIVER   = "ODBC Driver 17 for SQL Server"
_SERVER   = "localhost"
_DATABASE = "MusicCloudDB"

_CONNECTION_STRING = (
    f"Driver={{{_DRIVER}}};"
    f"Server={_SERVER};"
    f"Database={_DATABASE};"
    f"Trusted_Connection=yes;"
)

_SQLALCHEMY_URL = (
    "mssql+pyodbc://@localhost/MusicCloudDB?"
    "driver=ODBC+Driver+17+for+SQL+Server&"
    "trusted_connection=yes"
)


# ═══════════════════════════════════════════════════════════════════
# Raw pyodbc (existing route code)
# ═══════════════════════════════════════════════════════════════════

def get_db_connection():
    """Return a raw pyodbc connection to MusicCloudDB."""
    return pyodbc.connect(_CONNECTION_STRING)


# ═══════════════════════════════════════════════════════════════════
# SQLAlchemy (schema management + optional ORM usage)
# ═══════════════════════════════════════════════════════════════════

engine = create_engine(_SQLALCHEMY_URL, echo=False)
SessionLocal = sessionmaker(bind=engine)


# ═══════════════════════════════════════════════════════════════════
# Schema initialisation
# ═══════════════════════════════════════════════════════════════════

def init_db():
    """Create all tables via SQLAlchemy, then seed default admin if empty."""
    from models import Base
    Base.metadata.create_all(bind=engine)

    # Seed default admin user (ignored if admin already exists)
    conn = get_db_connection()
    cursor = conn.cursor()

    # ── Column-level migrations (idempotent ALTER TABLE) ────────────
    migration_columns = [
        ("Users", "Nickname", "NVARCHAR(100) NULL"),
        ("Users", "AvatarUrl", "NVARCHAR(500) NULL"),
        ("Users", "Country", "NVARCHAR(100) NULL"),
        ("Users", "Province", "NVARCHAR(100) NULL"),
        ("Users", "City", "NVARCHAR(100) NULL"),
        ("Users", "District", "NVARCHAR(100) NULL"),
    ]
    for table, col, col_type in migration_columns:
        cursor.execute(f"""
            IF NOT EXISTS (
                SELECT * FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '{table}' AND COLUMN_NAME = '{col}'
            )
            BEGIN
                ALTER TABLE [{table}] ADD [{col}] {col_type};
            END
        """)

    cursor.execute("SELECT COUNT(*) FROM Users")
    if cursor.fetchone()[0] == 0:
        import bcrypt
        pw_hash = bcrypt.hashpw(
            "123456".encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")
        cursor.execute(
            "INSERT INTO Users (Username, PasswordHash, Nickname, Role, IsActive) "
            "VALUES ('admin', ?, 'Super Admin', 'Admin', 1)",
            (pw_hash,)
        )
        conn.commit()
    cursor.close()
    conn.close()
    print("Database initialized successfully (SQLAlchemy schema applied).")


if __name__ == '__main__':
    init_db()
