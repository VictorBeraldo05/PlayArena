# Analytics da plataforma

## Ingestao

O browser envia eventos para `POST /analytics/events`. A API aplica rate limit, valida uma allowlist estrita, deriva `user_id` do token quando presente e grava via backend. O cliente usa um ID anonimo em local storage, uma sessao renovada apos 30 minutos de inatividade e deduplicacao em memoria por chave.

Eventos aceitos:

| Evento | Uso |
| --- | --- |
| `app_opened` | Entrada no aplicativo |
| `search_started` | Inicio do fluxo de busca |
| `availability_searched` | Busca submetida |
| `availability_results_viewed` | Resultado com disponibilidade |
| `availability_no_results` | Demanda sem oferta |
| `arena_viewed` | Detalhe de arena aberto |
| `arena_schedule_viewed` | Agenda publica da arena aberta |
| `reservation_started` | Pre-reserva iniciada |
| `reservation_login_required` | Conversao interrompida para login |

`reservation_submitted` e `reservation_confirmed` no funil administrativo sao derivados da tabela de reservas, nao ingeridos do browser. Isso evita confiar no cliente para conversoes finais.

## Privacidade

Properties permitidas: `city`, `sport`, `date`, `time`, `source`, `results_count` e `start_at`. Nome, e-mail, telefone, senhas, tokens e propriedades desconhecidas falham na validacao. IP pode ser usado transitoriamente pelo rate limiter, mas nao e persistido pela camada de analytics.

## Painel administrativo

`GET /admin/analytics/overview?days=1|7|30` exige role `admin` no backend. A resposta agrega usuarios novos, buscas, reservas, GMV, ticket medio, tempo medio de confirmacao, funil, demanda sem oferta e ranking de arenas. Nao retorna PII de players.

## Migration obrigatoria

Aplicar `202609170001_allow_arena_schedule_analytics.sql`. Ela alinha a constraint PostgreSQL ao evento `arena_schedule_viewed`, que ja faz parte do contrato da API. Ate a migration ser aplicada, esse evento recebe erro no banco e nao e gravado.

## Verificacao do piloto

1. Abra cada etapa do funil uma vez e aguarde a resposta `202` da ingestao.
2. Confirme ausencia de eventos duplicados obvios na mesma navegacao.
3. Abra a agenda de arena e confirme `arena_schedule_viewed` no banco depois da migration.
4. Crie e confirme uma reserva de teste; compare o funil derivado com a tabela de reservas.
5. Acesse `/admin/analytics` com admin e confirme GMV e ticket medio.
6. Tente acessar a rota/API como player e owner; ambos devem falhar ou redirecionar.
7. Inspecione uma amostra de `properties` e confirme ausencia de PII.
