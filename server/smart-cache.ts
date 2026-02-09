import type { Pool } from "pg";
import type { Smart } from "@shared/schema";
import { normalizeArticle } from "@shared/normalization";

type SmartInternal = Smart & {
  normalizedSmart: string;
  normalizedArticles: string[];
};

export type SmartCache = {
  size: number;
  getBySmart: (smart: string) => Smart | undefined;
  search: (normalizedQuery: string, limit?: number) => Smart[];
};

function toArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}

export async function loadSmartCache(partsPool: Pool): Promise<SmartCache> {
  const res = await partsPool.query<{
    smart: string;
    articles: unknown;
    name: string | null;
    brand: unknown;
    description: unknown;
  }>(`
    SELECT
      smart,
      "артикул" as articles,
      "наименование" as name,
      "бренд" as brand,
      "коннект_бренд" as description
    FROM public.smart
  `);

  const items: SmartInternal[] = res.rows.map((row) => {
    const articles = toArray(row.articles);
    return {
      smart: row.smart,
      articles,
      name: row.name,
      brand: toArray(row.brand),
      description: toArray(row.description),
      normalizedSmart: normalizeArticle(row.smart),
      normalizedArticles: articles.map((a) => normalizeArticle(a)),
    };
  });

  const bySmart = new Map<string, SmartInternal>();
  for (const item of items) {
    bySmart.set(item.smart, item);
  }

  return {
    size: items.length,
    getBySmart: (smartCode: string) => bySmart.get(smartCode),
    search: (normalizedQuery: string, limit = 50) => {
      const q = normalizeArticle(normalizedQuery);
      if (!q) return [];

      const scored: Array<{ score: number; item: SmartInternal }> = [];

      for (const item of items) {
        let best = 0;

        if (item.normalizedSmart === q) best = Math.max(best, 70);
        else if (item.normalizedSmart.startsWith(q)) best = Math.max(best, 60);
        else if (item.normalizedSmart.includes(q)) best = Math.max(best, 50);

        for (const art of item.normalizedArticles) {
          if (art === q) best = Math.max(best, 100);
          else if (art.startsWith(q)) best = Math.max(best, 90);
          else if (art.includes(q)) best = Math.max(best, 80);
        }

        if (best > 0) scored.push({ score: best, item });
      }

      scored.sort((a, b) => b.score - a.score || a.item.smart.localeCompare(b.item.smart));

      return scored.slice(0, limit).map(({ item }) => ({
        smart: item.smart,
        articles: item.articles,
        name: item.name,
        brand: item.brand,
        description: item.description,
      }));
    },
  };
}

