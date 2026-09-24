# Go-live do piloto PlayArena

Revisao executada em 2026-09-17. Versoes auditadas: web `0.1.0`, API `0.1.0`, banco Supabase com 13 migrations versionadas apos esta revisao.

## Resumo executivo

**Status: GO WITH CONDITIONS.** A arquitetura e os fluxos criticos possuem controles adequados para um piloto pequeno, mas o ambiente publicado ainda nao deve ser declarado pronto ate concluir os itens obrigatorios abaixo. Testes automatizados, sozinhos, nao encerram esta decisao.

Evidencia positiva obtida:

- Health de producao respondeu `200` com somente `status` e `service`.
- CORS de producao aceitou apex, `www` e preview Vercel em sports, analytics, booking e owner.
- Origem desconhecida recebeu `400` sem `Access-Control-Allow-Origin`.
- Rotas privadas sem token responderam `401` e `Cache-Control: no-store`.
- `www.useplayarena.com.br` respondeu `200` com CSP, HSTS, nosniff, frame deny, referrer policy, permissions policy e COOP.
- DNS publico respondeu com o apex em Vercel e `www` como CNAME Vercel; o apex HTTPS atualmente redireciona `308` para `www`.
- O banco configurado confirmou RLS nas 14 tabelas auditadas, constraint anti-overlap e policies do bucket por ownership.
- Testes cobrem preco server-side, ownership, agenda sem PII, cancelamento inclusivo em 90 minutos, notificacao unica e concorrencia PostgreSQL.

Limitacoes desta revisao:

- Nao foram executadas mutacoes contra producao nem enviados e-mails reais.
- A tabela de historico de migrations nao estava disponivel pela conexao auditada; o estado do schema foi validado por catalogo.
- O teste de concorrencia real permanece condicionado a um banco isolado.
- Fluxos autenticados e responsividade precisam de smoke manual com contas de teste e dispositivos reais.
- O resolvedor corporativo Akamai ETP interceptou o apex. A checagem foi repetida por DNS-over-HTTPS e `--resolve`, mas reputacao e acesso por redes de usuarios ainda devem ser testados externamente.

## A. Obrigatorio antes do piloto

- [ ] Publicar esta revisao da API; confirmar que `/docs`, `/redoc` e `/openapi.json` retornam `404`. Na verificacao anterior ao deploy, os tres retornaram `200`.
- [ ] Publicar a protecao TLS; confirmar nos logs/diagnostico controlado que a conexao PostgreSQL usa SSL. A URL configurada nao tinha `sslmode` e uma conexao direta negociou sem TLS; o codigo agora acrescenta `sslmode=require` para hosts Supabase.
- [ ] Aplicar `202609170001_allow_arena_schedule_analytics.sql` e confirmar ingestao de `arena_schedule_viewed` com `202`.
- [ ] Confirmar no Supabase que todas as migrations listadas neste documento estao aplicadas.
- [ ] Definir `https://useplayarena.com.br` como dominio principal no Vercel e redirecionar `www` para o apex. Hoje ocorre o inverso: apex HTTPS retorna `308` para `www`, enquanto o build novo declara canonical no apex.
- [ ] Repetir DNS, TLS e redirect do apex em rede externa sem filtro corporativo.
- [ ] Confirmar Supabase Auth Site URL e Redirect URLs para o dominio canonico e localhost controlado.
- [ ] Confirmar no Resend dominio verificado, sender valido, chave somente no Render e entrega dos tres templates.
- [ ] Confirmar backup gerenciado e concluir um restore em projeto isolado conforme `backup-and-recovery.md`.
- [ ] Executar os dez fluxos manuais de regressao com contas guest, player, owner e admin.

## B. Recomendado para o inicio do piloto

- [ ] Configurar monitor de uptime para `https://playarena-iwp9.onrender.com/health` com alerta para duas pessoas.
- [ ] Criar alerta simples de erros no Render/Vercel e revisar logs diariamente durante a primeira semana.
- [ ] Publicar Politica de Privacidade e Termos de Uso revisados, com links na landing/login/perfil.
- [ ] Remover `GOOGLE_PLACES_API_KEY` dos ambientes locais web/mobile e rotacionar se ela ja entrou em build ou foi compartilhada.
- [ ] Executar SecurityHeaders, Mozilla Observatory, SSL Labs e Google Safe Browsing apos corrigir o dominio canonico.
- [ ] Verificar SPF, DKIM e DMARC usados pelo dominio do remetente.
- [ ] Validar instalacao PWA em Android, desktop e iOS, incluindo abertura com sessao existente.
- [ ] Conferir os cinco viewports mobile em dispositivo/browser real.

## C. Pode esperar

- [ ] Atualizar o grafo Expo/mobile em branch dedicada; o `npm audit` encontrou 13 vulnerabilidades moderadas e as correcoes sugeridas sao breaking changes.
- [ ] Adotar Sentry ou equivalente quando o volume justificar.
- [ ] Trocar rate limit por solucao distribuida se houver multiplas instancias ou abuso real.
- [ ] Adotar outbox/fila duravel para e-mail quando perda rara apos commit deixar de ser aceitavel.
- [ ] Automatizar teste de navegador e smoke pos-deploy.

## Variaveis de ambiente

Valores reais e segredos nao devem ser colocados neste documento.

### Vercel

| Variavel | Obrigatoria | Segredo | Status esperado |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Sim | Nao | URL HTTPS da API Render; entra no CSP no build |
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | Nao | URL publica do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Nao | Anon key publica, protegida por RLS |

Nao configurar no Vercel: `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `RESEND_API_KEY` ou `GOOGLE_PLACES_API_KEY`. Um arquivo local web contem Google key sem prefixo publico e sem uso no codigo; ela nao e embutida automaticamente, mas deve ser removida/rotacionada por higiene.

### Render

| Variavel | Obrigatoria | Segredo | Status esperado |
| --- | --- | --- | --- |
| `DATABASE_URL` | Sim | Sim | Supabase Postgres; codigo exige TLS para host Supabase e recomenda `sslmode=require` explicito |
| `SUPABASE_URL` | Sim | Nao | Base de validacao Auth |
| `SUPABASE_ANON_KEY` | Sim | Publicavel, mas server-side | Necessaria para `/auth/v1/user` |
| `SUPABASE_SERVICE_ROLE_KEY` | Nao no fluxo atual | Sim critico | Cliente admin existe, mas nao e chamado pelo runtime auditado; manter ausente se nao usado |
| `SUPABASE_JWT_ISSUER` | Nao no fluxo atual | Nao | Campo reservado, sem consumo atual |
| `WEB_ORIGINS` | Sim em producao | Nao | Lista explicita de apex, `www` e preview necessario |
| `WEB_ORIGIN` | Nao | Nao | Legado; usar apenas se `WEB_ORIGINS` estiver ausente |
| `API_DOCS_ENABLED` | Sim | Nao | `false`; o default do codigo agora tambem e seguro |
| `TRUST_PROXY_HEADERS` | Nao | Nao | `false` ate comprovar normalizacao do proxy |
| `ANALYTICS_RATE_LIMIT_PER_MINUTE` | Nao | Nao | Default 120 |
| `AVAILABILITY_RATE_LIMIT_PER_MINUTE` | Nao | Nao | Default 60 |
| `RESERVATION_RATE_LIMIT_PER_MINUTE` | Nao | Nao | Default 10 por usuario |
| `OWNER_MUTATION_RATE_LIMIT_PER_MINUTE` | Nao | Nao | Default 90 por usuario |
| `MAX_REQUEST_BODY_BYTES` | Nao | Nao | Default 65536 |
| `EMAIL_NOTIFICATIONS_ENABLED` | Sim para e-mail | Nao | `true` em producao, `false` local |
| `RESEND_API_KEY` | Sim para e-mail | Sim | Somente Render |
| `EMAIL_FROM` | Sim para e-mail | Nao | Sender pertencente ao dominio verificado |
| `FRONTEND_URL` | Sim para e-mail | Nao | Dominio canonico HTTPS |
| `EMAIL_REQUEST_TIMEOUT_SECONDS` | Nao | Nao | Default 5 segundos |

### Supabase

| Configuracao | Obrigatoria | Segredo | Status esperado |
| --- | --- | --- | --- |
| Site URL | Sim | Nao | Dominio canonico |
| Redirect URLs | Sim | Nao | Canonico, `www` se transitorio e localhost necessario |
| Anon key | Sim | Nao | Somente cliente, com RLS |
| Service role | Apenas backend que usar admin API | Sim critico | Nunca browser/mobile |
| Database password/URL | Sim no Render | Sim critico | TLS, rotacao e acesso minimo |

### Resend

| Configuracao | Obrigatoria | Segredo | Status esperado |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Sim para notificacoes | Sim | Apenas Render |
| `EMAIL_FROM` | Sim | Nao | Sender validado |
| Dominio/SPF/DKIM | Sim | Nao | Verified no painel e DNS |

### Google

| Variavel | Obrigatoria | Segredo | Status esperado |
| --- | --- | --- | --- |
| `GOOGLE_PLACES_API_KEY` | Nao | Sim | Nenhuma integracao Places ativa foi encontrada; nao manter em cliente |

Nao existe proxy Google, URL arbitraria ou request Places no codigo auditado; portanto nao ha superficie SSRF ativa nem cache/timeout Places para validar nesta release.

## Controles por area

| Area | Estado | Evidencia e risco residual |
| --- | --- | --- |
| Auth | Condicionado a smoke | Bearer validado no Supabase; role vem de `profiles`; `returnTo` aceita apenas caminho interno |
| Roles | Implementado | Redirect: player `/buscar`, owner `/dashboard` ou `/onboarding`, admin `/admin/analytics`; backend valida cada role |
| RLS | Confirmado no banco configurado | RLS ativo em profiles, arenas, ownership, courts, configuracoes, reservations, analytics e tabelas auxiliares |
| Booking | Implementado/testado | User, arena, duracao, preco, status e origem sao derivados server-side |
| Pricing | Implementado/testado | Regra cobre o slot inteiro; precedencia deterministica; preco historico persiste na reserva |
| Double booking | Implementado | Constraint GiST `reservations_no_overlap_active`; teste concorrente requer banco isolado |
| Cancellation | Implementado/testado | Pending/confirmed; exatamente 90 minutos permitido; update condicional grava `cancelled_at`; slot e liberado |
| Owner | Implementado/testado | Ownership nos repositorios; transicoes pending->confirmed e pending/confirmed->cancelled |
| Agenda publica | Implementado/testado | Estados available/reserved/blocked/past/unavailable sem PII |
| E-mail | Implementado/testado localmente | BackgroundTask apos commit, timeout e idempotency key; nao e fila duravel |
| Analytics | Correcao pendente de migration/deploy | Allowlist sem PII; admin-only; ticket medio adicionado; evento de agenda exige nova migration |
| PWA | Implementado | Cache apenas assets locais; navegacao/API/auth nao entram; cache v2 limpa versoes anteriores |
| Loading | Implementado | Minimo 380 ms, timeout 5 s, erro/unmount liberam recursos; validar em dispositivo |
| Health | Confirmado em producao | Resposta minima, sem DB URL, secrets ou configuracao |
| Rate limit | Adequado ao piloto | Em memoria por processo; OPTIONS e tratado pelo CORS externo; nao e distribuido |
| Logs | Melhorado, requer deploy | IDs/listas detalhadas foram removidos; e-mail mantem reservation ID para correlacao sem destinatario |
| Erros | Adequado | FastAPI sem debug; respostas observadas nao exibem stack, SQL ou paths |
| Cache privado | Confirmado | API aplica `no-store`; frontend usa `no-store` em dados privados e service worker ignora APIs/navegacoes |
| Headers | Confirmado em `www` | CSP, HSTS, nosniff, frame deny, referrer, permissions policy e COOP presentes |
| Privacidade | Parcial | Mapa criado; links e textos juridicos ainda ausentes |
| Observabilidade | Parcial | Health e logs existem; uptime e error tracking externo ainda nao configurados |

## Migrations de producao

Aplicar em ordem e registrar data/operador:

- [ ] `202608310001_initial_schema.sql`
- [ ] `202608310002_auth_and_owner_workflow.sql`
- [ ] `202609010001_onboarding_diagnostic.sql`
- [ ] `202609010002_fix_create_arena_rpc.sql`
- [ ] `202609010003_diagnose_onboarding_role_context.sql`
- [ ] `202609010004_fix_profile_role_variable_collision.sql`
- [ ] `202609010005_owner_configuration_rls.sql`
- [ ] `202609010006_reservation_and_blocked_slot_rls.sql`
- [ ] `202609010007_reservation_security_and_pricing_precedence.sql`
- [ ] `202609030001_arena_logo_storage.sql`
- [ ] `202609090001_platform_analytics.sql`
- [ ] `202609110001_security_hardening.sql`
- [ ] `202609170001_allow_arena_schedule_analytics.sql`

As migrations de diagnostico antigas sao historicas; o hardening posterior revoga e remove as RPCs de diagnostico. Nao pule arquivos ao preparar um banco vazio.

## Regressao manual

| Fluxo | Procedimento minimo | Resultado esperado |
| --- | --- | --- |
| 1. Guest reservation | Landing -> Nova reserva -> esporte -> data/hora -> arena -> pre-reserva -> login | Intent preservado e submit unico apos login |
| 2. Player login | Login direto e com `returnTo` interno | Player vai a `/buscar`; URL externa e rejeitada |
| 3. Existing reservation | Abrir Minhas reservas | Dados, timezone e status corretos sem cache antigo |
| 4. Player cancellation | Testar acima, abaixo e exatamente 90 min | Acima/exato permitem; abaixo bloqueia; e-mail unico |
| 5. Owner confirm | Confirmar pending | Player atualiza, `confirmed_at` existe e e-mail chega |
| 6. Owner reject | Cancelar pending | Status cancelled e template de recusa chega |
| 7. Owner cancel | Cancelar confirmed | Status/cancelled_at corretos e template de cancelamento chega |
| 8. Arena schedule | Comparar owner e publico | Reservado/bloqueado/passado/fechado corretos; publico sem PII |
| 9. Admin analytics | Entrar como admin e depois player/owner | Admin ve agregados/ticket; demais nao acessam |
| 10. PWA install/open | Android, Edge/Chrome e iOS | Icones corretos; player/owner/admin entram na home da role; guest na landing |

## Mobile e loading

Validar `360x740`, `375x812`, `390x844`, `414x896` e `430x932` nas paginas landing, login, discovery, nova reserva, disponibilidade, pre-reserva/sucesso, reservas, perfil, dashboard owner, agenda e admin. Conferir scroll horizontal, teclado, safe area, CTA e bottom nav. A auditoria estatica encontrou uso consistente de `100dvh`, safe-area e padding para navegacoes fixas, mas isso nao substitui teste em navegador real.

## Operacao e observabilidade

- Monitorar `GET https://playarena-iwp9.onrender.com/health` a cada 5 minutos em UptimeRobot, Better Stack ou equivalente gratuito.
- Alertar apos duas falhas consecutivas e novamente na recuperacao.
- Nao usar `/docs` como health check.
- Revisar logs de booking, cancellation, e-mail e analytics sem e-mail, telefone, token ou URL de banco.
- Registrar release, migration e horario de deploy para correlacao.
- Considerar Sentry depois do piloto; nao e blocker se health e logs forem acompanhados.

## Verificacoes externas

Depois do deploy e do ajuste de dominio:

- [ ] SecurityHeaders.com para apex e `www`.
- [ ] Mozilla Observatory para o dominio canonico.
- [ ] SSL Labs para TLS/cadeia/redirect.
- [ ] Google Safe Browsing para reputacao.
- [ ] VirusTotal apenas segundo politica aprovada; nao enviar dados privados.

Dominios novos podem ser bloqueados temporariamente por filtros corporativos. Solicite reclassificacao legitima ao fornecedor; nao tente contornar o filtro.

## Validacao automatizada desta revisao

| Comando/verificacao | Resultado |
| --- | --- |
| `python -m pytest services/api/tests -q` | 124 passed, 1 skipped; skip e o teste concorrente que exige banco isolado |
| `python -m compileall -q services/api/app` | Aprovado |
| `python -m pip check` | Sem requisitos quebrados |
| `npm run lint --workspace @playarena/arena-web` | Aprovado |
| `npm run typecheck --workspace @playarena/arena-web` | Aprovado |
| `npm run build --workspace @playarena/arena-web` | Aprovado, 25 rotas; aviso futuro para migrar Node 20 para Node 22+ |
| `npm audit --workspace @playarena/arena-web --omit=dev` | 0 vulnerabilidades |
| `npm audit` | 13 moderadas no Expo/mobile; correcao automatica exigiria breaking change |
| TLS pelo driver da API | `sslmode=require` e `ssl_in_use=True` apos a correcao |
| Bundle web | Nenhum valor local de service role, database URL ou Google key encontrado |
| PWA publicada | Manifest, SW, favicon, normal/maskable/apple icons retornaram `200` |

Ambiente da validacao: Node `20.11.1`, npm `10.2.4` e Python `3.14.6`. Planeje Node 22 antes de uma futura versao do `@supabase/supabase-js`, mas o build atual e valido.

## Ordem final de execucao

1. Fazer backup/export e registrar tag da release.
2. Aplicar a migration `202609170001` no Supabase.
3. Configurar `DATABASE_URL` com `sslmode=require` e `API_DOCS_ENABLED=false` no Render.
4. Inverter o dominio principal no Vercel para o apex e configurar `www` -> apex.
5. Publicar API e web.
6. Provar health `200`, docs `404`, TLS do banco, canonical/redirect e nova ingestao analytics.
7. Confirmar Auth URLs no Supabase e dominio/sender no Resend.
8. Executar os dez fluxos manuais, inclusive e-mails reais.
9. Validar PWA e os cinco viewports.
10. Ativar uptime, revisar logs e registrar decisao final de GO com responsavel e horario.
