# Pagamentos e Saldo PlayArena

## Escopo da v1

- A antecipacao e definida no backend por `BOOKING_ADVANCE_AMOUNT` e inicia em `R$ 5,00`.
- O valor nao e adicional: `court_price_total = booking_amount_paid + amount_due_at_venue`.
- O saldo e credito interno, sem saque, deposito pelo player, PIX para carteira ou transferencia.
- O player pode combinar saldo interno e Pix; com saldo menor que R$ 5, o Pix cobra apenas a diferenca.
- O adapter Mercado Pago suporta test mode e producao; `PAYMENT_PROVIDER=disabled` e `PAYMENT_PRODUCTION_ENABLED=false` continuam sendo os defaults seguros.

## Modelo e invariantes

- `booking_holds`: bloqueio temporario do slot; para Mercado Pago, no minimo 31 minutos, com Pix vencendo um minuto antes.
- `payments`: estado independente da reserva (`pending`, `paid`, `failed`, `expired`, `cancelled`).
- `wallet_transactions`: ledger imutavel e fonte da verdade; o saldo e `sum(amount)`.
- `payment_webhook_events`: idempotencia por provider/evento e somente hash do payload.
- `reservations`: snapshots `court_price_total`, `booking_amount_paid`, `amount_due_at_venue`, `currency` e `payment_id`.
- Advisory lock por quadra/janela serializa checkout, bloqueio e reserva manual; constraints GiST continuam como ultima protecao.

Com `BOOKING_PAYMENT_ENABLED=true`, `POST /player/reservations` retorna `payment_required`. Reservas pagas de app continuam sendo criadas somente pela conversao de um pagamento confirmado ou por debito atomico do Saldo PlayArena.

## Modo temporario sem antecipacao

- `BOOKING_PAYMENT_ENABLED=true` e o default seguro: novas reservas seguem o checkout, Pix/Saldo PlayArena, hold, webhook e conversao atuais. `PAYMENT_PRODUCTION_ENABLED` continua controlando separadamente a disponibilidade de pagamentos produtivos.
- Para o periodo sem cobranca, configure `BOOKING_PAYMENT_ENABLED=false` **somente no backend**. Nao e necessario remover credenciais nem alterar o frontend. Para reativar, volte a `true` e reinicie/reimplante a API; nao ha migration de reativacao.
- O quote autenticado informa `payment_required=false`, resolve quadra, modalidade, horario e preco reais e nao consulta o saldo. O mesmo `/reservar` mostra valor integral a pagar na arena e envia `POST /player/reservations`; o backend valida novamente perfil, horario, duracao, preco, bloqueios e disponibilidade antes de inserir uma reserva `pending`.
- A reserva gratuita usa `court_price_total=preco real`, `booking_amount_paid=0.00`, `amount_due_at_venue=court_price_total`, `payment_id=null` e `currency=BRL`. Nao cria payment, Pix, hold nem transacao de wallet. O lock transacional compartilhado com o checkout, a constraint de overlap e a resposta idempotente para o mesmo player/slot impedem duplicidade.
- A flag afeta **apenas novas solicitacoes**. Webhooks e polling de pagamentos anteriores continuam ativos. Reembolsos e mensagens de cancelamento/recusa derivam de `booking_amount_paid` e `payment_id` da reserva: reserva gratuita nao gera credito; reserva antiga paga continua gerando credito pelas regras atuais, mesmo com a flag desligada.
- A wallet segue visivel no perfil e no historico, mas nao participa de nova reserva gratuita. Em `/admin/analytics/overview`, `free_bookings` e `paid_bookings` contam reservas do app pelo snapshot financeiro, sem payment/evento ficticio; reservas manuais nao entram nesses dois subtotais.

## Checkout e webhook

1. `GET /player/checkout/quote` resolve perfil, modalidade, duracao, preco e saldo no servidor.
2. `POST /player/checkout` recebe apenas slot, modalidade, forma e chave de idempotencia.
3. Carteira suficiente: lock do usuario, debito, pagamento pago e reserva pendente na mesma transacao.
4. Provider: hold e pagamento pendente sao criados; saldo misto e reservado logicamente, sem debito ate o Pix ser confirmado.
5. Webhook assinado ou polling autenticado consultam a Order server-side; somente `processed/accredited` converte o hold em reserva.
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

## Mercado Pago Pix/Orders

O adapter usa Pix transparente, `X-Idempotency-Key`, webhook com `x-signature` e consulta server-side em `GET /v1/orders/{id}`. Pix real exige `PAYMENT_PRODUCTION_ENABLED=true`; `PAYMENT_PRODUCTION_TEST_ENABLED=true` ativa a allowlist opcional descrita em [mercado-pago-integration.md](./mercado-pago-integration.md). Referencias:

- [Pix via Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix)
- [Credenciais e separacao teste/producao](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/credentials)
- [Webhooks e assinatura](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/optional-notifications)

Veja o runbook completo em [mercado-pago-integration.md](./mercado-pago-integration.md).

Passos manuais antes da homologacao:

1. Criar e validar a conta/aplicacao Mercado Pago da entidade responsavel.
2. Aprovar produto, taxas, fluxo Pix/cartao, recebedor e tratamento contabil dos creditos.
3. Obter credenciais de teste (`Access Token`; `Public Key` somente se a solucao escolhida exigir frontend).
4. Cadastrar URL HTTPS de webhook e obter o segredo de assinatura.
5. Configurar Render com `PAYMENT_PROVIDER=mercado_pago`, `PAYMENT_ENV=test` e `PAYMENT_SANDBOX_ENABLED=true`.
6. Executar homologacao completa com credenciais de teste e reconciliacao sem divergencias.
7. Liberar Pix real com `PAYMENT_PRODUCTION_ENABLED=true` somente apos revisao juridica e aprovacao operacional.

Nao criar `NEXT_PUBLIC_PAYMENT_SECRET`. Access Token e segredo de webhook pertencem somente ao backend.

## Termos e privacidade

Antes do go-live financeiro, textos revisados devem explicar que os R$ 5 sao antecipacao abatida do campo, em quais cancelamentos o credito interno e gerado, como o credito pode ser usado e por quanto tempo registros financeiros sao mantidos. Este documento descreve comportamento tecnico e nao substitui revisao juridica.
