# Configuracao Operacional da Arena

## Fluxo

O painel do proprietario usa a API autenticada para editar a arena, cadastrar quadras, associar modalidades, definir horarios e criar regras de preco. Nenhuma operacao de configuracao aceita `user_id` ou `owner_id` do navegador.

## Modelo

- `arenas`: dados operacionais da arena; o slug nao e editavel no painel.
- `arena_owners`: vinculo entre uma arena e seus proprietarios autorizados.
- `courts`: quadras da arena, com status ativo e duracao padrao.
- `sports` e `court_sports`: catalogo e relacao de multiplas modalidades por quadra.
- `opening_hours`: periodos por dia da semana, substituidos atomicamente pela API.
- `pricing_rules`: preco por quadra, dia e faixa de horario, armazenado como `numeric`.

## Ownership e RLS

Ter `profiles.role = 'arena_owner'` nao concede acesso a todas as arenas. Cada endpoint `/owner/*` exige a role e consulta `arena_owners` para garantir `arena_owners.user_id = auth.uid()` na arena alvo.

A migration `202609010005_owner_configuration_rls.sql` habilita RLS para `court_sports`, `opening_hours` e `pricing_rules`. As policies seguem `court -> arena -> arena_owners` ou `arena -> arena_owners`; nao existe escrita publica nem policy baseada somente em role.

## Validacao no Supabase

Os testes unitarios cobrem a barreira da API. A migration deve ser validada com duas sessoes reais: Owner A escreve apenas em sua arena, Owner B recebe negacao ao usar UUIDs da Arena A e um player nao consegue escrever. Essa verificacao depende do contexto JWT/RLS do Supabase e nao usa service role no navegador.
