-- Additive migration: Telegram subscriptions, deliveries and history are untouched.
-- Discord snowflakes must always remain TEXT, including message/interaction IDs.
CREATE TABLE discord_channels (
  id TEXT PRIMARY KEY, guild_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  retry_at INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE TABLE discord_subscriptions (
  channel_id TEXT NOT NULL REFERENCES discord_channels(id),
  category_id INTEGER NOT NULL REFERENCES categories(id), created_at INTEGER NOT NULL,
  PRIMARY KEY(channel_id, category_id)
);
CREATE INDEX discord_subscriptions_category ON discord_subscriptions(category_id, channel_id);
CREATE TABLE discord_deliveries (
  article_id TEXT NOT NULL REFERENCES articles(id), channel_id TEXT NOT NULL REFERENCES discord_channels(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','cancelled','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT,
  message_id TEXT, sent_at INTEGER, last_error TEXT,
  PRIMARY KEY(article_id, channel_id)
);
CREATE INDEX discord_deliveries_pending ON discord_deliveries(status,next_attempt,lease_until);
CREATE TABLE discord_interactions (
  id TEXT PRIMARY KEY, token TEXT NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX discord_interactions_age ON discord_interactions(created_at);
CREATE TABLE discord_menus (
  id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
  category_ids TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT
);
CREATE INDEX discord_menus_expiry ON discord_menus(expires_at);
-- Serialize Discord dispatches across Worker invocations and persist global backoff.
CREATE TABLE discord_dispatch (
  id INTEGER PRIMARY KEY CHECK(id=1), lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, retry_at INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
INSERT INTO discord_dispatch(id) VALUES(1);
