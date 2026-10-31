export function loadJson<T extends object>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export function selfId(): string {
  const key = "cantinho-self";
  let id = sessionStorage.getItem(key);
  if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    sessionStorage.setItem(key, id);
  }
  return id;
}
