# Notificações por e-mail

## Escopo atual

O backend envia e-mail transacional apenas ao jogador vinculado à reserva de aplicativo. A fonte do destinatário é sempre `reservations.user_id -> auth.users.email`; a API não aceita destinatário, remetente, assunto ou HTML de requests.

As transições existentes são:

- `pending -> confirmed`: e-mail **Sua reserva foi confirmada ✅**.
- `pending -> cancelled`: e-mail de recusa. O botão existente **Recusar** usa essa transição; não há status `rejected` no schema.
- `confirmed -> cancelled`: e-mail **Reserva cancelada**.
- cancelamento iniciado pelo player (`pending` ou `confirmed`): e-mail **Reserva cancelada**, inclusive para uma pré-reserva ainda pendente. Essa origem não é tratada como recusa da arena.

Reservas manuais não têm `user_id` e não recebem e-mail nesta fase. Owner também não recebe notificações nesta fase.

## Arquitetura e falhas

`POST /owner/reservations/{id}/confirm` e `cancel` primeiro persistem a transição. Somente após o commit a rota agenda uma `BackgroundTask` que busca o contexto server-side e chama o Resend. A resposta continua independente do provider: falhas, timeout, ausência de configuração ou de e-mail apenas geram log seguro com `reservation_id`.

Cada transição válida agenda uma única tarefa. O update condicional impede uma segunda confirmação e o envio inclui `Idempotency-Key` por reserva e tipo de notificação. Os templates têm HTML com CSS inline e versão texto; os nomes dinâmicos são escapados no HTML. Data e hora são exibidas em `America/Sao_Paulo` e os CTAs usam somente `FRONTEND_URL`:

- confirmação e cancelamento: `/player/reservas`;
- recusa: `/reservar`.

`BackgroundTasks` não é fila durável. Se o processo cair entre o commit e a execução, o e-mail pode não ser enviado. Não há retry automático nesta primeira fase: a chave de idempotência protege contra duplicidade, mas uma entrega durável fica para uma fila/outbox. Para uma fase posterior, criar `notification_outbox` transacional mais worker com retry/deduplicação durável.

A reserva não armazena a modalidade selecionada. O e-mail deriva a modalidade das modalidades configuradas na quadra; se a quadra aceitar mais de uma, todas são exibidas. Uma evolução futura pode persistir `sport_id` na reserva para registrar a escolha exata.

## Configuração

Variáveis do backend no Render:

```env
EMAIL_NOTIFICATIONS_ENABLED=true
RESEND_API_KEY=re_...
EMAIL_FROM=PlayArena <reservas@useplayarena.com.br>
FRONTEND_URL=https://useplayarena.com.br
EMAIL_REQUEST_TIMEOUT_SECONDS=5
```

Em desenvolvimento, mantenha `EMAIL_NOTIFICATIONS_ENABLED=false`. Nenhuma chave é exposta ao frontend. Produção exige verificar `useplayarena.com.br` no Resend e configurar o remetente `reservas@useplayarena.com.br`; DNS e a criação da chave são tarefas no painel do Resend, não no código.

## Teste manual

1. Configure o domínio e as variáveis no Render e faça redeploy.
2. Crie uma pré-reserva com um usuário Supabase que tenha e-mail real.
3. Confirme-a no dashboard owner e confira o e-mail de confirmação.
4. Crie outra pré-reserva e use **Recusar** para conferir o e-mail de recusa.
5. Cancele uma reserva confirmada para conferir o e-mail de cancelamento.

Os testes automatizados usam sender falso e nunca chamam o Resend.
