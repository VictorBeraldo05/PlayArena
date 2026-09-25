# Pagamentos e Saldo PlayArena

## Escopo da v1

- A antecipacao e definida no backend por `BOOKING_ADVANCE_AMOUNT` e inicia em `R$ 5,00`.
- O valor nao e adicional: `court_price_total = booking_amount_paid + amount_due_at_venue`.
- O saldo e credito interno, sem saque, deposito pelo player, PIX para carteira ou transferencia.
- Nao ha pagamento misto. Com saldo menor que R$ 5, a cobranca externa deve ser integral e o saldo existente e preservado.
- O adapter Mercado Pago existe somente para homologacao em test mode. `PAYMENT_PROVIDER=disabled` continua sendo o default seguro.

## Modelo e invariantes

- `booking_holds`: bloqueio de slot por 10 minutos; queries ignoram expirados e novas tentativas fazem cleanup transacional.
- `payments`: estado independente da reserva (`pending`, `paid`, `failed`, `expired`, `cancelled`).
- `wallet_transactions`: ledger imutavel e fonte da verdade; o saldo e `sum(amount)`.
- `payment_webhook_events`: idempotencia por provider/evento e somente hash do payload.
- `reservations`: snapshots `court_price_total`, `booking_amount_paid`, `amount_due_at_venue`, `currency` e `payment_id`.
- Advisory lock por quadra/janela serializa checkout, bloqueio e reserva manual; constraints GiST continuam como ultima protecao.

O endpoint legado `POST /player/reservations` retorna `payment_required`. Reservas de app sao criadas somente pela conversao de um pagamento confirmado ou por debito atomico do Saldo PlayArena.

## Checkout e webhook

1. `GET /player/checkout/quote` resolve perfil, modalidade, duracao, preco e saldo no servidor.
2. `POST /player/checkout` recebe apenas slot, modalidade, forma e chave de idempotencia.
3. Carteira suficiente: lock do usuario, debito, pagamento pago e reserva pendente na mesma transacao.
4. Provider: hold e pagamento pendente sao criados; o redirect do frontend nunca aprova o pagamento.
5. Somente webhook assinado converte o hold em reserva.
6. Evento repetido e no-op. Valor/moeda divergentes sao rejeitados.
7. Pagamento confirmado depois do hold ou com conflito gera credito protegido, sem reserva duplicada.

Falha de e-mail e sempre efeito secundario: nao desfaz pagamento, reserva ou credito.

## Sandbox local

Use apenas em ambiente isolado:

```env
BOOKING_ADVANCE_AMOUNT=5.00
PAYMENT_HOLD_MINUTES=10
PAYMENT_PROVIDER=sandbox
PAYMENT_SANDBOX_ENABLED=true
PAYMENT_WEBHOOK_SECRET=<segredo-aleatorio-local>
```

O endpoint de conclusao sandbox chama o mesmo verificador HMAC e processador idempotente do webhook. Nunca habilite esse modo em producao.

## Mercado Pago Checkout Pro/Orders em test mode

O adapter usa checkout hospedado, Order com `checkout_url`, `X-Idempotency-Key`, webhook com `x-signature` e consulta server-side em `GET /v1/orders/{id}`. A integracao produtiva permanece bloqueada:

- [Criar order no Checkout Pro](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order)
- [Credenciais e separacao teste/producao](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/credentials)
- [Webhooks e assinatura](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/notifications)

Veja o runbook completo em [mercado-pago-integration.md](./mercado-pago-integration.md).

Passos manuais antes da homologacao:

1. Criar e validar a conta/aplicacao Mercado Pago da entidade responsavel.
2. Aprovar produto, taxas, fluxo Pix/cartao, recebedor e tratamento contabil dos creditos.
3. Obter credenciais de teste (`Access Token`; `Public Key` somente se a solucao escolhida exigir frontend).
4. Cadastrar URL HTTPS de webhook e obter o segredo de assinatura.
5. Configurar Render com `PAYMENT_PROVIDER=mercado_pago`, `PAYMENT_ENV=test` e `PAYMENT_SANDBOX_ENABLED=true`.
6. Executar homologacao completa com credenciais de teste e reconciliacao sem divergencias.
7. Manter producao bloqueada ate uma sprint especifica, revisao juridica e aprovacao operacional.

Nao criar `NEXT_PUBLIC_PAYMENT_SECRET`. Access Token e segredo de webhook pertencem somente ao backend.

## Termos e privacidade

Antes do go-live financeiro, textos revisados devem explicar que os R$ 5 sao antecipacao abatida do campo, em quais cancelamentos o credito interno e gerado, como o credito pode ser usado e por quanto tempo registros financeiros sao mantidos. Este documento descreve comportamento tecnico e nao substitui revisao juridica.
