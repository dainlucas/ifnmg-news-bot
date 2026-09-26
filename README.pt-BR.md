# Bot de Notícias do IFNMG

[English](README.md) | **Português (Brasil)**

Um bot que acompanha seis feeds RSS do IFNMG e envia notícias para assinantes no Telegram e canais de um servidor no Discord. Ele usa o JEV para classificar as publicações e roda no Cloudflare Workers com um banco D1. O Discord é opcional: instalações existentes do Telegram continuam funcionando sem as credenciais do Discord.

As mensagens e os comandos do bot estão em português.

## Usar o Telegram

Abra [@noticiasIf_bot](https://t.me/noticiasIf_bot), envie `/start` e escolha suas categorias.

| Comando | O que faz |
| --- | --- |
| `/categorias` | Escolher as categorias que deseja acompanhar |
| `/minhas` | Mostrar suas inscrições |
| `/compartilhar` | Compartilhar o bot |
| `/parar` | Pausar as notificações |
| `/retomar` | Retomar as notificações de novas publicações |
| `/cancelar` | Cancelar a operação atual |

Administradores podem usar `/admin` para gerenciar categorias, `/nova` para criar uma categoria e `/status` para consultar erros de coleta e envio. Cada categoria tem um nome e uma descrição que orienta a classificação. As descrições são mostradas somente ao administrador. Use `/manter` para preservar um valor ao editar.

Administradores também precisam se inscrever nas categorias para receber notícias.

## Usar o Discord

Comece pelo canal `#boas-vindas`: ele apresenta as categorias, explica como ajustar as notificações e informa que os canais de notícias são somente de leitura. O guia tem links diretos para os canais de todas as categorias ativas.

Use um único servidor para a comunidade e um canal de texto por categoria de notícias, como `#bolsas`, `#pesquisa` e `#eventos`. Crie os canais no Discord, execute `/categorias` em cada um e selecione a categoria correspondente. O bot não cria os canais de notícias automaticamente. Cada pessoa escolhe o que acompanhar nas configurações do próprio Discord: basta silenciar os canais indesejados e ativar **Todas as mensagens** nos que deseja acompanhar. Não há inscrições individuais em categorias no Discord.

Os membros não precisam executar comandos nem se cadastrar no bot. No computador, clique com o botão direito no canal para ajustar as notificações; no celular, toque e segure o nome do canal. Silencie apenas os canais indesejados, em vez do servidor inteiro, se quiser continuar recebendo alertas dos demais. O bot publica uma vez em cada canal correspondente, e o Discord cuida das notificações de cada membro.

As notícias aparecem em cartões com título, resumo, categorias correspondentes, fonte e link para a publicação original. Configure cada destino dentro do próprio canal:

| Comando | O que faz |
| --- | --- |
| `/categorias` | Escolher uma categoria e tornar o canal somente de leitura para membros; uma seleção vazia desativa os envios |
| `/configuracao` | Mostrar a categoria do canal e a situação dos envios |
| `/pausar` | Pausar os envios, preservando a categoria selecionada |
| `/retomar` | Reaplicar as permissões de leitura e retomar os envios apenas de notícias coletadas a partir daquele momento |

Selecionar uma categoria ou retomar os envios exige **Gerenciar canais** e **Gerenciar cargos** no canal de destino, pois essas operações também alteram suas permissões. Para pausar, basta Gerenciar canais. As permissões são verificadas novamente quando o menu é enviado, independentemente das configurações de visibilidade dos comandos no Discord. Qualquer pessoa que possa usar o comando no canal pode consultar `/configuracao`. As respostas de configuração são privadas, visíveis apenas para quem executou o comando; as notícias são publicadas no canal.

O bot precisa de **Ver canal**, **Enviar mensagens**, **Inserir links**, **Gerenciar canais**, **Gerenciar cargos**, **Criar tópicos públicos**, **Criar tópicos privados** e **Enviar mensagens em tópicos**, considerando também as permissões específicas do canal. O Discord exige que o bot tenha as permissões que vai permitir ou negar. Não é necessário conceder Administrador, habilitar o intent Message Content ou manter uma conexão com o Gateway. São aceitos apenas canais de texto e de anúncios em servidores; não há inscrições individuais, envios por mensagem privada, publicações em fóruns ou tópicos. Os canais de anúncios recebem mensagens comuns, sem publicação automática em outros servidores.

Salvar a configuração ou retomar os envios bloqueia mensagens dos membros, criação de tópicos públicos e privados e mensagens em tópicos existentes. Permissões específicas de cargos ou membros que permitiriam escrever também são restringidas, enquanto uma permissão específica autoriza este bot a publicar. As demais permissões, incluindo a visibilidade de canais privados, são preservadas. Ao criar cada canal, conceda aos membros Ver canal e Ler histórico de mensagens. Se a atualização das permissões no Discord falhar, as inscrições do canal não são alteradas. Limpar a categoria ou pausar os envios não reabre o canal para conversas. Essas restrições se aplicam aos canais de notícias configurados; remova ou restrinja separadamente eventuais canais de conversa ou voz se todo o servidor for destinado apenas a avisos. As mensagens existentes não são apagadas.

Por definição do Discord, donos do servidor e membros com **Administrador** não ficam sujeitos às restrições de canal. Quem pode gerenciar permissões consegue alterá-las novamente, e webhooks ou outras integrações existentes ainda podem publicar. Use canais de notícias dedicados, sem outras integrações de publicação. O bot reaplica as restrições ao salvar uma categoria ou retomar os envios; ele não monitora continuamente mudanças nas permissões. Canais configurados com várias categorias em uma versão anterior mantêm a configuração até serem atualizados: execute `/categorias` em cada um para escolher uma única categoria e aplicar as permissões de leitura. O comando `/retomar` exige essa atualização primeiro.

Por isso, o campo de escrever mensagens pode continuar ativo para o dono ou um administrador. Membros comuns não conseguem publicar, mesmo que o Discord mostre um campo desativado ou um aviso de falta de permissão.

Os menus expiram após 15 minutos e só podem ser enviados uma vez, pela pessoa que os abriu e no canal original. As categorias são compartilhadas com o Telegram e continuam sendo criadas e editadas pelo administrador do projeto no Telegram. Selecionar uma categoria preserva o estado pausado ou bloqueado do canal; use `/retomar` após corrigir as permissões. Configurar ou retomar um canal não envia publicações coletadas anteriormente, inclusive as que ainda aguardam classificação.

## Como funciona

Cada feed é consultado a cada dez minutos. A classificação e os envios são executados a cada minuto.

- A primeira consulta registra as publicações existentes sem enviá-las.
- Uma notícia é classificada pelo JEV uma vez para as duas plataformas. O resultado da classificação, as correspondências e as duas filas de envio são gravados juntos; falhas na API ou no banco podem exigir uma nova tentativa de classificação.
- Uma notícia pode corresponder a várias categorias, mas o envio é registrado uma única vez por assinante do Telegram e por canal do Discord.
- Inscrever-se ou retomar as notificações não envia publicações antigas.
- Apenas o conteúdo dos feeds RSS é usado. O bot não lê PDFs vinculados nem acompanha edições em publicações existentes.
- Alterações nas categorias valem para notícias coletadas depois da mudança. Sem categorias ativas, as publicações são registradas sem classificação.

Os limites atuais são 100 assinantes no Telegram, 20 categorias compartilhadas, 20 itens por resposta de feed, 20 destinatários do Telegram e 8 canais do Discord por execução da respectiva etapa de envio. Cada destino recebe no máximo uma notícia por execução. A distribuição pode levar alguns minutos.

Telegram e Discord têm registros de envio, novas tentativas, limites de requisições e chamadas HTTP agendadas separados. Uma falha no Discord não impede o processamento do Telegram. Falhas transitórias ou de rede usam intervalos progressivamente maiores entre tentativas. Respostas 429 do Discord respeitam `retry_after` e os cabeçalhos de limite de requisições, com pausas separadas por canal e para toda a integração. Um token inválido do bot (401) suspende as requisições ao Discord por uma hora. Erros permanentes no conteúdo enviado são registrados como falha. Um canal inexistente ou inacessível (403/404) é marcado como bloqueado e seus envios pendentes são cancelados; os outros canais continuam funcionando. O comando `/configuracao` informa o bloqueio, e `/retomar` verifica novamente as permissões e passa a considerar apenas notícias coletadas a partir daquele momento.

Chaves únicas no banco impedem envios duplicados por sobreposição de categorias. Bloqueios temporários com prazo de expiração evitam execuções simultâneas de envio. As tentativas do Discord usam um `nonce` estável com `enforce_nonce`. O Discord só elimina duplicações por nonce durante alguns minutos: se uma mensagem for aceita, mas sua confirmação ou gravação no banco se perder e a recuperação ocorrer depois, ainda pode haver duplicação. Não é possível garantir exatamente um envio entre o D1 e uma API externa. O Telegram mantém seu comportamento de novas tentativas.

## Volume de envios e custos

No Telegram, o volume de envios cresce com o número de assinantes. No Discord, cresce com o número de canais configurados que correspondem à notícia, independentemente de quantas pessoas os acompanham. Não há entregas por mensagem privada nem tarefas de envio por membro no Discord.

| Exemplo para uma notícia, antes de novas tentativas | Telegram | Discord |
| --- | --- | --- |
| Uma categoria correspondente, com 100 pessoas interessadas | Até 100 mensagens individuais | 1 mensagem no canal da categoria |
| Três categorias correspondentes, acompanhadas pelas mesmas 100 pessoas | Até 100 mensagens, sem repetir por assinante | 3 mensagens, uma em cada canal |
| Mais leitores em um canal existente do Discord | Mais assinantes no Telegram exigiriam mais envios, dentro do limite configurado | Nenhuma mensagem adicional do bot para esses leitores |

Publicar em canais compartilhados reduz as chamadas às APIs de envio, os registros de entrega e o processamento em comparação com enviar a mesma notícia separadamente para muitas pessoas. O próprio Discord cuida das notificações dos membros; o Worker não as envia individualmente. O custo efetivo de hospedagem depende do uso e das cotas dos provedores. Essa é uma comparação de volume de trabalho, não uma promessa de preço fixo ou hospedagem gratuita.

A classificação pelo JEV é compartilhada: o projeto classifica cada notícia uma vez e usa o mesmo resultado no Telegram e no Discord. Adicionar o Discord não exige uma segunda classificação. Se o Telegram continuar ativo, os envios individuais dele continuam junto com os envios por canal do Discord. Novas tentativas após falhas podem gerar requisições adicionais nas duas plataformas.

## Configuração local

É necessário ter Node.js 22.13 ou posterior.

Para uma nova cópia do repositório:

```sh
npm ci
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
```

Ao atualizar uma instalação existente, preserve sua configuração local.

Preencha `.dev.vars`:

| Variável | Valor |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token do seu bot do Telegram |
| `TYPESAFE_API_KEY` | Chave da API do JEV |
| `TELEGRAM_ADMIN_ID` | Seu ID de usuário do Telegram |
| `TELEGRAM_WEBHOOK_SECRET` | Um segredo aleatório para autenticar o webhook |
| `TASK_SECRET` | Outro segredo aleatório, exclusivo para as tarefas internas |
| `DISCORD_BOT_TOKEN` | Token opcional do bot do Discord; não é o segredo do cliente OAuth |
| `DISCORD_PUBLIC_KEY` | Chave pública opcional da aplicação do Discord, usada para verificar as interações HTTP assinadas |
| `DISCORD_TEST_GUILD_ID` | ID opcional de servidor usado apenas para registrar comandos de teste; deixe vazio para registro global |
| `DISCORD_GUILD_ID` | ID opcional do servidor de destino do script de boas-vindas; obrigatório quando o bot participa de mais de um servidor |

Para usar o Discord, defina também `vars.DISCORD_APPLICATION_ID` em `wrangler.jsonc` com o ID da aplicação **como uma string entre aspas**. Em uma instalação existente, acrescente essa variável sem substituir as configurações da conta e do banco. O script de registro lê esse ID de `wrangler.jsonc` ou da variável de ambiente `DISCORD_APPLICATION_ID`. Mantenha o arquivo de configuração como JSON válido para os scripts.

Gere cada segredo aleatório separadamente:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Depois, crie o banco local e inicie o Worker:

```sh
npm run db:local
npm run dev
```

Para verificar o código:

```sh
npm run check
npm test
```

Os testes usam um banco SQLite em memória, chaves de assinatura temporárias e respostas de API simuladas. Eles não enviam mensagens reais pelo Telegram ou Discord. Cobrem configuração, permissões, seleção de categorias, datas de início dos envios, classificação compartilhada, prevenção de duplicações, novas tentativas, limites de requisições, validação de assinaturas, independência entre plataformas e atualização de um banco existente. O comando `npm run setup:discord -- --dry-run` valida as definições dos comandos localmente, sem carregar credenciais nem acessar o Discord.

Para visualizar o guia de boas-vindas sem publicá-lo nem carregar credenciais:

```sh
npm run setup:discord:welcome -- --dry-run
```

A migração `0003_discord.sql` apenas acrescenta as tabelas do Discord. Ela não reescreve nem remove usuários, inscrições, artigos, correspondências ou histórico de envios do Telegram. Aplique as migrações localmente com `npm run db:local` antes de executar o Worker atualizado. Para atualizar a produção, faça uma cópia de segurança do D1 existente, aplique as migrações pendentes e publique o Worker. Não é necessário importar dados nem enviar notícias antigas para o Discord. Mantenha as migrações `0001` e `0002` sem alterações.

## Publicar

1. Execute `npx wrangler login` para entrar na Cloudflare.
2. Execute `npx wrangler d1 create noticias-ifnmg`. Preencha `database_id` e acrescente seu `account_id` no arquivo local `wrangler.jsonc`.
3. Execute `npm run db:remote` para aplicar as migrações.
4. Execute `npm run deploy`. Defina `vars.APP_URL` em `wrangler.jsonc` com a URL do Worker publicado e publique novamente.
5. Execute `node scripts/publish-secrets.mjs` para enviar os segredos de `.dev.vars` à Cloudflare.
6. Execute `npm run setup:telegram` para registrar o webhook, os comandos e a descrição do bot.

A rota `GET /health` verifica se o Worker está respondendo. Todas as rotas `POST /internal/*` exigem `Authorization: Bearer TASK_SECRET`. O webhook do Telegram exige `TELEGRAM_WEBHOOK_SECRET`.

A rota `POST /internal/deliver` continua sendo a etapa de envios do Telegram. A rota `POST /internal/deliver-discord` processa a fila independente do Discord. O agendador chama ambas a cada minuto quando o Discord está habilitado. A rota `POST /internal/status` inclui contagens de canais, canais bloqueados, envios concluídos, pendentes e com falha no Discord, além do último erro global dessa integração. O comando `/status` existente no Telegram mantém os contadores do Telegram.

A configuração direciona o processamento HTTP para São Paulo porque acessos aos feeds a partir de outras regiões encontraram uma verificação do site. Consulte `/status` se a coleta parar. Algumas URLs dos feeds incluem um ano e podem precisar de atualização.

O uso do JEV é pago. Acompanhe o consumo da API e os limites de recursos da Cloudflare. Não há garantia de permanecer dentro das cotas gratuitas da hospedagem.

## Conectar uma aplicação do Discord

Os passos abaixo alteram a configuração externa e devem ser executados quando você quiser habilitar o Discord. Os testes locais e a simulação do registro não executam essas ações.

1. Crie uma aplicação no [Portal de Desenvolvedores do Discord](https://discord.com/developers/applications). Copie **Application ID** e **Public Key** em General Information. Em **Bot**, crie ou redefina o token conforme necessário e guarde-o somente em `.dev.vars` ou no seu gerenciador de segredos. Não habilite intents privilegiados do Gateway.
2. Em **Installation**, habilite **Guild Install**, a instalação em servidor. Selecione os escopos `bot` e `applications.commands` e conceda Ver canal, Enviar mensagens, Inserir links, Gerenciar canais, Gerenciar cargos, Criar tópicos públicos, Criar tópicos privados e Enviar mensagens em tópicos. O valor inteiro que combina essas permissões é `378225576976`. Use o link de instalação gerado para adicionar o bot ao servidor; a pessoa que instala precisa poder instalar aplicações ou gerenciar esse servidor. Confira as permissões dos canais e do cargo do bot e posicione esse cargo acima dos cargos cujas permissões de canal ele precisará gerenciar. Instalações existentes precisam atualizar as permissões do bot e registrar os comandos novamente.
3. Defina `vars.DISCORD_APPLICATION_ID` no seu `wrangler.jsonc` existente e `DISCORD_PUBLIC_KEY` e `DISCORD_BOT_TOKEN` em `.dev.vars`. Deixe as duas credenciais do Discord vazias para manter apenas o Telegram. Todos os IDs do Discord devem continuar como strings. `DISCORD_TEST_GUILD_ID` é uma configuração local dos scripts e não é enviada como segredo do Worker.
4. Na atualização de produção, aplique as migrações e publique conforme as instruções anteriores. Envie os segredos com `node scripts/publish-secrets.mjs`. O script inclui as duas credenciais do Discord somente quando configuradas e rejeita um par incompleto. Você também pode defini-las individualmente com `npx wrangler secret put DISCORD_BOT_TOKEN` e `npx wrangler secret put DISCORD_PUBLIC_KEY`. Preserve os segredos existentes do Telegram, JEV e tarefas internas. Nunca cole tokens em argumentos da linha de comando nem os inclua em commits.
5. Em General Information, defina **Interactions Endpoint URL** como `https://<endereco-do-worker>/discord/interactions`. O Discord valida essa URL com um PING assinado. O Worker verifica as assinaturas Ed25519 sobre o corpo original da requisição, rejeita assinaturas inválidas ou antigas e responde com PONG. Nas interações comuns, ele confirma imediatamente o recebimento com uma resposta privada adiada e depois edita essa resposta por HTTP enquanto realiza as operações no D1. Não é necessário manter um processo conectado permanentemente. A URL precisa estar acessível publicamente por HTTPS; apenas localhost não basta.
6. Registre os comandos com `npm run setup:discord`. Se `DISCORD_TEST_GUILD_ID` estiver preenchido, o registro será feito nesse servidor; caso contrário, os comandos serão globais. O registro substitui em lote **os comandos desta aplicação no escopo escolhido**. Use uma aplicação dedicada ou revise `assets/discord-commands.json` antes de compartilhar a aplicação com outros comandos. Registros de servidor e globais são separados; remova comandos de teste obsoletos pela API do Discord ao migrar para comandos globais, evitando duplicações. O script informa apenas o resultado, sem tokens ou corpos de erro do provedor.
7. Crie um canal de texto ou de anúncios por categoria. Em cada canal, execute `/categorias`, escolha uma única categoria e consulte `/configuracao`. Ao salvar, o canal passa a ser somente de leitura para membros comuns. Só serão enviadas notícias coletadas depois da seleção. Use `/pausar` e `/retomar` para controlar os próximos envios.
8. Execute `npm run setup:discord:welcome` para publicar ou atualizar o canal `#boas-vindas`, somente de leitura e no topo do servidor. O script usa `assets/discord-welcome.json` e vincula as categorias ativas aos canais cujos nomes derivam dos nomes das categorias: minúsculas, sem acentos, com espaços e pontuação substituídos por hífens. Ele interrompe a execução se uma categoria não tiver exatamente um canal correspondente. Se o bot participar de vários servidores, defina `DISCORD_GUILD_ID` com o servidor de destino. Executar novamente atualiza a mensagem de boas-vindas existente do bot. Para visualizar o modelo sem credenciais nem acesso à rede, use `npm run setup:discord:welcome -- --dry-run`.

O script de boas-vindas também precisa de **Ler histórico de mensagens**, pois consulta o canal para encontrar e atualizar o guia. Garanta que o bot tenha essa permissão no servidor antes de executar o script. O valor inteiro de instalação incluindo Ler histórico de mensagens é `378225642512`. `DISCORD_GUILD_ID` e `DISCORD_TEST_GUILD_ID` são configurações locais dos scripts, não segredos do Worker. O canal de boas-vindas não recebe notícias: ele contém o guia e os links para os canais das categorias. Depois de adicionar ou renomear uma categoria e seu canal, execute o script novamente para atualizar os links. Ao editar o texto do guia, preserve seu título, pois o script o usa para encontrar a mensagem de boas-vindas existente.

Referências oficiais do Discord: [configurações de notificações](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101), [permissões dos canais](https://docs.discord.com/developers/topics/permissions), [edição de canais e permissões específicas](https://docs.discord.com/developers/resources/channel#modify-channel), [interações HTTP e prazo de resposta](https://docs.discord.com/developers/interactions/receiving-and-responding), [comandos de aplicações](https://docs.discord.com/developers/interactions/application-commands), [limites de requisições](https://docs.discord.com/developers/topics/rate-limits) e [criação de mensagens e prevenção de duplicações com nonce](https://docs.discord.com/developers/resources/message#create-message).

## Credenciais e dados armazenados

Os arquivos `.dev.vars` e `wrangler.jsonc`, bancos locais, logs e o estado do Wrangler ficam fora do Git. Não coloque credenciais reais nos arquivos de exemplo nem force a inclusão de arquivos ignorados.

Antes de publicar alterações, revise `git diff --cached` e execute `npm audit`. Se tiver o Gitleaks instalado, você também pode verificar as alterações preparadas para commit com `gitleaks git --pre-commit --staged --redact`. Se uma credencial for exposta, revogue-a no provedor. Apagá-la do commit mais recente não a remove do histórico do Git.

O D1 armazena IDs de usuários do Telegram, inscrições, categorias, publicações, resultados de classificação e registros de envio. As tabelas do Discord armazenam separadamente IDs de servidores e canais, seleções de categorias por canal, situação dos envios e IDs de mensagens, respostas de interações e menus temporários com o ID de quem está configurando. Todos os IDs do Discord, chamados snowflakes, são armazenados como `TEXT`; nenhum é convertido para um número JavaScript. Não há inscrições por usuário no Discord. Os tokens de continuação das interações são usados apenas em memória e não são persistidos nem registrados em logs. O sistema não armazena números de telefone.

Registros de atualizações concluídas do Telegram e respostas de interações do Discord são removidos após sete dias; menus expirados do Discord são removidos na limpeza diária. As notícias e o histórico de envios são mantidos para evitar repetições. Canais excluídos continuam registrados como bloqueados para diagnóstico. Restaurar o acesso e executar `/retomar` reinicia os envios apenas com notícias novas.
