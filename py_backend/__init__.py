"""Infrastructure modules ported from the TypeScript backend."""

from .config import (
    AppConfig,
    DbConfig,
    PgSslConfig,
    get_pg_ssl_config,
    read_app_config_from_env,
    read_db_config,
)
from .context import AppContext, init_app_context
from .db import DbPools, create_db_pools_from_env
from .inventory_schema import ensure_inventory_schema
from .normalization import articles_match, normalize_article
from .smart_cache import Smart, SmartCache, load_smart_cache

__all__ = [
    "AppConfig",
    "AppContext",
    "DbConfig",
    "DbPools",
    "PgSslConfig",
    "Smart",
    "SmartCache",
    "articles_match",
    "create_db_pools_from_env",
    "ensure_inventory_schema",
    "get_pg_ssl_config",
    "init_app_context",
    "load_smart_cache",
    "normalize_article",
    "read_app_config_from_env",
    "read_db_config",
]
