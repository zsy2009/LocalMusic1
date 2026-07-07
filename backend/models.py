"""
MusicCloud SQLAlchemy ORM models.

All 6 core tables + auxiliary tables for full application support.
Table names and columns match the project specification exactly.
"""

from sqlalchemy import (
    Column, Integer, BigInteger, String, Unicode, Boolean,
    DateTime, Text, ForeignKey, UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

# ═══════════════════════════════════════════════════════════════════
# 1. Users — user accounts and profiles
# ═══════════════════════════════════════════════════════════════════

class User(Base):
    __tablename__ = 'Users'

    UserID       = Column(Integer, primary_key=True, autoincrement=True)
    Username     = Column(String(50), unique=True, nullable=False)
    PasswordHash = Column(String(255), nullable=False)
    Nickname     = Column(Unicode(100), nullable=True)
    AvatarUrl    = Column(Unicode(500), nullable=True)
    Role         = Column(String(20), nullable=False, default='User')
    IsActive     = Column(Boolean, nullable=False, default=True)
    Country      = Column(Unicode(100), nullable=True)
    Province     = Column(Unicode(100), nullable=True)
    City         = Column(Unicode(100), nullable=True)
    District     = Column(Unicode(100), nullable=True)


# ═══════════════════════════════════════════════════════════════════
# 2. Songs — music file metadata
#    Constraints: UNIQUE(Title, Artist) + UNIQUE(FilePath)
# ═══════════════════════════════════════════════════════════════════

class Song(Base):
    __tablename__ = 'Songs'
    __table_args__ = (
        UniqueConstraint('Title', 'Artist', name='UQ_Songs_Title_Artist'),
    )

    SongID     = Column(Integer, primary_key=True, autoincrement=True)
    Title      = Column(Unicode(200), nullable=False)
    Artist     = Column(Unicode(500), nullable=False, default='')
    Album      = Column(Unicode(200), nullable=True)
    FilePath   = Column(Unicode(500), unique=True, nullable=False)
    CoverPath  = Column(Unicode(500), nullable=True)
    Folder     = Column(Unicode(500), nullable=True)
    Duration   = Column(Integer, nullable=True)
    Bitrate    = Column(Integer, nullable=True)
    SampleRate = Column(Integer, nullable=True)


# ═══════════════════════════════════════════════════════════════════
# 3. Playlists — user-created song collections
# ═══════════════════════════════════════════════════════════════════

class Playlist(Base):
    __tablename__ = 'Playlists'

    PlaylistID = Column(Integer, primary_key=True, autoincrement=True)
    UserID     = Column(Integer, ForeignKey('Users.UserID', ondelete='CASCADE'),
                        nullable=False)
    Name       = Column(Unicode(200), nullable=False)
    CreatedAt  = Column(DateTime, nullable=False)


# ═══════════════════════════════════════════════════════════════════
# 4. PlaylistSongs — mapping between playlists and songs
# ═══════════════════════════════════════════════════════════════════

class PlaylistSong(Base):
    __tablename__ = 'PlaylistSongs'

    PlaylistID = Column(Integer, ForeignKey('Playlists.PlaylistID',
                        ondelete='CASCADE'), primary_key=True)
    SongID     = Column(Integer, ForeignKey('Songs.SongID',
                        ondelete='CASCADE'), primary_key=True)


# ═══════════════════════════════════════════════════════════════════
# 5. Favorites — "red heart" liked songs
#    Constraint: UNIQUE(UserID, SongID)
# ═══════════════════════════════════════════════════════════════════

class Favorite(Base):
    __tablename__ = 'Favorites'
    __table_args__ = (
        UniqueConstraint('UserID', 'SongID', name='UQ_Favorites_User_Song'),
    )

    UserID = Column(Integer, ForeignKey('Users.UserID', ondelete='CASCADE'),
                    primary_key=True)
    SongID = Column(Integer, ForeignKey('Songs.SongID', ondelete='CASCADE'),
                    primary_key=True)


# ═══════════════════════════════════════════════════════════════════
# 6. PlayStats — per-user play counts
# ═══════════════════════════════════════════════════════════════════

class PlayStat(Base):
    __tablename__ = 'PlayStats'

    UserID     = Column(Integer, ForeignKey('Users.UserID', ondelete='CASCADE'),
                        primary_key=True)
    SongID     = Column(Integer, ForeignKey('Songs.SongID', ondelete='CASCADE'),
                        primary_key=True)
    play_count = Column(Integer, nullable=False, default=0)
    LastPlayed = Column(DateTime, nullable=True)


# ═══════════════════════════════════════════════════════════════════
# Auxiliary tables (required by existing application logic)
# ═══════════════════════════════════════════════════════════════════

class RefreshToken(Base):
    __tablename__ = 'RefreshTokens'

    TokenID   = Column(Integer, primary_key=True, autoincrement=True)
    UserID    = Column(Integer, ForeignKey('Users.UserID', ondelete='CASCADE'),
                       nullable=False)
    Token     = Column(String(500), nullable=False)
    ExpiresAt = Column(DateTime, nullable=False)


class Artist(Base):
    __tablename__ = 'Artists'

    ArtistID = Column(Integer, primary_key=True, autoincrement=True)
    Name     = Column(Unicode(100), unique=True, nullable=False)


class SongArtistMapping(Base):
    __tablename__ = 'Song_Artist_Mapping'

    SongID   = Column(Integer, ForeignKey('Songs.SongID', ondelete='CASCADE'),
                      primary_key=True)
    ArtistID = Column(Integer, ForeignKey('Artists.ArtistID', ondelete='CASCADE'),
                      primary_key=True)


class AuditLog(Base):
    __tablename__ = 'AuditLogs'

    LogID     = Column(BigInteger, primary_key=True, autoincrement=True)
    UserID    = Column(Integer, nullable=True)
    Action    = Column(Unicode(100), nullable=False)
    IPAddress = Column(String(50), nullable=True)
    Timestamp = Column(DateTime, nullable=False)


class SongLyric(Base):
    __tablename__ = 'SongLyrics'

    SongID     = Column(Integer, ForeignKey('Songs.SongID', ondelete='CASCADE'),
                        primary_key=True)
    LyricsText = Column(Text, nullable=True)
