"""Database pools bootstrap using asyncpg."""

from __future__ import annotations

import ssl
from dataclasses import dataclass

import asyncpg

from .config import PgSslConfig, read_app_config_from_env


@dataclass(slots=True)
class DbPools:
    parts_pool: asyncpg.Pool
    inventory_pool: asyncpg.Pool


def _to_asyncpg_ssl_arg(ssl_config: PgSslConfig) -> ssl.SSLContext | None:
    if ssl_config is None:
        return None

    context = ssl.create_default_context()
    if not ssl_config.get("rejectUnauthorized", False):
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    return context


async def create_db_pools_from_env() -> DbPools:
    config = read_app_config_from_env()

    parts_pool = await asyncpg.create_pool(
        host=config.parts_db.host,
        port=config.parts_db.port,
        database=config.parts_db.database,
        user=config.parts_db.user,
        password=config.parts_db.password,
        ssl=_to_asyncpg_ssl_arg(config.parts_db.ssl_config),
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
        ssl=_to_asyncpg_ssl_arg(config.inventory_db.ssl_config),
        # Keep startup fail-fast, but avoid flaky remote connections.
        timeout=20.0,
        max_inactive_connection_lifetime=30.0,
        max_size=10,
        min_size=0,
    )

    return DbPools(parts_pool=parts_pool, inventory_pool=inventory_pool)


# TypeScript-compatible alias.
createDbPoolsFromEnv = create_db_pools_from_env
