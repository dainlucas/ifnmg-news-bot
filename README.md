# IFNMG News Bot

A Telegram bot that follows six IFNMG RSS feeds and sends news based on the topics each person chooses. It uses JEV to classify posts and runs on Cloudflare Workers with a D1 database.

The bot's messages and commands are in Portuguese.

## Use the bot

Open [@noticiasIf_bot](https://t.me/noticiasIf_bot), send `/start`, and choose your categories.

| Command | What it does |
| --- | --- |
| `/categorias` | Choose categories to follow |
| `/minhas` | Show your subscriptions |
| `/compartilhar` | Share the bot |
| `/parar` | Pause notifications |
| `/retomar` | Resume notifications for new posts |
| `/cancelar` | Cancel the current operation |

Administrators can use `/admin` to manage categories, `/nova` to create one, and `/status` to check collection and delivery errors. Each category has a name and a description that guides classification. Descriptions are only shown to the administrator. Use `/manter` to keep an existing value when editing.

Administrators must also subscribe to categories to receive news.

## How it works

Each feed is checked every ten minutes. Classification and delivery run every minute.

- The first check records existing posts without sending them.
- A post can match several categories, but delivery is tracked once per subscriber.
- Subscribing or resuming notifications does not send older posts.
- Only RSS content is used. The bot does not read linked PDFs or track edits to existing posts.
- Category changes apply to posts collected afterward. With no active categories, posts are recorded without classification.

The current limits are 100 subscribers, 20 categories, 20 items per feed response, and 20 recipients per delivery run. Delivery may take several minutes. Failed requests are retried, and a retry after a partially completed delivery can send a duplicate.

## Local setup

Requires Node.js 22.13 or later.

For a new checkout:

```sh
npm ci
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
```

Keep your existing local configuration when updating an installation.

Fill in `.dev.vars`:

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token |
| `TYPESAFE_API_KEY` | Your JEV API key |
| `TELEGRAM_ADMIN_ID` | Your Telegram user ID |
| `TELEGRAM_WEBHOOK_SECRET` | A random secret for webhook authentication |
| `TASK_SECRET` | A separate random secret for internal tasks |

Generate each random secret separately:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Then create the local database and start the worker:

```sh
npm run db:local
npm run dev
```

To check the code:

```sh
npm run check
npm test
```

Tests use an in-memory SQLite database and simulated API responses. They do not send real Telegram messages.

## Deploy

1. Run `npx wrangler login` to sign in to Cloudflare.
2. Run `npx wrangler d1 create noticias-ifnmg`. Set `database_id` and add your `account_id` in the local `wrangler.jsonc`.
3. Run `npm run db:remote` to apply migrations.
4. Run `npm run deploy`. Set `vars.APP_URL` in `wrangler.jsonc` to the published worker URL, then deploy again.
5. Run `node scripts/publish-secrets.mjs` to upload the secrets from `.dev.vars`.
6. Run `npm run setup:telegram` to register the webhook, commands, and bot description.

`GET /health` checks whether the worker is responding. All `POST /internal/*` routes require `Authorization: Bearer TASK_SECRET`. The Telegram webhook requires `TELEGRAM_WEBHOOK_SECRET`.

The configuration places HTTP processing in São Paulo because feed requests from other regions encountered site verification pages. Check `/status` if collection stops. Some feed URLs contain a year and may need updating.

JEV usage is paid. Monitor API usage and Cloudflare resource limits; staying within the free hosting quotas is not guaranteed.

## Credentials and stored data

`.dev.vars`, `wrangler.jsonc`, local databases, logs, and Wrangler state are excluded from Git. Keep real credentials out of the example files and do not force-add ignored files.

Before publishing changes, review `git diff --cached` and run `npm audit`. You can also scan staged changes with `gitleaks git --pre-commit --staged --redact` if Gitleaks is installed. If a credential is exposed, revoke it with the provider. Deleting it from the latest commit does not remove it from Git history.

D1 stores Telegram user IDs, subscriptions, categories, posts, classification results, and delivery records. It does not store phone numbers. Completed Telegram update records are removed after seven days; post history is retained to prevent repeat deliveries.
