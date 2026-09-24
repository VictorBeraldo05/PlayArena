# Auditoria de Seguranca - 2026-09-11

## Resultado executivo

O codigo esta **GO WITH CONDITIONS** para um piloto somente depois de aplicar a migration de seguranca e concluir o checklist de infraestrutura em `production-security-checklist.md`. A auditoria cobriu web, API, migrations, RLS, storage, auth, analytics, reservas, configuracoes e dependencias.

| Finding | Severidade | Status | Impacto | Correcao |
| --- | --- | --- | --- | --- |
| Tabelas no schema publico sem RLS explicito | High | Corrigido, requer migration | Dados auxiliares poderiam ficar acessiveis conforme grants do Supabase | RLS para `sports`, `favorites`, `notifications` e `recurring_reservations` |
| Reserva do player podia receber horario passado | High | Corrigido | Historico e disponibilidade podiam ser adulterados | Validacao server-side em disponibilidade, pre-reserva, bloqueio e reserva manual |
| Owner podia confirmar reserva ja cancelada | High | Corrigido | Transicao fora da maquina de estados | Confirmacao so de `pending`; cancelamento de `pending` ou `confirmed`, com compare-and-update |
| RPCs de diagnostico de onboarding executaveis por autenticados | Medium | Corrigido, requer migration | Exposicao desnecessaria de contexto interno | Cliente removido; migration revoga e remove as RPCs |
| CORS sem suporte seguro a multiplas origens | Medium | Corrigido | Deploy poderia exigir configuracao insegura | `WEB_ORIGINS` validado; `WEB_ORIGIN` mantido por compatibilidade |
| Sem CSP e headers padronizados no web | Medium | Corrigido | Maior superficie para clickjacking, MIME sniffing e XSS | CSP, HSTS em producao, frame deny, nosniff, referrer e permissions policy |
| Endpoints sensiveis sem limite de abuso | Medium | Corrigido com limite local | Spam, custo e DoS de baixo volume | Limites por minuto em memoria, sem persistir IP |
| Analytics aceitava propriedades arbitrarias | Medium | Corrigido | PII e poluicao de metricas | Schema estrito, allowlist e limite de 2 KB |
| `.env.example` ignorado pelo Git | Low | Corrigido | Contrato de configuracao podia deixar de ser versionado | Removido do `.gitignore`; inclua-o no proximo commit |
| Google key em `.env` local mobile, sem consumo por codigo | Low | Pendente manual | Nao esta rastreada nem e embutida sem `EXPO_PUBLIC_`, mas nao deve ficar no cliente | Remover do ambiente mobile e rotacionar se ja foi usada em build |
| Docs OpenAPI publicos por padrao | Low | Corrigido, requer deploy | Enumera endpoints sem conceder acesso | Default seguro `false` e `API_DOCS_ENABLED=false` em producao |
| Dependencias Expo/mobile moderadas | Medium | Pendente | Toolchain Expo/Xcode | Atualizar em branch dedicada; correcao sugerida e major/incompativel |

## Controles confirmados

- A API usa Bearer token validado no Supabase; autorizacao usa role persistido no banco, nao a UI.
- Player e owner sao filtrados pelo usuario autenticado e joins de posse. `/admin/analytics/overview` exige `admin` no backend. Escritas de configuracao de arena sao fechadas ao cliente direto; profiles permitem apenas `full_name` e `phone` do proprio usuario.
- Preco, arena, duracao, status inicial e `user_id` de pre-reserva sao derivados no servidor. O browser nao envia esses campos.
- A constraint PostgreSQL `reservations_no_overlap_active` e a barreira final contra double booking.
- Queries SQL usam parametros. Campos de updates dinamicos sao definidos por schemas Pydantic, nao por chaves livres.
- O bucket publico `arena-assets` aceita apenas PNG/JPEG/WEBP ate 5 MB. Escrita e delete exigem ownership de `arenas/{arena_id}`; a API aceita apenas logo do mesmo `arena_id`.
- Nao ha `dangerouslySetInnerHTML`, proxy generico de URL ou integracao Google Places no codigo atual. Nao foi encontrado vetor SSRF ativo.
- Analytics controla nomes de evento, deriva `user_id` do token, proibe PII e expoe consulta global apenas a admin.
- A API usa bearer headers, nao cookie proprio; CSRF classico nao e o vetor primario. XSS segue mitigado por React, CSP e ausencia de HTML bruto.

## Pendencias e risco residual

- A migration `202609110001_security_hardening.sql` precisa ser aplicada no Supabase. Ate isso, o finding de RLS e as RPCs de diagnostico continuam no banco publicado.
- Rate limiting e por processo Render. Para multiplas instancias ou trafego hostil, configure WAF/limite na borda ou armazenamento compartilhado.
- Configuracoes externas de Vercel, Render, DNS, Auth Redirect URLs, bucket real e migrations aplicadas nao podem ser comprovadas pelo repositorio; use o checklist manual.
- A `GOOGLE_PLACES_API_KEY` encontrada em ambiente local mobile nao e consumida nem rastreada. Remova-a desse ambiente e rotacione se houver qualquer possibilidade de exposicao anterior.
- Nenhum `.env`, certificado ou credential foi encontrado rastreado. A varredura de historico encontrou apenas credenciais ficticias de testes.
- `NEXT_PUBLIC_API_URL`, URL Supabase e anon key sao publicos por definicao. Service role, banco e Google key nao aparecem no frontend rastreado.

## Validacoes

- `python -m pytest services/api/tests -q`: 81 passed, 1 skipped. O skip exige banco isolado para concorrencia PostgreSQL.
- `python -m compileall -q services/api/app`: aprovado.
- `npm audit --workspace @playarena/arena-web --omit=dev --json`: 0 vulnerabilidades.
- `npm audit --omit=dev --json`: 13 vulnerabilidades moderadas no grafo Expo/mobile; 0 high/critical.
- `pip-audit` e `safety` nao estao instalados; nao foram instalados automaticamente.
