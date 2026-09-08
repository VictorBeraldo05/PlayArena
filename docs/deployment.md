# Deploy do PlayArena

## Supabase

1. Crie o projeto e aplique as migrations em `supabase/migrations` na ordem do nome.
2. Aplique o seed de modalidades em `supabase/seed/202608310001_sports.sql`.
3. Configure as URLs de redirecionamento de autenticação para os domínios web de desenvolvimento e produção.

## API no Render

Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL` e `WEB_ORIGIN`.
Use o comando de inicialização `python -m uvicorn app.main:app --app-dir services/api --host 0.0.0.0 --port $PORT`.
O health check é `GET /health`.

`WEB_ORIGIN` deve ser a URL exata do web publicado. Não use `*` em CORS e não configure `SUPABASE_SERVICE_ROLE_KEY` no navegador.

## Web na Vercel

Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `NEXT_PUBLIC_API_URL`.
`NEXT_PUBLIC_API_URL` deve apontar para a URL HTTPS da API no Render.

## Mobile

Configure apenas `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Chaves service role e URLs de banco nunca pertencem ao app cliente.
