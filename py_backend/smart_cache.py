"""SMART cache loading and in-memory search."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import asyncpg
from pydantic import BaseModel, Field

from .normalization import normalize_article


class Smart(BaseModel):
    smart: str
    articles: list[str] = Field(default_factory=list)
    name: str | None = None
    brand: list[str] = Field(default_factory=list)
    description: list[str] = Field(default_factory=list)


@dataclass
class _SmartInternal:
    smart: str
    articles: list[str]
    name: str | None
    brand: list[str]
    description: list[str]
    normalized_smart: str
    normalized_articles: list[str]

    def as_public(self) -> Smart:
        return Smart(
            smart=self.smart,
            articles=list(self.articles),
            name=self.name,
            brand=list(self.brand),
            description=list(self.description),
        )


def to_array(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    if isinstance(value, str):
        return [value]
    return []


class SmartCache:
    def __init__(self, items: Iterable[_SmartInternal]):
        self._items = list(items)
        self._by_smart = {item.smart: item for item in self._items}

    @property
    def size(self) -> int:
        return len(self._items)

    def get_by_smart(self, smart: str) -> Smart | None:
        item = self._by_smart.get(smart)
        return item.as_public() if item else None

    # TypeScript-compatible name used by the ported storage layer.
    def getBySmart(self, smart: str) -> Smart | None:
        return self.get_by_smart(smart)

    def search(self, normalized_query: str, limit: int = 50) -> list[Smart]:
        q = normalize_article(normalized_query)
        if not q:
            return []

        scored: list[tuple[int, _SmartInternal]] = []
        for item in self._items:
            best = 0

            if item.normalized_smart == q:
                best = max(best, 70)
            elif item.normalized_smart.startswith(q):
                best = max(best, 60)
            elif q in item.normalized_smart:
                best = max(best, 50)

            for article in item.normalized_articles:
                if article == q:
                    best = max(best, 100)
                elif article.startswith(q):
                    best = max(best, 90)
                elif q in article:
                    best = max(best, 80)

            if best > 0:
                scored.append((best, item))

        scored.sort(key=lambda pair: (-pair[0], pair[1].smart))
        return [item.as_public() for _, item in scored[:limit]]


async def load_smart_cache(parts_pool: asyncpg.Pool) -> SmartCache:
    rows = await parts_pool.fetch(
        """
        SELECT
          smart,
          "артикул" as articles,
          "наименование" as name,
          "бренд" as brand,
          "коннект_бренд" as description
        FROM public.smart
        """
    )

    items: list[_SmartInternal] = []
    for row in rows:
        articles = to_array(row["articles"])
        smart = str(row["smart"])
        items.append(
            _SmartInternal(
                smart=smart,
                articles=articles,
                name=row["name"],
                brand=to_array(row["brand"]),
                description=to_array(row["description"]),
                normalized_smart=normalize_article(smart),
                normalized_articles=[normalize_article(article) for article in articles],
            )
        )

    return SmartCache(items)


# TypeScript-compatible aliases.
loadSmartCache = load_smart_cache
