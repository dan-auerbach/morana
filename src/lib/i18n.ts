const cache: Record<string, Record<string, string>> = {};

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      Object.assign(result, flatten(v as Record<string, unknown>, key));
    } else {
      result[key] = String(v);
    }
  }
  return result;
}

export async function getDictionary(
  locale: string,
  namespace: string
): Promise<Record<string, string>> {
  const key = `${locale}/${namespace}`;
  if (cache[key]) return cache[key];

  try {
    const mod = await import(`@/locales/${locale}/${namespace}.json`);
    cache[key] = flatten(mod.default);
    return cache[key];
  } catch {
    // Fallback to English
    if (locale !== "en") return getDictionary("en", namespace);
    return {};
  }
}
