# Notícias IFNMG

Bot do Telegram que coleta seis RSS do IFNMG, classifica novas publicações com JEV e envia notícias no privado de quem acompanha as categorias correspondentes.

## Uso

Abra [@noticiasIf_bot](https://t.me/noticiasIf_bot) e envie `/start`.

| Comando | Função |
| --- | --- |
| `/categorias` | Escolher categorias pelos botões |
| `/compartilhar` | Receber o link do bot e abrir o compartilhamento do Telegram; também disponível no botão Compartilhar do menu |
| `/minhas` | Ver inscrições |
| `/parar` | Pausar os avisos |
| `/retomar` | Retomar, recebendo novas notícias |
| `/cancelar` | Sair de um cadastro em andamento |
| `/admin` | Administrar categorias (somente administrador) |
| `/nova` | Cadastrar nome e descrição detalhada |
| `/status` | Consultar fontes, pendências e falhas (administrador) |

No cadastro, envie o nome e depois uma descrição com critérios de inclusão, exclusão e exemplos. A descrição pode ter até 3.000 caracteres e serve apenas para orientar o JEV: fica visível somente na administração, nunca nos menus ou nas confirmações de inscrição dos usuários. O limite inicial é de 20 categorias e 100 pessoas. Use `/admin` para editar ou desativar categorias; `/manter` preserva o valor atual durante uma edição. Administradores também precisam se inscrever nas categorias para receber notícias.

## Comportamento

- Na primeira coleta bem-sucedida de cada fonte, os itens existentes são registrados sem envio. Reiniciar ou publicar uma nova versão não reinicializa o histórico.
- Cada fonte é consultada a cada dez minutos, com horários distribuídos. Classificação e entrega executam a cada minuto, em requisições separadas.
- Uma notícia pode pertencer a várias categorias; uma pessoa recebe uma única cópia.
- Novas inscrições não recebem notícias capturadas anteriormente. Pausar e retomar não gera recuperação do período pausado.
- Sem categorias, os itens continuam sendo registrados sem chamadas ao JEV. Ao criar categorias, somente os próximos itens serão classificados.
- O conteúdo vem exclusivamente dos RSS. Itens já vistos não são reenviados quando editados. Não há acompanhamento de PDFs ou páginas de editais.
- A classificação guarda a versão dos critérios vigente na captura. Alterações posteriores valem para novas notícias.
- A entrega processa até 20 pessoas por minuto; para 100 destinatários, uma notícia pode levar cerca de cinco minutos adicionais para completar a distribuição, além da coleta e classificação. Picos, retentativas e limites podem aumentar esse prazo.
- Uma resposta independente do tipo `noul` avalia cada categoria no JEV. O limiar inicial é `0.65` (`MATCH_THRESHOLD`); ajuste-o após avaliar notícias reais. Probabilidade não é garantia de acerto.

## Desenvolvimento

Requer Node.js 22.13 ou superior (usado Node 26 neste ambiente).

```sh
npm ci
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
npm run db:local
npm run check
npm test
npm run dev
```

Preencha as credenciais em `.dev.vars` localmente. Gere os dois segredos aleatórios com `crypto.randomBytes` ou equivalente. `.dev.vars` e `wrangler.jsonc` não devem ser versionados; os arquivos `example` são os modelos públicos. Ao atualizar uma instalação existente, preserve seus arquivos locais em vez de sobrescrevê-los com os comandos `cp`. Os testes usam credenciais falsas e não enviam mensagens reais.

## Segurança ao versionar

O `.gitignore` exclui credenciais locais, configuração da implantação, estado do Wrangler, bancos locais, logs e arquivos de chaves. Mantenha os modelos públicos sem valores reais. Não use `git add -f` nesses arquivos: o ignore não impede uma inclusão forçada.

Antes de novos commits, revise `git diff --cached` e execute `npm audit`. Com [Gitleaks](https://github.com/gitleaks/gitleaks) instalado, use `gitleaks git --pre-commit --staged --redact` para verificar o conteúdo preparado e `gitleaks git --redact` para verificar o histórico. A detecção automatizada não garante ausência de todas as falhas. Se uma credencial for publicada, revogue-a no provedor; apagar o arquivo do último commit não remove a credencial do histórico.

## Implantação

1. Copie `wrangler.example.jsonc` para `wrangler.jsonc` caso ainda não exista. Execute `npx wrangler login` e autentique-se na conta Cloudflare.
2. Crie um D1 com `npx wrangler d1 create noticias-ifnmg` e configure seu ID e o ID da conta em `wrangler.jsonc`.
3. Execute `npm run db:remote`.
4. Execute `npm run deploy` e preencha `vars.APP_URL` com a URL publicada. Publique novamente para aplicar a URL usada pelo agendamento.
5. Execute `node scripts/publish-secrets.mjs` para enviar os secrets sem imprimi-los.
6. Execute `npm run setup:telegram` para configurar o webhook, os comandos e a descrição do bot. O webhook preserva updates pendentes.

`GET /health` informa se o Worker responde. As rotas `POST /internal/collect?source=1`, `/internal/classify`, `/internal/deliver` e `/internal/status` exigem `Authorization: Bearer TASK_SECRET`; não são rotas públicas de administração.

O agendamento usa chamadas HTTP ao próprio Worker, permitidas por `global_fetch_strictly_public`, para separar os orçamentos de CPU de cada etapa. O processamento HTTP tem placement na região `aws:sa-east-1` (São Paulo); isso foi necessário porque chamadas originadas de outras regiões do cron receberam uma página de verificação humana do site, enquanto as coletas na região configurada foram concluídas. O comportamento do site pode mudar; verifique `/status` se houver atraso nas notícias.

O coletor compara os GUIDs dos itens para evitar analisar e limpar novamente o conteúdo de notícias já vistas. Alterações no texto de um GUID existente continuam sendo ignoradas, conforme o escopo. A rota protegida `/internal/dispatch?source=1` permite verificar a mesma chamada interna usada pela coleta automática. O processamento é limitado a 20 itens por resposta RSS; se uma fonte aumentar seu tamanho, `/status` indicará o erro e o lote precisará ser ajustado.

## Dados, custos e limites

D1 armazena fontes, categorias, usuários (IDs, sem telefone), inscrições, notícias, decisões e entregas. Registros de updates do Telegram concluídos são removidos após sete dias. O histórico de deduplicação das notícias é preservado.

As tabelas e os índices são criados por migrations. Os testes validam as operações SQL em SQLite e as integrações com respostas simuladas; a publicação também deve ser verificada no runtime real do Workers/D1.

Workers e D1 são usados dentro das cotas gratuitas; JEV é pago por uso, conforme aceito no projeto. Disparos pagos do Telegram não são habilitados. Segredos não aparecem nos logs da aplicação.

Falhas transitórias são retentadas. Bloqueios do bot suspendem entregas ao usuário; erros permanentes de envio são registrados e ficam visíveis em `/status`. Uma falha entre a aceitação de uma mensagem pelo Telegram e a persistência no D1 pode causar duplicação na retentativa; não há garantia de entrega exatamente uma vez.

Os seis feeds são os fornecidos pelo administrador. Algumas URLs têm ano no caminho: sua continuidade deve ser revista quando o site reorganizar as seções.

## Validação desta implantação

Em 24/09/2026: 18 testes automatizados passaram, a checagem TypeScript passou, os seis RSS foram lidos no runtime local e em produção, e uma chamada real ao JEV confirmou classificação simultânea em duas categorias. O webhook processou o `/start` real do administrador, sem updates pendentes ou erro no Telegram. A coleta automática foi observada funcionando após configurar a região.

As 78 publicações iniciais foram registradas sem envio. Algumas coletas e interações medidas ultrapassaram os 10 ms nominais de CPU do plano Free, embora tenham concluído sem erro de limite; a Cloudflare permite flexibilidade eventual. A permanência no plano gratuito exige acompanhar os resultados e ajustar o processamento se surgirem erros de recursos. Não foi contratado plano pago de hospedagem.
