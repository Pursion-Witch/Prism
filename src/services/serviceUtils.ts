export function sanitizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseJsonResponse(raw: string): unknown {
  const trimmed = raw.trim();
  const withoutCodeFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '');

  return JSON.parse(withoutCodeFence);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}
 