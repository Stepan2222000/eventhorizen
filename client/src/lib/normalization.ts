/**
 * Normalizes article codes for fuzzy matching
 * 1. Convert to uppercase
 * 2. Remove delimiters (space, -, _, ., /)
 * 3. Replace Cyrillic characters with Latin equivalents
 */
export function normalizeArticle(article: string): string {
  if (!article) return '';
  
  // Step 1: Convert to uppercase
  let normalized = article.toUpperCase();
  
  // Step 2: Remove delimiters
  normalized = normalized.replace(/[\s\-_./]/g, '');
  
  // Step 3: Replace Cyrillic with Latin
  const cyrillicToLatin: { [key: string]: string } = {
    'А': 'A',
    'В': 'B',
    'Е': 'E',
    'К': 'K',
    'М': 'M',
    'Н': 'H',
    'О': 'O',
    'Р': 'P',
    'С': 'C',
    'Т': 'T',
    'У': 'Y',
    'Х': 'X',
    'Ё': 'E',
  };
  
  normalized = normalized.replace(/[АВЕКМНОРСТУХЁ]/g, (char) => {
    return cyrillicToLatin[char] || char;
  });
  
  return normalized;
}

/**
 * Checks if two articles match after normalization
 */
export function articlesMatch(article1: string, article2: string): boolean {
  return normalizeArticle(article1) === normalizeArticle(article2);
}
