# IFNMG News Bot

**English** | [Português (Brasil)](README.pt-BR.md)

A news bot that follows six IFNMG RSS feeds and delivers news to Telegram subscribers and Discord server channels. It uses JEV to classify posts and runs on Cloudflare Workers with a D1 database. Discord is optional; existing Telegram installations continue to work without Discord credentials.

The bot's messages and commands are in Portuguese.

## Use Telegram

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

## Use Discord

Start in [Discord](https://discord.gg/87FjVS2KB) `#boas-vindas` for a guide to the categories, channel notifications, and read-only news channels. The welcome guide links directly to all active category channels.

Use one Discord server for the community and one text channel per news category, for example `#bolsas`, `#pesquisa`, and `#eventos`. Create these channels in Discord, then run `/categorias` in each and select its category. The bot does not create channels automatically. Members choose what to follow with Discord’s own channel notification settings: mute unwanted channels and enable **All Messages** for the channels they want to follow. There are no personal category subscriptions on Discord.

Members do not need to run commands or register with the bot. On desktop, right-click a channel to change its notifications; on mobile, press and hold the channel name. Mute individual unwanted channels rather than the whole server if you still want alerts from the remaining channels. The bot posts once to each matching channel, and Discord handles each member's notifications.

News is published as a card with a title, summary, matched categories, source, and link to the original publication. Configure each destination from that channel:

| Command | What it does |
| --- | --- |
| `/categorias` | Choose one category and make the channel read-only for members; an empty selection disables delivery |
| `/configuracao` | Show the channel’s category and delivery status |
| `/pausar` | Pause delivery, preserving the selected category |
| `/retomar` | Reapply read-only permissions and resume delivery for newly collected news only |

Selecting a category or resuming requires **Manage Channels** and **Manage Roles** (`Gerenciar canal` and `Gerenciar cargos`) in the destination channel, because these operations also change its permissions. Pausing only requires Manage Channels. These permissions are checked again when a menu is submitted, regardless of Discord’s command visibility settings. Anyone who can use the command in the channel may consult `/configuracao`. Configuration replies are ephemeral (visible only to the person using the command); news is posted to the channel.

The bot needs **View Channel**, **Send Messages**, **Embed Links**, **Manage Channels**, **Manage Roles**, **Create Public Threads**, **Create Private Threads**, and **Send Messages in Threads**, including channel overrides. Discord requires the bot to hold permissions it will allow or deny. It does not need Administrator, Message Content intent, or a Gateway connection. Only server text and announcement channels are supported; there are no individual subscriptions, direct-message deliveries, forum posts, or threads. Announcement channels receive regular messages, without automatic crossposting.

Saving or resuming denies member messages, public/private thread creation, and messages in existing threads. Existing role/member posting overrides are also restricted, with a member override allowing this bot to publish. Unrelated permissions, including private-channel visibility, are preserved; give members View Channel and Read Message History when creating each channel. No subscription changes are saved if the Discord permission update fails. Clearing a category or pausing does not reopen the channel for conversation. These restrictions apply to configured news channels; remove or restrict any separate chat/voice channels yourself if the entire server should be for announcements only. Existing messages are not deleted.

Server owners and members with **Administrator** bypass channel overwrites by Discord design. People allowed to manage permissions can change them again, and existing webhooks/integrations can still publish; use dedicated news channels without other publishing integrations. The bot reapplies restrictions when saving a category or resuming, rather than continuously monitoring permission changes. Channels configured with multiple categories by an earlier version keep their saved configuration until updated: run `/categorias` in each to choose one category and apply read-only permissions. `/retomar` requires this update first.

The message composer can therefore remain enabled for the owner or an administrator. Ordinary members cannot post, even if Discord displays a disabled composer or a notice about missing permissions.

Menus expire after 15 minutes and can be submitted once by the member who opened them, in the original channel. Categories are shared with Telegram and are still created/edited by the project's Telegram administrator. Selecting categories preserves a paused/blocked state; use `/retomar` after correcting missing permissions. Configuring or resuming a channel never backfills previously collected news, including news still awaiting classification.

## How it works

Each feed is checked every ten minutes. Classification and delivery run every minute.

- The first check records existing posts without sending them.
- A post is classified by JEV once for both platforms. Successful classification, matches, and both delivery queues are committed together; API/database failures may require retrying classification.
- A post can match several categories, but delivery is tracked once per Telegram subscriber and once per Discord channel.
- Subscribing or resuming notifications does not send older posts.
- Only RSS content is used. The bot does not read linked PDFs or track edits to existing posts.
- Category changes apply to posts collected afterward. With no active categories, posts are recorded without classification.

The current limits are 100 Telegram subscribers, 20 shared categories, 20 items per feed response, 20 Telegram recipients and 8 Discord channels per respective delivery run. At most one news message is sent to each destination per run. Delivery may take several minutes.

Telegram and Discord have separate delivery records, retries, rate limits, and scheduled HTTP invocations. A Discord failure does not prevent Telegram processing. Transient/network failures use exponential backoff. Discord 429 responses honor `retry_after`/rate-limit headers, with separate channel and global cooldowns; an invalid bot token (401) suspends Discord requests for one hour. Permanent payload errors are recorded as failed. A missing/inaccessible channel (403/404) is marked blocked and its queued deliveries are cancelled; other channels continue. `/configuracao` explains blocked channels, and `/retomar` revalidates permissions and establishes a new cutoff.

Unique database keys prevent multiple deliveries caused by overlapping categories. Expiring leases prevent concurrent dispatches, and Discord retries use a stable `nonce` with `enforce_nonce`. Discord only deduplicates nonces for the past few minutes: if a message is accepted but its acknowledgement/database write is lost and recovery occurs later, a duplicate is still possible. Exactly-once delivery across D1 and an external API cannot be guaranteed; Telegram retains its existing retry behavior.

## Delivery workload and costs

Telegram delivery grows with the number of subscribed users. Discord delivery grows with the number of matching configured channels, independently of how many members read them. There are no Discord direct-message deliveries or per-member delivery jobs.

| Example for one news post, before retries | Telegram | Discord |
| --- | --- | --- |
| One matching category, 100 interested people | Up to 100 individual messages | 1 message in the category channel |
| Three matching categories, followed by the same 100 people | Up to 100 messages, deduplicated per subscriber | 3 messages, one in each category channel |
| More readers in an existing Discord channel | More Telegram subscribers would require more deliveries, within the configured limit | No additional bot messages for those readers |

Publishing to shared channels reduces outbound API calls, delivery records, and processing compared with sending the same news separately to many people. Discord handles member notifications; the Worker does not send them individually. Actual hosting costs depend on usage and provider quotas; this is a workload comparison, not a promise of a fixed price or free hosting.

JEV classification is shared: the project classifies each news post once and uses the same result for Telegram and Discord. Adding Discord does not require a second classification. If Telegram remains enabled, its individual deliveries continue alongside Discord's channel deliveries. Retries after failures can add requests on either platform.

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
| `DISCORD_BOT_TOKEN` | Optional Discord bot token (not the OAuth client secret) |
| `DISCORD_PUBLIC_KEY` | Optional Discord application public key, used to verify signed HTTP interactions |
| `DISCORD_TEST_GUILD_ID` | Optional server ID used only by the command-registration script; leave empty for global commands |
| `DISCORD_GUILD_ID` | Optional target server ID for the welcome script; required when the bot belongs to more than one server |

For Discord, also set `vars.DISCORD_APPLICATION_ID` in `wrangler.jsonc` to the application's ID **as a quoted string**. On an existing installation, add this variable without replacing the current database/account settings. The setup script reads this ID from `wrangler.jsonc` or the `DISCORD_APPLICATION_ID` environment variable. Keep the config valid JSON for the setup scripts.

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

Tests use an in-memory SQLite database, temporary signing keys, and simulated API responses. They do not send real Telegram or Discord messages. They cover configuration, permissions, category selection, cutoffs, shared classification, deduplication, retries, rate limits, signature validation, platform isolation, and upgrading an existing database. `npm run setup:discord -- --dry-run` validates the command definitions locally without loading credentials or calling Discord.

To preview the welcome guide without publishing it or loading credentials:

```sh
npm run setup:discord:welcome -- --dry-run
```

Migration `0003_discord.sql` adds Discord tables only. It does not rewrite/delete Telegram users, subscriptions, articles, matches, or delivery history. Apply the migrations locally with `npm run db:local` before running the updated worker. For a future production rollout, back up the existing D1 database, apply outstanding migrations, then publish the worker; no data import or historical Discord backfill is needed. Keep migrations `0001` and `0002` unchanged.

## Deploy

1. Run `npx wrangler login` to sign in to Cloudflare.
2. Run `npx wrangler d1 create noticias-ifnmg`. Set `database_id` and add your `account_id` in the local `wrangler.jsonc`.
3. Run `npm run db:remote` to apply migrations.
4. Run `npm run deploy`. Set `vars.APP_URL` in `wrangler.jsonc` to the published worker URL, then deploy again.
5. Run `node scripts/publish-secrets.mjs` to upload the secrets from `.dev.vars`.
6. Run `npm run setup:telegram` to register the webhook, commands, and bot description.

`GET /health` checks whether the worker is responding. All `POST /internal/*` routes require `Authorization: Bearer TASK_SECRET`. The Telegram webhook requires `TELEGRAM_WEBHOOK_SECRET`.

`POST /internal/deliver` remains the Telegram delivery job. `POST /internal/deliver-discord` processes the independent Discord queue. The scheduler calls both every minute when Discord is enabled. `POST /internal/status` includes Discord channel/blocked/pending/sent/failed counts and the most recent global Discord error; the existing Telegram `/status` keeps its Telegram counters.

The configuration places HTTP processing in São Paulo because feed requests from other regions encountered site verification pages. Check `/status` if collection stops. Some feed URLs contain a year and may need updating.

JEV usage is paid. Monitor API usage and Cloudflare resource limits; staying within the free hosting quotas is not guaranteed.

## Connect a Discord application (external setup)

The following steps change external configuration and should be performed when you are ready to enable Discord. Local tests and the registration dry run do not perform these steps.

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications). Copy **Application ID** and **Public Key** from General Information. Under **Bot**, create/reset the bot token as needed and save it only in `.dev.vars` or your secret manager. Do not enable privileged Gateway intents.
2. Under **Installation**, enable **Guild Install** (server installation). Select the `bot` and `applications.commands` scopes, and grant View Channel, Send Messages, Embed Links, Manage Channels, Manage Roles, Create Public Threads, Create Private Threads, and Send Messages in Threads. Their combined permissions integer is `378225576976`. Use the generated installation link to add the bot to your server; the installing member must be allowed to install applications/manage that server. Check channel overrides as well as the bot’s server role, and place that role above the roles whose channel permissions it must manage. Existing installations must update the bot’s permissions and re-register the commands.
3. Set `vars.DISCORD_APPLICATION_ID` in your existing `wrangler.jsonc` and `DISCORD_PUBLIC_KEY` / `DISCORD_BOT_TOKEN` in `.dev.vars`. Leave both Discord values empty to keep a Telegram-only setup. All Discord IDs must remain strings. `DISCORD_TEST_GUILD_ID` is local setup metadata and is not uploaded as a Worker secret.
4. During your production rollout, apply migrations and deploy as described above, and upload secrets with `node scripts/publish-secrets.mjs`. The script includes the two Discord values only when configured and rejects a partially filled pair. You may instead set them individually with `npx wrangler secret put DISCORD_BOT_TOKEN` and `npx wrangler secret put DISCORD_PUBLIC_KEY`. Keep existing Telegram/JEV/task secrets. Never paste tokens into command-line arguments or commit them.
5. In General Information, set **Interactions Endpoint URL** to `https://<your-worker-host>/discord/interactions`. Discord validates this URL with a signed PING. The Worker verifies Ed25519 signatures over the raw request body, rejects invalid/stale signatures, and returns PONG. Normal interactions immediately receive an ephemeral deferred acknowledgement, then the Worker edits that response over HTTP while doing the D1 work. No permanently connected process is required. The endpoint must be publicly reachable over HTTPS; localhost alone is not sufficient.
6. Register commands with `npm run setup:discord`. With `DISCORD_TEST_GUILD_ID` set, registration targets that server; otherwise it registers global commands. Registration uses bulk replacement **for this application's commands in the selected scope**, so use a dedicated application or review `assets/discord-commands.json` before sharing the application with other commands. Guild and global registrations are separate; remove obsolete test-guild commands through the Discord API when switching to global commands to avoid duplicates. The script reports only status, never tokens or provider error bodies.
7. Create one server text/announcement channel per category. In each channel, run `/categorias`, choose exactly one category, then `/configuracao`. Saving makes that channel read-only for ordinary members. Only news collected after the selection will be delivered. Use `/pausar` and `/retomar` to control future deliveries.
8. Run `npm run setup:discord:welcome` to publish or update the read-only `#boas-vindas` channel at the top of the server. It uses `assets/discord-welcome.json` and links active categories to channels named from their category names (lowercase, accents removed, punctuation/spaces replaced with hyphens). The script stops if a category has no unique matching channel. If the bot belongs to multiple servers, set `DISCORD_GUILD_ID` to the target server. Rerunning updates the bot's existing welcome message. Preview the template without credentials or network access with `npm run setup:discord:welcome -- --dry-run`.

The welcome script also needs **Read Message History**, since it reads the channel to find and update its guide. Ensure the bot has this permission at server level before running the script. The installation permissions integer including Read Message History is `378225642512`. `DISCORD_GUILD_ID` and `DISCORD_TEST_GUILD_ID` are local script settings, not Worker secrets. The welcome channel is not subscribed to news; it contains the guide and links to the category channels. After adding or renaming a category and its channel, rerun the welcome script to refresh those links. Keep the guide title unchanged when editing its text, because the script uses the title to find the existing welcome message.

Discord's official references: [channel notification settings](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101), [channel permissions](https://docs.discord.com/developers/topics/permissions), [editing channels and overwrites](https://docs.discord.com/developers/resources/channel#modify-channel), [HTTP interactions and acknowledgement deadlines](https://docs.discord.com/developers/interactions/receiving-and-responding), [application commands](https://docs.discord.com/developers/interactions/application-commands), [rate limits](https://docs.discord.com/developers/topics/rate-limits), and [message creation and nonce deduplication](https://docs.discord.com/developers/resources/message#create-message).

## Credentials and stored data

`.dev.vars`, `wrangler.jsonc`, local databases, logs, and Wrangler state are excluded from Git. Keep real credentials out of the example files and do not force-add ignored files.

Before publishing changes, review `git diff --cached` and run `npm audit`. You can also scan staged changes with `gitleaks git --pre-commit --staged --redact` if Gitleaks is installed. If a credential is exposed, revoke it with the provider. Deleting it from the latest commit does not remove it from Git history.

D1 stores Telegram user IDs, subscriptions, categories, posts, classification results, and delivery records. Discord tables separately store server/channel IDs, channel category selections, delivery state/message IDs, interaction responses, and temporary menus with the configuring member's ID. Every Discord snowflake is stored as `TEXT`; no IDs are converted to JavaScript numbers. There are no Discord per-user subscriptions. Interaction continuation tokens are used only in memory and are not persisted or logged. It does not store phone numbers.

Completed Telegram update records and Discord interaction responses are removed after seven days; expired Discord menus are removed by daily cleanup. News and delivery history are retained to prevent repeat deliveries. Deleted channels remain as blocked records for diagnosis; restoring access and running `/retomar` starts with new news only.
