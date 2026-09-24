# Checklist de Seguranca para Producao

## Antes do deploy

- [ ] Aplicar migrations em ordem, incluindo `202609110001_security_hardening.sql`.
- [ ] Confirmar no Supabase RLS ativo e sem leitura publica em `analytics_events`.
- [ ] Testar owner A contra UUID da arena B, player A contra reserva B e player contra rotas owner/admin.
- [ ] Testar storage com imagem valida, arquivo acima de 5 MB, SVG, caminho de outra arena e delete de outra arena.
- [ ] Configurar `DATABASE_URL` com TLS obrigatorio, como `sslmode=require`.

## Render - API

- [ ] Configurar somente no Render: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` se usado, `DATABASE_URL` e `WEB_ORIGINS`.
- [ ] Usar `WEB_ORIGINS=https://playarena-phi.vercel.app,https://useplayarena.com.br,https://www.useplayarena.com.br`, em texto separado por vírgulas e sem JSON.
- [ ] Confirmar no startup o log `CORS allowed origins: [...]` com exatamente as três origens de produção.
- [ ] Definir `API_DOCS_ENABLED=false` para piloto publico. O codigo agora tambem adota `false` por default; confirmar `404` apos o deploy.
- [ ] Manter `TRUST_PROXY_HEADERS=false` ate confirmar que o Render normaliza `X-Forwarded-For`.
- [ ] Comecar com analytics 120/min/IP, disponibilidade 60/min/IP, reservas 10/min/usuario e mutacoes owner 90/min/usuario.
- [ ] Adicionar WAF/limite na borda antes de escalar multiplas instancias Render.
- [ ] Proibir logs de Authorization, JWT, refresh token, service role, database URL, email e telefone completo.

## Vercel e dominio

- [ ] Configurar somente `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `NEXT_PUBLIC_API_URL` no web.
- [ ] Garantir `NEXT_PUBLIC_API_URL` HTTPS durante o build para entrar no `connect-src` da CSP.
- [ ] Definir `https://useplayarena.com.br` como canonico e redirecionar `www`, ou documentar a decisao inversa.
- [ ] Verificar headers finais: CSP, HSTS, nosniff, frame deny, referrer e permissions policy.
- [ ] Confirmar que respostas da API privadas possuem `Cache-Control: no-store`.
- [ ] Confirmar dominio canonico no HTML. A landing define canonical para `https://useplayarena.com.br`; hoje o Vercel redireciona o apex para `www`, portanto a configuracao deve ser invertida antes do deploy web.

## Supabase e Google Cloud

- [ ] Definir Site URL e Redirect URLs de Auth para dominio canonico, `www` se usado e localhost de desenvolvimento.
- [ ] Confirmar policies do bucket `arena-assets`, MIME PNG/JPEG/WEBP e limite de 5 MB; nao liberar SVG sem sanitizacao.
- [ ] Manter service role somente no backend e rotacionar qualquer chave publicada em build, commit ou log.
- [ ] Remover `GOOGLE_PLACES_API_KEY` de ambientes de cliente. Quando houver backend Places, restringir por API, egress/IP, quota e alerta de custo.

## Verificacao independente

- [ ] Testar SecurityHeaders.com, Mozilla Observatory e SSL Labs.
- [ ] Verificar dominio no Google Safe Browsing e arquivos na VirusTotal conforme a politica de privacidade.
- [ ] Revalidar guest -> reserva -> login -> pre-reserva, player -> reservas, owner -> agenda/confirmacao e admin -> analytics.
- [ ] Rodar `npm audit`, `pip-audit` quando disponivel e os testes antes de cada release.

`robots.txt`, sitemap e canonical ajudam SEO, mas nao controlam acesso. Adicione `security.txt` apenas quando houver contato de seguranca monitorado.
