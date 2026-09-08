# Autenticacao

## Visao geral

PlayArena usa Supabase Auth com email e senha no mobile e no painel web. A mesma conta pode entrar nos dois clientes.

## Chaves por camada

- Mobile: `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Web: `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Backend: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`

`SUPABASE_SERVICE_ROLE_KEY` nunca deve ser enviada ao browser nem ao app mobile.

## Profiles

- Cada usuario autenticado precisa ter uma linha em `public.profiles`.
- A trigger `public.handle_new_user()` cria esse registro automaticamente apos signup em `auth.users`.
- O role inicial e `player`.

## Roles

Valores permitidos:

- `player`
- `arena_owner`
- `admin`

Na Sprint 1:

- usuarios comuns entram como `player`
- a promocao segura para `arena_owner` acontece por `public.become_arena_owner()`
- nenhum fluxo permite que o usuario se promova para `admin`

## Sessao

- Mobile: sessao persistida com storage local e recuperada na `splash`.
- Web: sessao persistida no navegador e reidratada pelo provider de auth.
- API: JWT Supabase recebido por `Authorization: Bearer <token>` e validado antes de liberar `GET /me`.

## Fluxo do arena owner

1. Usuario cria conta ou faz login.
2. Se ainda for `player`, o painel informa que a area e exclusiva para proprietarios.
3. O usuario promove o proprio role para `arena_owner` pela RPC segura.
4. Sem arena cadastrada, o usuario vai para `/onboarding`.
5. O onboarding chama `public.create_arena_for_current_user(...)`.
6. O banco cria a arena e o vinculo em `arena_owners`.
7. O usuario e redirecionado para `/dashboard`.

## Seguranca

- O frontend usa apenas URL publica + anon key.
- O backend nunca confia em `user_id` ou `role` enviados pelo frontend.
- O role utilizado pela API deve vir do JWT validado e, quando disponivel, do `profile` persistido no banco.
- RLS impede acesso horizontal a profiles, vinculos e arenas nao autorizadas.

## Ambiente de desenvolvimento

Para promover um usuario de teste a `arena_owner`, faça login no painel e use o CTA "Tornar-me proprietario". Como alternativa administrativa, execute a RPC `public.become_arena_owner()` com um usuario autenticado no Supabase.
