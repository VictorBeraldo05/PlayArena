# PlayArena

PlayArena e um marketplace de arenas esportivas focado em simplificar a busca por disponibilidade e a pre-reserva de quadras. O MVP atende inicialmente Piracicaba/SP com dois perfis principais: `player` e `arena owner`.

Na Sprint 1, o projeto passa a usar Supabase Auth real em mobile e web, com `profiles` sincronizados no banco e onboarding inicial para proprietarios de arena.

## Stack

- Mobile: Expo, React Native, TypeScript, Expo Router
- Web: Next.js, TypeScript, Tailwind CSS
- API: Python, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic
- Banco e plataforma: Supabase PostgreSQL, Supabase Auth, Supabase Storage, Supabase Realtime

## Estrutura

```text
PlayArena/
  apps/
    mobile/
    arena-web/
  services/
    api/
  packages/
    config/
    types/
    ui/
  supabase/
    migrations/
    seed/
  docs/
```

## Instalacao

### Requisitos

- Node.js 20+
- npm 10+
- Python 3.12+

### Dependencias JavaScript

```bash
npm install
```

### Dependencias da API

```bash
python -m pip install -r services/api/requirements-dev.txt
```

## Configuracao

1. Copie `.env.example` para `.env`.
2. Preencha as credenciais do Supabase e a `DATABASE_URL`.
3. Para desenvolvimento mobile e web, use apenas as variaveis publicas `NEXT_PUBLIC_*` e `EXPO_PUBLIC_*`.
4. Mantenha `SUPABASE_SERVICE_ROLE_KEY` exclusiva do backend e de tarefas administrativas seguras.

## Execucao

### Mobile

```bash
npm run dev:mobile
```

O app recupera a sessao do Supabase ao abrir, redireciona em `splash` e persiste login com storage local.

### Arena Web

```bash
npm run dev:web
```

O painel usa o mesmo usuario e senha do app mobile, protege `/dashboard` e `/onboarding`, e direciona `player` para a area exclusiva de proprietarios.

### API

```bash
npm run dev:api
```

Endpoints atuais:

- `GET /health`
- `GET /me`

## Qualidade

```bash
npm run lint
npm run typecheck
npm run format
pytest services/api
```

## Variaveis de ambiente

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## Chaves por ambiente

- Mobile: `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Web: `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Backend: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`

Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` no browser ou no app mobile.

## Banco e auth

- O `profile` e criado automaticamente no banco apos signup via trigger em `auth.users`.
- O role padrao e `player`.
- A promocao para `arena_owner` acontece por RPC segura no banco.
- O onboarding de arena usa RPC autenticada para criar a arena e o vinculo em `arena_owners`.

## Documentacao

- `docs/architecture.md`
- `docs/database.md`
- `docs/reservation-flow.md`
- `docs/authentication.md`
