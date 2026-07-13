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
    f"Encrypt=no;"
    f"TrustServerCertificate=yes;"
)

_SQLALCHEMY_URL = (
    "mssql+pyodbc://@localhost/MusicCloudDB?"
    "driver=ODBC+Driver+17+for+SQL+Server&"
    "trusted_connection=yes&"
    "Encrypt=no&"
    "TrustServerCertificate=yes"
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
        ("Users", "CountryAdcode", "NVARCHAR(20) NULL"),
        ("Users", "ProvinceAdcode", "NVARCHAR(20) NULL"),
        ("Users", "CityAdcode", "NVARCHAR(20) NULL"),
        ("Users", "DistrictAdcode", "NVARCHAR(20) NULL"),
        ("Users", "LocationAdcode", "NVARCHAR(20) NULL"),
        ("Users", "LocationName", "NVARCHAR(100) NULL"),
        ("Users", "LocationLevel", "NVARCHAR(20) NULL"),
        ("Users", "LocationCenter", "NVARCHAR(50) NULL"),
        ("Users", "LocationSource", "NVARCHAR(20) NULL"),
        ("Users", "LocationCountryCode", "NVARCHAR(10) NULL"),
        ("Users", "LocationGeonameID", "NVARCHAR(30) NULL"),
        ("Users", "LocationLatitude", "FLOAT NULL"),
        ("Users", "LocationLongitude", "FLOAT NULL"),
        ("Users", "LocationTimezone", "NVARCHAR(100) NULL"),
        ("Users", "LastSongID", "INT NULL"),
        ("Users", "VisualizerEnabled", "BIT NOT NULL DEFAULT 1"),
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
