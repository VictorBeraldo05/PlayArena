# Deploy do PlayArena

## Supabase

1. Crie o projeto e aplique as migrations em `supabase/migrations` na ordem do nome.
2. Aplique o seed de modalidades em `supabase/seed/202608310001_sports.sql`.
3. Configure as URLs de redirecionamento de autenticação para os domínios web de desenvolvimento e produção.

## API no Render

Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL` e `WEB_ORIGINS`.
Use o comando de inicialização `python -m uvicorn app.main:app --app-dir services/api --host 0.0.0.0 --port $PORT`.
O health check é `GET /health`.

`WEB_ORIGINS` usa uma lista de origens completas, separada por vírgula e sem caminhos. Não use `*` em CORS e não configure `SUPABASE_SERVICE_ROLE_KEY` no navegador.

## Web na Vercel

Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `NEXT_PUBLIC_API_URL`.
`NEXT_PUBLIC_API_URL` deve apontar para a URL HTTPS da API no Render.

## Seguranca de producao

No Render, defina exatamente `WEB_ORIGINS=https://playarena-phi.vercel.app,https://useplayarena.com.br,https://www.useplayarena.com.br`. O formato principal é texto separado por vírgulas, não JSON. `WEB_ORIGIN` continua como fallback apenas quando `WEB_ORIGINS` estiver ausente, para compatibilidade com ambientes antigos.

No startup, confira o log sem segredos `CORS allowed origins: [...]` e confirme que ele lista as três origens de produção. Se `WEB_ORIGINS` estiver vazio ou ausente, a API usa o fallback seguro de localhost e das origens PlayArena conhecidas.

No Render, defina `API_DOCS_ENABLED=false` no piloto publico. Defina `TRUST_PROXY_HEADERS=true` somente depois de confirmar que o proxy do Render sobrescreve `X-Forwarded-For`. A `DATABASE_URL` do Supabase deve exigir TLS, por exemplo com `sslmode=require`.

## Mobile

Configure apenas `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Chaves service role e URLs de banco nunca pertencem ao app cliente.
