# Fluxo de Reserva

```text
PLAYER
  -> busca disponibilidade
  -> seleciona arena
  -> seleciona quadra
  -> cria pre-reserva
  -> reservation.pending
  -> arena confirma
  -> reservation.confirmed
```

## Observacoes

- O app consulta disponibilidade com filtros de cidade, modalidade, data e horario.
- A confirmacao operacional acontece no painel da arena.
- O backend e o banco impedem sobreposicao de reservas ativas para a mesma quadra.
- Bloqueios operacionais e reservas recorrentes convivem com a agenda da quadra.
