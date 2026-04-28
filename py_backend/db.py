"""Database pools bootstrap using asyncpg."""

from __future__ import annotations

from dataclasses import dataclass

import asyncpg

from .config import read_app_config_from_env


@dataclass
class DbPools:
    parts_pool: asyncpg.Pool
    inventory_pool: asyncpg.Pool


def _to_asyncpg_ssl_arg(mode: str | None) -> str:
    # asyncpg handles libpq-style ssl modes directly; passing None here can
    # trigger an unwanted SSL upgrade attempt against non-SSL Postgres servers.
    if not mode or not mode.strip():
        return "prefer"

    normalized = mode.strip().lower()
    if normalized in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
        return normalized

    return "prefer"


async def _init_inventory_connection(conn: asyncpg.Connection) -> None:
    # Keep DB session timezone aligned with business timezone assumptions.
    await conn.execute("SET TIME ZONE 'Europe/Moscow'")


async def create_db_pools_from_env() -> DbPools:
    config = read_app_config_from_env()

    parts_pool = await asyncpg.create_pool(
        host=config.parts_db.host,
        port=config.parts_db.port,
        database=config.parts_db.database,
        user=config.parts_db.user,
        password=config.parts_db.password,
        ssl=_to_asyncpg_ssl_arg(config.parts_db.ssl),
        # Keep startup fail-fast, but avoid flaky remote connections.
        timeout=20.0,
        max_inactive_connection_lifetime=30.0,
        max_size=10,
        min_size=0,
    )

    inventory_pool = await asyncpg.create_pool(
        host=config.inventory_db.host,
        port=config.inventory_db.port,
        database=config.inventory_db.database,
        user=config.inventory_db.user,
        password=config.inventory_db.password,
        ssl=_to_asyncpg_ssl_arg(config.inventory_db.ssl),
        # Keep startup fail-fast, but avoid flaky remote connections.
        timeout=20.0,
        max_inactive_connection_lifetime=30.0,
        max_size=10,
        min_size=0,
        init=_init_inventory_connection,
    )

    return DbPools(parts_pool=parts_pool, inventory_pool=inventory_pool)


# TypeScript-compatible alias.
createDbPoolsFromEnv = create_db_pools_from_env
