import { XMLParser } from 'fast-xml-parser';
import he from 'he';
import type { Entry } from './types';

const parser = new XMLParser({
  ignoreAttributes: true, parseTagValue: false, processEntities: false,
  isArray: (name: string) => name === 'item',
});

export function plainText(input: string, limit = 6000): string {
  // Bound cleaning work even when Joomla embeds almost a megabyte in a description.
  let text = input.slice(0, 80_000);
  for (let i = 0; i < 2; i++) {
    text = he.decode(text)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ');
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function canonicalUrl(input: string): string {
  const u = new URL(he.decode(input.trim()));
  if (!['https:', 'http:'].includes(u.protocol) || !['ifnmg.edu.br', 'www.ifnmg.edu.br'].includes(u.hostname) || u.username || u.password || u.port) {
    throw new Error('UntrustedArticleUrl');
  }
  u.protocol = 'https:';
  u.hostname = 'www.ifnmg.edu.br';
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k);
  u.searchParams.sort();
  return u.toString();
}

function scalar(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseFeed(xml: string, cleanDescriptions = true): Entry[] {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<\/rss\s*>\s*$/i.test(xml.trim())) {
    throw new Error('InvalidRss');
  }
  const doc = parser.parse(xml);
  if (!doc?.rss || !Object.hasOwn(doc.rss, 'channel')) throw new Error('InvalidRss');
  const items = doc.rss.channel.item ?? [];
  if (items.length > 100) throw new Error('FeedTooManyItems');
  const result: Entry[] = [];
  for (const item of items) {
    const title = plainText(scalar(item.title), 500);
    const link = scalar(item.link);
    if (!title || !link) throw new Error('MissingRssFields');
    const url = canonicalUrl(link);
    const date = Date.parse(scalar(item.pubDate));
    result.push({ url, guid: he.decode(scalar(item.guid)) || url, title,
      summary: cleanDescriptions ? plainText(scalar(item.description)) : scalar(item.description),
      published: Number.isFinite(date) ? new Date(date).toISOString() : null });
  }
  return result;
}

export async function readLimited(response: Response, limit = 2_000_000): Promise<string> {
  if (!response.body) throw new Error('EmptyBody');
  const reader = response.body.getReader();
  const chunks:Uint8Array[]=[];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Error('BodyTooLarge'); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length; }
  return new TextDecoder().decode(bytes);
}

export async function articleId(url: string): Promise<string> {
  return hashText(canonicalUrl(url));
}

export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function feedHash(xml: string): Promise<string> {
  if (!/<\/rss\s*>\s*$/i.test(xml.trim())) throw new Error('InvalidRss');
  const guids=[...xml.matchAll(/<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/g)].map(m=>m[1].trim());
  // This project intentionally ignores revisions. Hash stable IDs, not megabytes
  // of old article HTML; a new RSS item changes the signature and triggers parsing.
  if(guids.length) return hashText(JSON.stringify(guids));
  const start=xml.search(/<item[\s>]/),end=xml.lastIndexOf('</item>');
  // Joomla can regenerate channel timestamps without changing any article.
  return hashText(start<0?xml:xml.slice(start,end+7));
}
