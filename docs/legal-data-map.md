# Mapa tecnico de dados pessoais

Este inventario apoia a criacao da Politica de Privacidade e dos Termos de Uso. Ele nao define base legal nem substitui revisao juridica. A retencao abaixo e uma sugestao tecnica a ser aprovada pelo responsavel pelo tratamento.

| Dado | Finalidade no produto | Onde fica | Quem acessa | Retencao sugerida | Base tecnica |
| --- | --- | --- | --- | --- | --- |
| Nome do usuario | Identificacao do player e atendimento da reserva | `public.profiles.full_name` e snapshot `reservations.customer_name` | Proprio usuario, owner da arena relacionada, API e operadores autorizados | Perfil ate exclusao da conta; snapshot conforme prazo comercial/fiscal aprovado | Conta e execucao do fluxo solicitado |
| E-mail | Login, recuperacao de conta e notificacao transacional | Supabase Auth; enviado ao Resend na entrega | Proprio usuario, Supabase Auth, backend e Resend | Conta ate exclusao; logs do provedor pelo menor prazo operacional disponivel | Autenticacao e comunicacao da reserva |
| Telefone | Contato operacional da reserva | `public.profiles.phone` e snapshot `reservations.customer_phone` | Proprio usuario, owner da arena relacionada, API e operadores autorizados | Mesmo prazo aprovado para a reserva; excluir ou anonimizar quando nao houver obrigacao de manter | Operacao da reserva |
| ID de usuario | Relacionar perfil, reserva e evento autenticado | Supabase Auth, `profiles`, `reservations`, `analytics_events` | Backend e operadores autorizados; RLS limita cliente | Enquanto a conta e os registros relacionados forem necessarios | Integridade referencial e autorizacao |
| Dados da reserva | Arena, quadra, horario, status, preco e origem | `public.reservations` | Player dono, owner da arena, admin autorizado e backend | Sugestao inicial: 5 anos se houver necessidade comercial/fiscal; validar juridicamente | Execucao, suporte e auditoria da reserva |
| Cancelamento/confirmacao | Estado e timestamps operacionais | `reservations.status`, `confirmed_at`, `cancelled_at` | Mesmos acessos da reserva | Mesmo prazo da reserva | Auditoria da maquina de estados |
| IDs anonimo e de sessao | Medir funil sem nome, e-mail ou telefone | `public.analytics_events`; browser em local/session storage | Backend e admin | Sugestao: 13 meses, com agregacao ou exclusao posterior | Medicao de uso e melhoria do produto |
| Propriedades de analytics | Cidade, esporte, data, hora, origem e contagem | `analytics_events.properties` | Backend e admin | Sugestao: 13 meses | Analise de demanda e conversao |
| Token de acesso | Autorizar requests | Memoria do cliente e trafego TLS; validacao no Supabase | Cliente, Supabase Auth e backend durante a request | Duracao da sessao/token; nao persistir em logs | Autenticacao |
| Endereco IP | Rate limit e logs de infraestrutura | Memoria do processo durante a janela; possiveis logs de Render/Vercel | Infraestrutura e operadores autorizados | Janela minima do rate limit; revisar retencao dos provedores | Seguranca e disponibilidade |
| Logo da arena | Identidade publica da arena | Supabase Storage `arena-assets` e `arenas.logo_path` | Leitura publica; escrita pelo owner autorizado | Enquanto a arena usar o servico ou ate remocao | Publicacao solicitada pelo owner |
| Dados da arena/owner | Configuracao e autorizacao operacional | `arenas`, `arena_owners`, `courts` e configuracoes | Owner vinculado, backend e operadores autorizados | Enquanto a arena estiver ativa e durante periodo de suporte aprovado | Prestacao do servico para a arena |
| Pagamento e credito | Confirmar antecipacao, reconciliar reserva e manter Saldo PlayArena | `payments`, `booking_holds`, `wallet_transactions` e snapshots em `reservations` | Player ve apenas os proprios registros; backend e admin operacional autorizado | Definir com revisao contabil, fiscal e juridica antes de producao | Execucao do checkout, auditoria e prevencao de duplicidade |

## Minimizacao confirmada

- Analytics rejeita `email`, `phone`, `name`, `full_name`, senhas e tokens; propriedades fora da allowlist tambem sao rejeitadas.
- O rate limiter usa IP apenas em memoria e nao o grava em `analytics_events`.
- A API publica de agenda nao devolve nome, telefone, `user_id`, `reservation_id` ou motivo de bloqueio.
- O destinatario de e-mail e obtido server-side; requests nao podem escolher destinatario, remetente ou HTML.
- Logs de aplicacao nao devem conter Authorization, JWT, e-mail, telefone, URL do banco ou chaves.
- O PlayArena nao recebe numero de cartao, CVV ou credencial bruta; o provider deve hospedar ou tokenizar o pagamento.
- Webhooks persistem apenas identificadores operacionais e hash SHA-256 do payload, nunca o payload financeiro bruto.

## Pendencias de interface e governanca

- Nao ha hoje link visivel para Politica de Privacidade ou Termos de Uso.
- Publicar textos revisados e links acessiveis na landing, login/cadastro e perfil antes da abertura ampla; para o piloto fechado, registrar consentimento e canal de contato por processo operacional.
- Definir canal para solicitacao de acesso, correcao e exclusao.
- Definir responsavel por aprovar retencao, atender incidentes e responder titulares.
- Revisar DPA/termos de Supabase, Vercel, Render e Resend.
- Validar termos de antecipacao, regras do Saldo PlayArena, cancelamento e retencao financeira com assessoria juridica/contabil antes de habilitar pagamento real.
- Documentar se logs de infraestrutura persistem IP e por quanto tempo.
- Criar procedimento de exclusao que trate Auth, perfil, analytics identificavel e backups sem destruir registros que precisem ser legalmente mantidos.
