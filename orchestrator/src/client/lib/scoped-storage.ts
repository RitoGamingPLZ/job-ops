export function readScopedStorage(storageKey: string, legacyKey: string): string | null {
  const scoped = localStorage.getItem(storageKey);
  if (scoped || storageKey === legacyKey) return scoped;
  return localStorage.getItem(legacyKey);
}

export function migrateLegacyScopedStorage(storageKey: string, legacyKey: string, raw: string) {
  if (storageKey === legacyKey || localStorage.getItem(storageKey)) return;
  localStorage.setItem(storageKey, raw);
}
