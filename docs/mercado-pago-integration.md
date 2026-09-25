# Mercado Pago Checkout Pro/Orders

## Escopo seguro

Esta integracao usa a Orders API real do Mercado Pago apenas em test mode. O PlayArena nunca recebe numero de cartao, CVV ou credencial bruta. O comprador e redirecionado ao checkout hospedado e a reserva so e criada depois de webhook assinado, consulta server-side da Order e validacao de valor, moeda e `external_reference`.

Producao esta bloqueada por configuracao: `PAYMENT_ENV` deve ser `test`, `PAYMENT_SANDBOX_ENABLED` deve ser `true`, somente IDs de Order de teste `ORDTST...` podem gerar redirect e webhooks com `live_mode` diferente de `false` sao rejeitados. Como o formato do Access Token nao prova localmente se a credencial veio da aba de teste, o operador deve copiar exclusivamente a credencial indicada abaixo.

## Endpoints oficiais

- Criar Order: `POST https://api.mercadopago.com/v1/orders`.
- Consultar Order: `GET https://api.mercadopago.com/v1/orders/{id}`.
- Header privado: `Authorization: Bearer <MERCADO_PAGO_ACCESS_TOKEN>`.
- Idempotencia: `X-Idempotency-Key` recebe a chave estavel do checkout PlayArena.
- Referencia: `external_reference` recebe somente o UUID interno de `payments.id`.
- Item: `Reserva PlayArena`, quantidade 1 e valor calculado pelo backend.

Referencias oficiais: [criar Order](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order), [obter Order](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro/get-order/get), [URLs de retorno](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/web-integration/configure-back-urls) e [notificacoes](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/notifications).

## Credenciais de teste

1. Acesse Mercado Pago Developers.
2. Abra `Suas integracoes` e selecione a aplicacao.
3. Entre em `Dados da integracao` > `Credenciais de teste`.
4. Copie o Access Token de teste para o secret `MERCADO_PAGO_ACCESS_TOKEN` no Render.
5. Em `Webhooks` > `Configurar notificacoes`, revele a chave secreta e salve-a como `MERCADO_PAGO_WEBHOOK_SECRET`.

Nunca coloque esses valores em `.env.example`, Vercel, `NEXT_PUBLIC_*`, logs, screenshots ou commits.

## Configuracao Render de homologacao

```env
BOOKING_ADVANCE_AMOUNT=5.00
PAYMENT_HOLD_MINUTES=10
PAYMENT_PROVIDER=mercado_pago
PAYMENT_ENV=test
PAYMENT_SANDBOX_ENABLED=true
MERCADO_PAGO_ACCESS_TOKEN=<access-token-de-teste>
MERCADO_PAGO_WEBHOOK_SECRET=<secret-do-webhook-de-teste>
MERCADO_PAGO_RETURN_URL=https://useplayarena.com.br/pagamento/retorno
MERCADO_PAGO_HTTP_TIMEOUT_SECONDS=5
FRONTEND_URL=https://useplayarena.com.br
```

Semantica das flags:

- `PAYMENT_PROVIDER` escolhe um unico adapter: `disabled`, `sandbox` ou `mercado_pago`.
- `PAYMENT_SANDBOX_ENABLED=true` e a confirmacao explicita de que providers nao produtivos podem executar.
- `PAYMENT_ENV=test` e obrigatorio para qualquer provider nesta release; `production` impede o startup.
- `PAYMENT_WEBHOOK_SECRET` pertence somente ao sandbox interno.
- `MERCADO_PAGO_WEBHOOK_SECRET` pertence somente ao mecanismo oficial do Mercado Pago.

## Webhook

Cadastre no painel do Mercado Pago em `Webhooks` > `Configurar notificacoes`, no campo indicado atualmente pela documentacao como `Modo produtivo`, e selecione o evento `Order (Mercado Pago)`:

```text
https://playarena-iwp9.onrender.com/payments/webhooks/mercado-pago
```

O destino e o backend Render, nunca o frontend Vercel. CORS nao participa do webhook server-to-server. A rota valida `x-signature`, `x-request-id`, query params `data.id` e `type=order` usando o manifesto oficial `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` e HMAC-SHA256 em tempo constante.

Esse cadastro no painel nao habilita pagamentos produtivos no PlayArena. As credenciais, o comprador e as Orders continuam sendo de teste, e o backend aceita somente `live_mode=false` e IDs `ORDTST...`. O simulador generico do painel pode montar um exemplo `live_mode=true`; nesse caso, o `401` e o bloqueio esperado desta release. Valide o fluxo completo com uma Order de teste real e use a reconciliacao admin se a notificacao demorar.

Depois da assinatura, o backend ignora qualquer alegacao de status do body e executa `GET /v1/orders/{id}`. Somente `processed/accredited`, com Order ID, `external_reference`, `BRL` e valor esperados, pode converter o hold em reserva.

## Retorno e estados

As URLs `success_url`, `failure_url` e `pending_url` apontam para `/pagamento/retorno` com o UUID interno do payment. Query params do Mercado Pago nao aprovam o pagamento. A tela consulta `GET /player/payments/{id}` usando o usuario autenticado e faz polling limitado.

- `pending`: continua processando, sem reserva.
- `paid`: reserva `pending` criada atomicamente.
- `failed` ou `cancelled`: hold liberado e nenhuma reserva criada.
- pagamento aprovado apos hold expirado ou com slot perdido: payment fica pago e R$ 5 sao creditados uma vez no Saldo PlayArena.

Recusa ou cancelamento de reserva continua gerando credito interno. Nao existe refund bancario automatico nesta versao.

## Contas e pagamentos de teste

Use sempre duas contas de teste do mesmo pais: vendedor de teste para a aplicacao e comprador de teste para abrir o `checkout_url`. Obtenha usuario, senha, e-mail e codigo em `Suas integracoes` > aplicacao > `Contas de teste`. Use janela anonima para evitar sessao de uma conta real.

Nao hardcode cartoes no repositorio. Consulte os dados vigentes em [cartoes e compras de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/integration-test/test-purchases) no momento da homologacao.

## Reconciliacao

`POST /admin/payments/{payment_id}/reconcile` exige role `admin`. A acao consulta a Order, nao recebe status do operador e reaplica o mesmo processador idempotente do webhook. O painel mostra Order mascarada, pendencias vencidas e pagamentos pagos sem reserva ou credito.

## Checklist de homologacao

1. Aplicar as migrations financeiras antes do deploy da API.
2. Configurar apenas credenciais de teste no Render.
3. Cadastrar o webhook HTTPS e simular uma notificacao.
4. Criar checkout com comprador de teste e conferir redirect hospedado.
5. Validar cenarios aprovado, pendente, recusado, abandono e webhook duplicado.
6. Confirmar que owner so recebe a reserva depois de `paid`.
7. Confirmar total, pago no PlayArena e valor a receber na arena.
8. Confirmar saldo idempotente quando um pagamento aprovado perde o slot.
9. Abrir `/admin/payments` e zerar divergencias de reconciliacao.
10. Manter `PAYMENT_ENV=test`; nao usar credencial produtiva.

## Troubleshooting

- `401` no webhook: confira secret, `data.id`, `x-request-id`, topico Order e ambiente da aplicacao.
- `503` no webhook: Mercado Pago estava indisponivel; a resposta induz retry sem alterar o payment.
- checkout sem URL: confira Access Token de teste, HTTPS da return URL e logs por `payment_id`/Order ID.
- payment pendente apos retorno: aguarde webhook, confira a configuracao e use a reconciliacao admin.
- `production_payment_blocked`: uma Order/notificacao produtiva foi detectada; interrompa a homologacao e revise a credencial.

Nenhum teste automatizado chama a internet. A prova integrada real deve ser feita manualmente com a aplicacao e as contas de teste do Mercado Pago.
