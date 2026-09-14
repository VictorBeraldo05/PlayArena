# Reservas - Sprint 3A

## Contrato do player

`POST /player/reservations` aceita somente `court_id`, `start_at`, `customer_name` e `customer_phone`. O backend deriva a arena, a duracao da quadra, `end_at`, preco, `status=pending` e `source=app` a partir do usuario autenticado e da configuracao persistida.

`GET /player/reservations` sempre filtra por `reservations.user_id` do token validado e retorna reservas `pending`, `confirmed`, `cancelled`, `completed` e `no_show`. A interface mostra em Próximas apenas reservas futuras ativas (`pending` e `confirmed`); canceladas pertencem ao Histórico.

## Player Cancellation Policy

`PATCH /player/reservations/{reservation_id}/cancel` permite ao jogador cancelar somente a própria reserva em status `pending` ou `confirmed`, até **90 minutos antes do início**, inclusive. A regra é avaliada no backend com timestamps timezone-aware equivalentes a `America/Sao_Paulo`; o frontend apenas antecipa a disponibilidade da ação.

O update é transacional, trava a reserva, confere novamente status e prazo e grava `status=cancelled` com `cancelled_at`. Uma reserva cancelada deixa imediatamente de bloquear disponibilidade, pois as consultas consideram somente `pending` e `confirmed`. O cancelamento pelo player envia o e-mail de **Reserva cancelada** somente depois da transição persistida.

## Disponibilidade e preco

Uma opcao aparece somente quando arena e quadra estao ativas, a modalidade corresponde, todo o intervalo cabe em `opening_hours`, nao ha bloqueio sobreposto e nao ha reserva `pending` ou `confirmed` sobreposta. Reservas `cancelled`, `completed` e `no_show` nao bloqueiam novos horarios; isso e intencional, pois apenas reservas futuras ativas ocupam a agenda.

Uma regra de preco e aplicavel quando possui o mesmo `weekday` e cobre todo o intervalo solicitado. Entre regras aplicaveis, vence a de menor faixa de tempo. Empates usam `created_at` mais recente e, por fim, `id` decrescente. Sem regra aplicavel, o horario nao pode ser reservado.

## Autorizacao e RLS

O owner so acessa reservas e bloqueios ligados a uma arena presente em `arena_owners`. Ter `profiles.role = 'arena_owner'` nao concede acesso a todas as arenas. Players leem somente as proprias reservas.

As escritas de reservas e bloqueios passam pela API autenticada. A migration `202609010007_reservation_security_and_pricing_precedence.sql` revoga escrita direta para `authenticated`, evitando que um browser altere preco, status, source, arena ou duracao. A constraint de exclusao `reservations_no_overlap_active` continua sendo a protecao final contra duas pre-reservas concorrentes.

`app_revenue` no resumo do owner soma somente reservas `source=app` com status `confirmed` ou `completed`.

## Teste de concorrencia

`tests/test_reservation_concurrency_integration.py` usa duas conexoes reais e exige um banco isolado com migrations aplicadas. Para habilita-lo, informe `PLAYARENA_TEST_DATABASE_URL`, `PLAYARENA_TEST_COURT_ID`, `PLAYARENA_TEST_PLAYER_ID` e `PLAYARENA_TEST_SLOT_START_AT` (um horario configurado e livre). Sem essas variaveis, o teste e ignorado para nao escrever acidentalmente em um ambiente compartilhado.
