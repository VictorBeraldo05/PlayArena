# Banco de Dados

## Tabelas principais

- `profiles`: extensao do usuario autenticado no Supabase.
- `arenas`: cadastro das arenas disponiveis no marketplace.
- `arena_owners`: relacao N:N entre usuarios e arenas administradas.
- `sports`: modalidades atendidas.
- `courts`: quadras pertencentes a uma arena.
- `court_sports`: modalidades suportadas por cada quadra.
- `opening_hours`: horario padrao de funcionamento por arena e dia da semana.
- `pricing_rules`: regras de precificacao por quadra, dia e faixa de horario.
- `reservations`: pre-reservas e reservas confirmadas.
- `recurring_reservations`: base para recorrencia semanal futura.
- `blocked_slots`: bloqueios operacionais de agenda.
- `favorites`: arenas favoritas dos jogadores.
- `notifications`: eventos e alertas futuros ao usuario.

## Relacionamentos

- `profiles.id -> auth.users.id`
- `arena_owners.user_id -> profiles.id`
- `arena_owners.arena_id -> arenas.id`
- `courts.arena_id -> arenas.id`
- `court_sports.court_id -> courts.id`
- `court_sports.sport_id -> sports.id`
- `pricing_rules.court_id -> courts.id`
- `reservations.arena_id -> arenas.id`
- `reservations.court_id -> courts.id`
- `reservations.user_id -> profiles.id`
- `blocked_slots.court_id -> courts.id`
- `blocked_slots.created_by -> profiles.id`

## Sprint 1: auth, profiles e ownership

- O signup no Supabase Auth dispara uma trigger em `auth.users` que garante a criacao do `profile`.
- O `profile.role` nasce como `player`.
- A funcao `public.become_arena_owner()` promove com seguranca um usuario autenticado para `arena_owner`, sem permitir promocao para `admin`.
- A funcao `public.create_arena_for_current_user(...)` cria a arena e o vinculo em `arena_owners` numa unica operacao protegida.

## Regra critica

Reservas com status `pending` e `confirmed` nao podem se sobrepor para a mesma quadra. A migration inicial cria:

- extensao `btree_gist`
- coluna gerada `reservation_window` do tipo `tstzrange`
- `EXCLUDE USING gist (court_id WITH =, reservation_window WITH &&) WHERE (status IN ('pending', 'confirmed'))`

Essa abordagem protege tanto chamadas da API quanto operacoes diretas no banco.

## RLS planejado

- `profiles`: o usuario autenticado pode ler e atualizar apenas o proprio profile, sem alterar livremente o proprio role.
- `arenas`: usuarios autenticados podem ler arenas ativas; proprietarios tambem podem ler e editar arenas vinculadas.
- `arena_owners`: o usuario autenticado pode visualizar apenas os proprios vinculos.
- `admin`: acesso ampliado futuro.
