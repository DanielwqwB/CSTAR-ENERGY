"""Environment-backed application settings."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """Runtime configuration loaded from environment and optional .env file."""
    app_name: str = "CSTAR-Energy API"
    app_env: str = "development"
    debug: bool = True
    database_url: str = "postgresql+psycopg://username:password@localhost:5432/cstar_energy"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret_key: str = "replace_with_secure_random_secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    @field_validator("debug", mode="before")
    @classmethod
    def normalize_debug(cls, value: object) -> object:
        """Ignore unrelated host DEBUG values that are not boolean settings."""
        if isinstance(value, str) and value.lower() not in {"true", "false", "1", "0", "yes", "no", "on", "off"}:
            return True
        return value

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()
