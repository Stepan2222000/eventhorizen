"""Article normalization logic ported from shared/normalization.ts."""

from __future__ import annotations

import re

_CYRILLIC_TO_LATIN: dict[str, str] = {
    "А": "A",
    "В": "B",
    "Е": "E",
    "К": "K",
    "М": "M",
    "Н": "H",
    "О": "O",
    "Р": "P",
    "С": "C",
    "Т": "T",
    "У": "Y",
    "Х": "X",
    "Ё": "E",
}


def normalize_article(article: str) -> str:
    """Normalize article codes for fuzzy matching."""
    if not article:
        return ""

    normalized = article.upper()
    normalized = re.sub(r"[\s\-_./]", "", normalized)
    normalized = re.sub(
        r"[АВЕКМНОРСТУХЁ]",
        lambda m: _CYRILLIC_TO_LATIN.get(m.group(0), m.group(0)),
        normalized,
    )
    return normalized


def articles_match(article1: str, article2: str) -> bool:
    """Check whether two article codes match after normalization."""
    return normalize_article(article1) == normalize_article(article2)


# TypeScript-compatible aliases.
normalizeArticle = normalize_article
articlesMatch = articles_match
