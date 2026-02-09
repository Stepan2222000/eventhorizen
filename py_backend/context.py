"""Application context bootstrap and background SMART cache refresh."""

from __future__ import annotations

import asyncio
import logging
import math
import os
import random
import time
from dataclasses import dataclass
from typing import Any, Callable, Protocol, runtime_checkable

import asyncpg

from .db import DbPools, create_db_pools_from_env
from .inventory_schema import ensure_inventory_schema
from .smart_cache import SmartCache, load_smart_cache

SMART_CACHE_REFRESH_MS = 10 * 60 * 1000  # 10 минут


@runtime_checkable
class SupportsSmartCacheUpdate(Protocol):
    def update_smart_cache(self, cache: SmartCache) -> None: ...


StorageFactory = Callable[[asyncpg.Pool, SmartCache], Any]


@dataclass
class AppContext:
    pools: DbPools
    smart_cache: SmartCache
    storage: Any
    _refresh_task: asyncio.Task[None] | None = None


async def sleep(ms: int) -> None:
    await asyncio.sleep(ms / 1000)


def get_db_connect_max_wait_ms() -> int:
    # In development DB containers can take a bit to come up; avoid immediate exit.
    raw = os.getenv("DB_CONNECT_MAX_WAIT_MS")
    if raw and raw.strip():
        try:
            value = float(raw)
        except ValueError:
            value = float("nan")
        if math.isfinite(value) and value >= 0:
            return int(value)

    return 60_000 if os.getenv("NODE_ENV") == "development" else 10_000


async def wait_for_db(pool: asyncpg.Pool, label: str, max_wait_ms: int) -> None:
    started_at_ms = int(time.time() * 1000)
    attempt = 0

    while True:
        conn: asyncpg.Connection | None = None
        try:
            conn = await pool.acquire()
            await conn.execute("SELECT 1")
            return
        except Exception as err:
            elapsed_ms = int(time.time() * 1000) - started_at_ms
            message = str(err)
            if elapsed_ms >= max_wait_ms:
                raise RuntimeError(f"{label} DB is not reachable after {elapsed_ms}ms: {message}") from err

            attempt += 1
            base_delay_ms = 250
            max_delay_ms = 5_000
            exp_delay_ms = min(max_delay_ms, int(base_delay_ms * (2 ** (attempt - 1))))
            jitter_ms = random.randint(0, 199)
            wait_ms = min(exp_delay_ms + jitter_ms, max(0, max_wait_ms - elapsed_ms))

            logging.warning(
                "%s DB is not reachable yet (%s). Retrying in %sms...",
                label,
                message,
                wait_ms,
            )
            await sleep(wait_ms)
        finally:
            if conn is not None:
                await pool.release(conn)


def start_smart_cache_refresh(ctx: AppContext) -> None:
    def _apply_new_cache(cache: SmartCache) -> None:
        if isinstance(ctx.storage, SupportsSmartCacheUpdate):
            ctx.storage.update_smart_cache(cache)
        elif hasattr(ctx.storage, "updateSmartCache"):
            ctx.storage.updateSmartCache(cache)

    async def _refresh_loop() -> None:
        while True:
            await asyncio.sleep(SMART_CACHE_REFRESH_MS / 1000)
            try:
                new_cache = await load_smart_cache(ctx.pools.parts_pool)
                _apply_new_cache(new_cache)
                ctx.smart_cache = new_cache
                logging.info("SMART cache refreshed: %s entries", new_cache.size)
            except Exception as err:
                logging.warning(
                    "SMART cache refresh failed, keeping old cache: %s",
                    str(err),
                )

    ctx._refresh_task = asyncio.create_task(_refresh_loop())


async def init_app_context(storage_factory: StorageFactory | None = None) -> AppContext:
    pools = await create_db_pools_from_env()
    max_wait_ms = get_db_connect_max_wait_ms()

    try:
        await asyncio.gather(
            wait_for_db(pools.parts_pool, "PARTS", max_wait_ms),
            wait_for_db(pools.inventory_pool, "INVENTORY", max_wait_ms),
        )

        await ensure_inventory_schema(pools.inventory_pool)
        smart_cache = await load_smart_cache(pools.parts_pool)
        storage = storage_factory(pools.inventory_pool, smart_cache) if storage_factory else None

        ctx = AppContext(pools=pools, smart_cache=smart_cache, storage=storage)
        start_smart_cache_refresh(ctx)
        return ctx
    except Exception:
        try:
            await pools.parts_pool.close()
        except Exception:
            # ignore
            pass
        try:
            await pools.inventory_pool.close()
        except Exception:
            # ignore
            pass
        raise


# TypeScript-compatible aliases.
getDbConnectMaxWaitMs = get_db_connect_max_wait_ms
waitForDb = wait_for_db
startSmartCacheRefresh = start_smart_cache_refresh
initAppContext = init_app_context
