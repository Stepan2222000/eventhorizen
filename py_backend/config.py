"""Configuration loading from environment variables."""

from __future__ import annotations

import os
from typing import Dict, Literal, Optional

from pydantic import BaseModel, PositiveInt, ValidationError, constr

PgSslConfig = Optional[Dict[str, bool]]


def get_pg_ssl_config(mode: object) -> PgSslConfig:
    if not mode or not isinstance(mode, str):
        return None

    normalized = mode.strip().lower()
    if not normalized or normalized == "disable":
        return None
    if normalized in {"verify-ca", "verify-full"}:
        return {"rejectUnauthorized": True}
    # prefer/require and any other truthy string: enable SSL with self-signed allowed.
    return {"rejectUnauthorized": False}


class _DbEnvSchema(BaseModel):
    host: constr(min_length=1)
    port: PositiveInt = 5432
    database: constr(min_length=1)
    user: constr(min_length=1)
    password: constr(min_length=1)
    ssl: str | None = None


class DbConfig(BaseModel):
    host: str
    port: int
    database: str
    user: str
    password: str
    ssl: str | None = None
    ssl_config: PgSslConfig = None


class AppConfig(BaseModel):
    parts_db: DbConfig
    inventory_db: DbConfig


def _validate_db_env(raw: dict[str, str | None]) -> _DbEnvSchema:
    if hasattr(_DbEnvSchema, "model_validate"):
        return _DbEnvSchema.model_validate(raw)  # pydantic v2
    return _DbEnvSchema.parse_obj(raw)  # pydantic v1


def read_db_config(prefix: Literal["PARTS_DB", "INVENTORY_DB"]) -> DbConfig:
    raw = {
        "host": os.getenv(f"{prefix}_HOST"),
        "port": os.getenv(f"{prefix}_PORT"),
        "database": os.getenv(f"{prefix}_NAME"),
        "user": os.getenv(f"{prefix}_USER"),
        "password": os.getenv(f"{prefix}_PASSWORD"),
        "ssl": os.getenv(f"{prefix}_SSL"),
    }

    try:
        parsed = _validate_db_env(raw)
    except ValidationError as exc:
        env_name_by_key = {
            "host": f"{prefix}_HOST",
            "port": f"{prefix}_PORT",
            "database": f"{prefix}_NAME",
            "user": f"{prefix}_USER",
            "password": f"{prefix}_PASSWORD",
            "ssl": f"{prefix}_SSL",
        }
        missing = [
            env_name_by_key.get(key, f"{prefix}_{key.upper()}")
            for key, value in raw.items()
            if key != "ssl" and not value
        ]
        details = "; ".join(
            f"{'.'.join(str(p) for p in issue.get('loc', ()))}: {issue.get('msg', 'Invalid value')}"
            for issue in exc.errors()
        )
        raise ValueError(
            "Missing/invalid DB env for "
            f"{prefix}. Missing: {', '.join(missing) or 'unknown'}. Details: {details}. "
            "Tip: create a .env file based on .env.example or export env vars before starting the server."
        ) from exc

    return DbConfig(
        host=parsed.host,
        port=int(parsed.port),
        database=parsed.database,
        user=parsed.user,
        password=parsed.password,
        ssl=parsed.ssl if parsed.ssl is not None else None,
        ssl_config=get_pg_ssl_config(parsed.ssl),
    )


def read_app_config_from_env() -> AppConfig:
    return AppConfig(
        parts_db=read_db_config("PARTS_DB"),
        inventory_db=read_db_config("INVENTORY_DB"),
    )


# TypeScript-compatible aliases.
getPgSslConfig = get_pg_ssl_config
readDbConfig = read_db_config
readAppConfigFromEnv = read_app_config_from_env
