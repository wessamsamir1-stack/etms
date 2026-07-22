/**
 * Notification templating (per docs/etms/05 §9). Renders `{{var}}` placeholders
 * and enforces per-channel constraints. Pure and provider-agnostic.
 */
export type Channel = 'push' | 'sms' | 'email' | 'whatsapp';

export interface RenderResult {
  text: string;
  missing: string[];
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function render(
  template: string,
  vars: Record<string, string | number>,
): RenderResult {
  const missing: string[] = [];
  const text = template.replace(PLACEHOLDER, (_m, key: string) => {
    if (key in vars) return String(vars[key]);
    missing.push(key);
    return '';
  });
  return { text, missing };
}

/** Max characters per channel (SMS is the tight one). */
export const CHANNEL_LIMITS: Record<Channel, number> = {
  sms: 480, // 3 concatenated segments
  push: 240,
  whatsapp: 4096,
  email: 100000,
};

export function withinLimit(channel: Channel, text: string): boolean {
  return text.length <= CHANNEL_LIMITS[channel];
}
