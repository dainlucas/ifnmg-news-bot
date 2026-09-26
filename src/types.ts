export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TYPESAFE_API_KEY: string;
  TELEGRAM_ADMIN_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TASK_SECRET: string;
  APP_URL: string;
  JEV_MODEL: string;
  MATCH_THRESHOLD: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_APPLICATION_ID?: string;
}
export interface Category {
  id: number; name: string; description: string; version: number; active: number;
}
export interface Entry {
  guid: string; url: string; title: string; summary: string; published: string | null;
}
export interface Article {
  id: string; title: string; summary: string; url: string; source_name: string;
  captured_at: number; categories: string; attempts: number;
}
export const now = () => Date.now();
export const statement = (db: D1Database, sql: string, ...values: (string | number | null)[]) =>
  db.prepare(sql).bind(...values);
export const errorCode = (error: unknown) => error instanceof Error ? error.name : 'UnknownError';
