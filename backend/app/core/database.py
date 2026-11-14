"""SQLAlchemy and GeoAlchemy2 setup; no connection is opened at import time."""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings

class Base(DeclarativeBase):
    """Base for future SQLAlchemy models."""

engine = create_engine(get_settings().database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
