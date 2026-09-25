# Fluxo de Reserva

```text
PLAYER
  -> busca disponibilidade
  -> seleciona arena
  -> seleciona quadra
  -> backend cria hold de 10 minutos
  -> paga R$ 5 por provider ou Saldo PlayArena
  -> webhook/provider confirma o pagamento
  -> hold e convertido atomicamente em pre-reserva
  -> reservation.pending
  -> arena confirma
  -> reservation.confirmed
```

## Observacoes

- O app consulta disponibilidade com filtros de cidade, modalidade, data e horario.
- A confirmacao operacional acontece no painel da arena.
- O backend e o banco impedem sobreposicao de reservas ativas para a mesma quadra.
- O owner nao recebe uma solicitacao antes de `payments.status = paid`.
- `court_price_total`, `booking_amount_paid` e `amount_due_at_venue` sao snapshots historicos e nunca dependem do preco atual.
- Cancelamentos validos creditam o adiantamento no ledger da carteira dentro da mesma transacao da reserva.
- Bloqueios operacionais e reservas recorrentes convivem com a agenda da quadra.
