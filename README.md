# IFNMG News Bot (English)

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

# Bot de Notícias do IFNMG (Português)

Um bot do Telegram que acompanha seis feeds RSS do IFNMG e envia notícias com base nos temas escolhidos por cada pessoa. Ele usa o JEV para classificar as publicações e é executado no Cloudflare Workers com um banco de dados D1.

As mensagens e os comandos do bot estão em português.

## Use o bot

Abra [@noticiasIf_bot](https://t.me/noticiasIf_bot), envie `/start` e escolha suas categorias.

| Comando | O que faz |
| --- | --- |
| `/categorias` | Escolher categorias para acompanhar |
| `/minhas` | Mostrar suas inscrições |
| `/compartilhar` | Compartilhar o bot |
| `/parar` | Pausar as notificações |
| `/retomar` | Retomar as notificações de novas publicações |
| `/cancelar` | Cancelar a operação atual |

Administradores podem usar `/admin` para gerenciar categorias, `/nova` para criar uma e `/status` para verificar erros de coleta e envio. Cada categoria tem um nome e uma descrição que orienta a classificação. As descrições são exibidas apenas ao administrador. Use `/manter` para preservar um valor existente durante a edição.

Administradores também precisam se inscrever nas categorias para receber notícias.

## Como funciona

Cada feed é verificado a cada dez minutos. A classificação e o envio são executados a cada minuto.

- A primeira verificação registra as publicações existentes sem enviá-las.
- Uma publicação pode corresponder a várias categorias, mas seu envio é controlado uma única vez por assinante.
- Inscrever-se ou retomar as notificações não provoca o envio de publicações antigas.
- Apenas o conteúdo dos feeds RSS é utilizado. O bot não lê PDFs vinculados nem acompanha edições em publicações existentes.
- Alterações nas categorias se aplicam às publicações coletadas posteriormente. Quando não há categorias ativas, as publicações são registradas sem classificação.

Os limites atuais são de 100 assinantes, 20 categorias, 20 itens por resposta de feed e 20 destinatários por execução de envio. O envio pode levar vários minutos. Requisições que falham são repetidas, e uma nova tentativa após um envio parcialmente concluído pode gerar uma duplicata.

## Configuração local

Requer Node.js 22.13 ou posterior.

Para uma nova cópia do repositório:

```sh
npm ci
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
```

Preserve sua configuração local existente ao atualizar uma instalação.

Preencha o arquivo `.dev.vars`:

| Variável | Valor |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token do seu bot do Telegram |
| `TYPESAFE_API_KEY` | Sua chave de API do JEV |
| `TELEGRAM_ADMIN_ID` | Seu ID de usuário do Telegram |
| `TELEGRAM_WEBHOOK_SECRET` | Um segredo aleatório para autenticação do webhook |
| `TASK_SECRET` | Um segredo aleatório separado para tarefas internas |

Gere cada segredo aleatório separadamente:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Em seguida, crie o banco de dados local e inicie o worker:

```sh
npm run db:local
npm run dev
```

Para verificar o código:

```sh
npm run check
npm test
```

Os testes usam um banco de dados SQLite em memória e respostas simuladas de API. Eles não enviam mensagens reais pelo Telegram.

## Implantação

1. Execute `npx wrangler login` para entrar na sua conta da Cloudflare.
2. Execute `npx wrangler d1 create noticias-ifnmg`. Defina `database_id` e adicione seu `account_id` no arquivo local `wrangler.jsonc`.
3. Execute `npm run db:remote` para aplicar as migrações.
4. Execute `npm run deploy`. Defina `vars.APP_URL` em `wrangler.jsonc` com a URL do worker publicado e faça a implantação novamente.
5. Execute `node scripts/publish-secrets.mjs` para enviar os segredos de `.dev.vars`.
6. Execute `npm run setup:telegram` para registrar o webhook, os comandos e a descrição do bot.

`GET /health` verifica se o worker está respondendo. Todas as rotas `POST /internal/*` exigem `Authorization: Bearer TASK_SECRET`. O webhook do Telegram exige `TELEGRAM_WEBHOOK_SECRET`.

A configuração direciona o processamento HTTP para São Paulo porque requisições aos feeds feitas a partir de outras regiões encontraram páginas de verificação do site. Verifique `/status` se a coleta parar. Algumas URLs dos feeds contêm um ano e podem precisar de atualização.

O uso do JEV é pago. Monitore o uso da API e os limites de recursos da Cloudflare; não há garantia de que o uso permanecerá dentro das cotas gratuitas de hospedagem.

## Credenciais e dados armazenados

`.dev.vars`, `wrangler.jsonc`, bancos de dados locais, logs e o estado do Wrangler são ignorados pelo Git. Mantenha credenciais reais fora dos arquivos de exemplo e não force a inclusão de arquivos ignorados.

Antes de publicar alterações, revise `git diff --cached` e execute `npm audit`. Você também pode verificar as alterações preparadas para commit com `gitleaks git --pre-commit --staged --redact`, caso o Gitleaks esteja instalado. Se uma credencial for exposta, revogue-a junto ao provedor. Apagá-la do commit mais recente não a remove do histórico do Git.

O D1 armazena IDs de usuários do Telegram, inscrições, categorias, publicações, resultados de classificação e registros de envio. Ele não armazena números de telefone. Os registros de atualizações do Telegram cujo processamento foi concluído são removidos após sete dias; o histórico de publicações é mantido para evitar envios repetidos.
