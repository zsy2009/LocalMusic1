import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt


# ── Password hashing ──────────────────────────────────────────────


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Return True if plain_password matches the hashed_password."""
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )


def get_password_hash(password: str) -> str:
    """Return a bcrypt hash of the given password."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# ── JWT configuration ─────────────────────────────────────────────
SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("安全警告: JWT_SECRET_KEY 未在 .env 文件中配置！")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 4320  # 3 days
REFRESH_TOKEN_EXPIRE_DAYS = 7


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a signed JWT access token.

    Parameters
    ----------
    data : dict
        Payload claims (e.g. ``{"sub": username}``).
    expires_delta : timedelta | None
        Custom lifetime; defaults to ACCESS_TOKEN_EXPIRE_MINUTES.

    Returns
    -------
    str
        Encoded JWT string.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a signed JWT refresh token.

    Parameters
    ----------
    data : dict
        Payload claims.
    expires_delta : timedelta | None
        Custom lifetime; defaults to REFRESH_TOKEN_EXPIRE_DAYS.

    Returns
    -------
    str
        Encoded JWT string.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta
        if expires_delta is not None
        else timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    )
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT.  Raises ``jwt.PyJWTError`` on failure."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
