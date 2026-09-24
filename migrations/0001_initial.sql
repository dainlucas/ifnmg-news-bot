CREATE TABLE sources (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
  initialized_at INTEGER, last_poll INTEGER, last_success INTEGER,
  lease_until INTEGER NOT NULL DEFAULT 0, etag TEXT, modified TEXT, last_error TEXT
);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  description TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE users (
  id INTEGER PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1,
  blocked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  wizard TEXT
);
CREATE TABLE subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, category_id)
);
CREATE INDEX subscriptions_category ON subscriptions(category_id, user_id);
CREATE TABLE articles (
  id TEXT PRIMARY KEY, guid TEXT NOT NULL, url TEXT NOT NULL,
  title TEXT NOT NULL, summary TEXT NOT NULL, source_name TEXT NOT NULL,
  published TEXT, captured_at INTEGER NOT NULL, categories TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('seen','pending','processing','classified')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT, last_error TEXT,
  model TEXT, input_tokens INTEGER
);
CREATE INDEX articles_pending ON articles(status,next_attempt,lease_until,captured_at);
CREATE TABLE source_items (
  source_id INTEGER NOT NULL REFERENCES sources(id), guid TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id), PRIMARY KEY(source_id,guid)
);
CREATE TABLE matches (
  article_id TEXT NOT NULL REFERENCES articles(id), category_id INTEGER NOT NULL REFERENCES categories(id),
  version INTEGER NOT NULL, probability REAL NOT NULL, selected INTEGER NOT NULL,
  PRIMARY KEY(article_id,category_id)
);
CREATE TABLE deliveries (
  article_id TEXT NOT NULL REFERENCES articles(id), user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','cancelled','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT,
  message_id INTEGER, sent_at INTEGER, last_error TEXT,
  PRIMARY KEY(article_id,user_id)
);
CREATE INDEX deliveries_pending ON deliveries(status,next_attempt,lease_until);
CREATE TABLE bot_updates (
  id INTEGER PRIMARY KEY, status TEXT NOT NULL, lease_until INTEGER NOT NULL,
  response TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX bot_updates_age ON bot_updates(created_at);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES ('telegram_retry_at','0');

INSERT INTO sources(id,name,url) VALUES
(1,'Editais PROEN / Ensino','https://www.ifnmg.edu.br/editais-proen/26-portal/ensino?format=feed&type=rss'),
(2,'Processos seletivos CEAD','https://www.ifnmg.edu.br/processos-seletivos-cead/editais-2026/501-portal/ead/ead/processos-seletivos-cead?format=feed&type=rss'),
(3,'Comunicação','https://www.ifnmg.edu.br/comunicacao/185-portal/comunicacao?format=feed&type=rss'),
(4,'Mais Notícias Portal','https://ifnmg.edu.br/mais-noticias-portal/735-portal-noticias-2026?format=feed&type=rss'),
(5,'Editais Reitoria','https://www.ifnmg.edu.br/editais-reitoria/2-portal/reitoria?format=feed&type=rss'),
(6,'Participação Social / Institucional','https://www.ifnmg.edu.br/participacao-social/17-portal/institucional?format=feed&type=rss');
