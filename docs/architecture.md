# Arquitetura Geral

O monorepo PlayArena separa claramente as responsabilidades entre experiencia do usuario, painel de operacao e backend.

## Camadas

- `apps/mobile`: app React Native para jogadores, mobile first e orientado a busca/reserva.
- `apps/arena-web`: painel web para proprietarios e operadores de arena.
- `services/api`: API FastAPI responsavel por regras de negocio, acesso ao banco e integracoes.
- `packages/config`: tokens compartilhados de design e configuracoes reutilizaveis.
- `packages/types`: tipos de dominio compartilhados entre apps TypeScript.
- `packages/ui`: primitives leves para alinhamento visual e reutilizacao futura.

## Principios adotados

- Regras de negocio ficam fora dos componentes React.
- A API concentra servicos, repositorios, schemas e modelos.
- Tokens de design compartilham o tema dark premium entre mobile e web.
- O banco e desenhado para crescer sem reestruturar entidades centrais.

## Integracoes

- Autenticacao: Supabase Auth
- Banco: Supabase PostgreSQL
- Storage: Supabase Storage
- Realtime: Supabase Realtime

## Sprint 1: autenticacao e onboarding

- `apps/mobile` usa Supabase com `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY`, sessao persistente e recuperacao em `splash`.
- `apps/arena-web` usa Supabase com `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`, protegendo `/dashboard` e `/onboarding` pelo estado autenticado e pelo `role`.
- `services/api` valida JWTs do Supabase no header `Authorization: Bearer <token>` e expõe `GET /me`.
- `SUPABASE_SERVICE_ROLE_KEY` permanece restrita a backend e tarefas administrativas seguras; ela nao e usada pelo navegador.

## Reserva segura

A protecao contra sobreposicao de reservas ativas e tratada no PostgreSQL por meio de uma `EXCLUDE CONSTRAINT` sobre intervalo de datas, limitada a reservas `pending` e `confirmed`. O frontend apenas consome essa garantia; ele nao e fonte de verdade.
