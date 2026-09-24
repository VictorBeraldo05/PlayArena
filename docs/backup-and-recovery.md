# Backup e recuperacao

Este documento e um procedimento operacional, nao uma confirmacao do plano contratado no Supabase. Antes do piloto, um responsavel deve verificar no painel do projeto quais backups automaticos, retencao e Point-in-Time Recovery estao realmente disponiveis.

## Escopo que precisa de backup

| Ativo | Fonte oficial | Estrategia |
| --- | --- | --- |
| Schema e dados PostgreSQL | Supabase Database | Backup gerenciado confirmado no painel e export manual criptografado |
| Usuarios de autenticacao | Supabase Auth | Confirmar se o backup contratado inclui o schema `auth`; nunca exportar senhas |
| Logos de arenas | bucket `arena-assets` | Inventario e copia dos objetos preservando os caminhos |
| Schema versionado | `supabase/migrations/` | Git remoto protegido e tag de release |
| Seed de esportes | `supabase/seed/` | Git remoto protegido |
| Configuracao de deploy | Vercel, Render, Supabase e Resend | Inventario de nomes, proprietarios e procedimento; nao armazenar segredos no Git |

## Antes do piloto

- [ ] Abrir o painel Supabase e registrar internamente plano, frequencia, retencao, regiao e ultima execucao bem-sucedida.
- [ ] Confirmar se Database Backups inclui `public`, `auth` e metadados necessarios para restauracao.
- [ ] Confirmar que pelo menos duas pessoas autorizadas conseguem acessar o projeto e o provedor DNS.
- [ ] Fazer um export manual antes de cada migration de producao.
- [ ] Copiar o bucket `arena-assets` e comparar quantidade, caminhos e tamanhos.
- [ ] Marcar a release em Git que corresponde ao schema exportado.

## Export manual do banco

Execute em uma estacao confiavel, com `DATABASE_URL` recebida por secret manager e TLS obrigatorio. O arquivo nao deve entrar no repositorio.

```bash
pg_dump --format=custom --no-owner --no-acl --file=playarena-YYYYMMDD.dump "$DATABASE_URL"
```

Validacoes minimas:

- `pg_restore --list playarena-YYYYMMDD.dump` termina sem erro.
- O arquivo e criptografado antes de ser enviado ao armazenamento de backup.
- O acesso fica limitado aos operadores de producao.
- O checksum e registrado separadamente.
- O ciclo de vida elimina copias vencidas de forma controlada.

O `pg_dump` pode nao ter permissao para todos os schemas gerenciados pelo Supabase. Se `auth` ou `storage` forem omitidos, documente a limitacao e use o mecanismo oficial do painel como fonte de recuperacao desses schemas.

## Storage

O banco guarda `arenas.logo_path`, mas o binario fica no bucket publico `arena-assets`. Um backup apenas do PostgreSQL nao recupera a imagem.

- Liste objetos por prefixo `arenas/{arena_id}/`.
- Baixe os objetos sem achatar os caminhos.
- Registre tamanho, MIME e checksum.
- Nao transforme o backup em bucket publico.
- No restore, envie os objetos antes do smoke test de logos.

## Teste de restore

Nunca teste restore sobre producao. Crie um projeto Supabase isolado e vazio.

1. Registre a tag Git, a data do dump e o inventario de storage.
2. Restaure o dump com `pg_restore --clean --if-exists --no-owner` somente no projeto isolado.
3. Aplique apenas migrations posteriores ao dump, em ordem.
4. Restaure `arena-assets` preservando os caminhos.
5. Confirme RLS em todas as tabelas publicas e policies de storage.
6. Execute smoke tests de login, busca, criacao/cancelamento, owner e analytics com dados de teste.
7. Confirme a constraint `reservations_no_overlap_active` e o evento `arena_schedule_viewed`.
8. Destrua o ambiente temporario e os dados exportados conforme a retencao aprovada.

## Cadencia inicial recomendada

| Atividade | Piloto |
| --- | --- |
| Verificar status do backup gerenciado | Diariamente |
| Export manual criptografado | Semanal e antes de migration |
| Backup de `arena-assets` | Semanal e antes de mudanca de storage |
| Teste completo de restore | Mensal no piloto |
| Revisar acessos e chaves | Mensal ou apos troca de equipe |

Meta inicial sugerida: RPO de 24 horas e RTO de 4 horas. Ajuste depois de medir volume e impacto; isto nao substitui compromisso comercial do provedor.

## Incidente e recuperacao

1. Interrompa writes somente se houver risco de ampliar corrupcao.
2. Preserve logs e horario do incidente sem copiar tokens ou PII para canais publicos.
3. Escolha o ponto de restauracao anterior ao incidente.
4. Restaure em ambiente isolado e valide antes de qualquer troca de trafego.
5. Rotacione credenciais se houver suspeita de acesso indevido.
6. Registre dados perdidos entre o ponto de backup e o incidente.
7. Execute os dez fluxos de regressao de `go-live-checklist.md`.
8. Documente causa, impacto e acao preventiva.
