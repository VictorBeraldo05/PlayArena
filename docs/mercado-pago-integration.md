# Mercado Pago Pix transparente (Orders API)

## Escopo e seguranca

O checkout de `/reservar` usa Pix na propria tela, sem redirect. O backend cria uma Order `online` com `processing_mode=automatic` e transacao `payment_method.id=pix`, guarda o ID da Order e o vencimento do Pix e devolve QR Code/copia e cola ao player autenticado. QR e codigo nao sao persistidos no banco. A reserva so e criada apos consulta server-side da Order, com valor, moeda e `external_reference` conferidos. O body do webhook nunca e fonte de status financeiro.

Esta release **aceita apenas teste**: `PAYMENT_ENV=test`, `PAYMENT_SANDBOX_ENABLED=true`, `GET https://api.mercadolibre.com/users/me` antes de criar qualquer Order para conferir `MERCADO_PAGO_TEST_SELLER_ID`, vendedor da Order igual ao mesmo ID e `live_mode=false` no webhook. Orders Pix de teste podem ter ID `ORD01...` e nao trazer `live_mode` na resposta; por isso nao se usa prefixo de Order para inferir ambiente. O token de teste deve ser obtido no painel do Mercado Pago; o prefixo do token tambem nao prova o ambiente. Nunca colocar Access Token ou segredo de webhook no frontend, em `NEXT_PUBLIC_*`, logs ou commits.

Documentacao oficial: [Pix via Orders API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix), [consulta de Order](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/get-order/get), [webhooks](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/optional-notifications).

## Configuracao de teste no Render

```env
BOOKING_ADVANCE_AMOUNT=5.00
PAYMENT_HOLD_MINUTES=31
PAYMENT_PROVIDER=mercado_pago
PAYMENT_ENV=test
PAYMENT_SANDBOX_ENABLED=true
MERCADO_PAGO_ACCESS_TOKEN=<access-token-de-teste>
MERCADO_PAGO_WEBHOOK_SECRET=<segredo-do-webhook-de-teste>
MERCADO_PAGO_TEST_SELLER_ID=<user-id-do-vendedor-de-teste>
MERCADO_PAGO_HTTP_TIMEOUT_SECONDS=5
```

O Pix tem duracao fixa de 30 minutos para manter o payload idempotente. Seu vencimento e salvo em `payments.pix_expires_at`, portanto continua correto mesmo apos refresh ou mudanca de configuracao. O hold efetivo do Mercado Pago e de no minimo 31 minutos, garantindo margem de aproximadamente um minuto. Se `PAYMENT_HOLD_MINUTES` for maior, o hold fica maior, mas o Pix permanece em 30 minutos; o webhook de expiracao libera o hold antecipadamente. `MERCADO_PAGO_RETURN_URL` nao e usada. `PAYMENT_WEBHOOK_SECRET` continua exclusivo do sandbox interno.

No painel do Mercado Pago, em `Suas integracoes` > aplicacao > `Credenciais de teste`, copie o Access Token e o User ID do vendedor de teste para os secrets do Render. Em `Webhooks`, configure notificacoes de **Order** para:

```text
https://playarena-iwp9.onrender.com/payments/webhooks/mercado-pago
```

Obtenha a chave de assinatura no mesmo painel. O destino e o backend, nao o Vercel. O endpoint exige `x-signature`, `x-request-id`, `data.id` e `type=order`; valida HMAC-SHA256 e consulta `GET /v1/orders/{id}`. Notificacoes produtivas sao bloqueadas. Um simulador generico pode enviar `live_mode=true` e receber `401` por design.

## Fluxo e carteira

1. `GET /player/checkout/quote` calcula preco, credito disponivel e parcelas no servidor.
2. `POST /player/checkout` cria o hold e uma Order Pix idempotente para o **valor restante**. A API devolve `instructions.qr_code_base64` quando houver imagem e `instructions.copy_paste` quando o codigo estiver pronto, sem expor o Access Token. Uma Order ainda em `processing` fica pendente com ID salvo e recebe as instrucoes depois por GET.
3. `/reservar` exibe QR e copia e cola, consulta `GET /player/payments/{id}` a cada 2 segundos por tempo limitado e recupera a cobranca ao recarregar. Consulta frequente nao cria Order nova.
4. `processed/accredited` confirmado por GET converte hold em reserva. Para pagamento misto, o saldo e reservado logicamente e debitado apenas na mesma transacao que cria a reserva apos o Pix pago.
5. Pix recusado/expirado libera o hold sem debitar saldo. Uma nova tentativa usa nova chave de idempotencia.
6. Pix pago apos vencimento, conflito de slot ou falta inesperada de saldo gera credito protegido apenas do valor realmente pago ao provider. Nao cria reserva.

Sem saldo: Pix R$ 5,00. Saldo R$ 2,00: Pix R$ 3,00. Saldo R$ 5,00 ou mais: debito integral de R$ 5,00 sem Pix. Com saldo parcial, o player pode optar por nao usa-lo, gerando Pix integral.

## Homologacao

1. Aplicar a migration `202609250002_transparent_pix_wallet_reservations.sql` **antes** do deploy da API.
2. Configurar apenas credenciais e comprador de teste do mesmo pais; nunca usar dinheiro real neste ambiente.
3. Criar Pix sem saldo e confirmar QR/copia e cola sem navegacao externa. Em alguns testes o provider retorna apenas o codigo, sem imagem de QR; o copia e cola deve permanecer utilizavel.
4. Confirmar um pagamento; verificar uma unica reserva, valor pago e valor restante na arena.
5. Testar saldo 0/2/5/20, opcao de nao usar saldo, recusado, expirado e refresh da tela.
6. Repetir webhook e polling; verificar ausencia de reserva, debito e credito duplicados.
7. Testar Pix pago apos expiracao e conflito de slot; verificar credito protegido e ausencia de reserva.
8. Verificar `/admin/payments`, coluna Metodo, Order mascarada e reconciliacao sem divergencias.

`POST /admin/payments/{payment_id}/reconcile` exige role admin e reconsulta a Order; nao aceita status informado pelo operador. A rotina de teste automatizado usa respostas mockadas e **nao** substitui a homologacao real com conta de teste do Mercado Pago.

## Diagnostico

- `401` no webhook: confira segredo, headers, `data.id`, topico Order e `live_mode`.
- `503` no webhook ou consulta: provider indisponivel; tente novamente com a mesma cobranca, sem novo POST.
- Order sem instrucoes: confira token de teste, formato do request e logs pelo `payment_id`/Order ID; nao registre QR/codigo.
- Pagamento pendente: confira webhook e use reconciliacao admin. O player pode reabrir `/reservar` e consultar novamente.
- `production_payment_blocked`: interrompa a homologacao e revise credencial/ambiente.
