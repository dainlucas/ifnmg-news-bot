import type { Env } from './types';

export class TelegramError extends Error {
  constructor(public status: number, public retryAfter = 0) {
    super('Telegram request failed'); this.name = `TelegramHTTP${status}`;
  }
}

export async function telegram(env: Env, method: string, body: Record<string, unknown>): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', signal: AbortSignal.timeout(12_000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { throw new TelegramError(0); }
  let data: any;
  try { data = await response.json(); } catch { throw new TelegramError(response.status); }
  if (!response.ok || !data.ok) throw new TelegramError(data.error_code ?? response.status, data.parameters?.retry_after ?? 0);
  return data.result;
}

export const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function newsMessage(article: { title: string; summary: string; url: string; source_name: string }, names: string[]): string {
  // Bound raw input lengths, leaving margin under Telegram's post-entity 4096 limit.
  return `<b>${escapeHtml(article.title.slice(0, 400))}</b>\n\n${escapeHtml(article.summary.slice(0, 2200))}\n\n` +
    `🏷 ${escapeHtml(names.join(' · ').slice(0, 400))}\nFonte: ${escapeHtml(article.source_name.slice(0, 100))}\n` +
    `<a href="${escapeHtml(article.url)}">Ler publicação no IFNMG</a>`;
}
