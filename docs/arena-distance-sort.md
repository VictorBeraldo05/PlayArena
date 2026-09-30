# Ordenacao por distancia das arenas

## Dados e API

`public.arenas` ja tinha `latitude` e `longitude` (`numeric(9,6)`). A migration
`202609300001_arena_coordinates_constraints.sql` adiciona limites e exige que os
dois valores sejam nulos ou preenchidos juntos. Antes de aplica-la, confira se
ha registros legados invalidos:

```sql
select id, name, latitude, longitude from public.arenas
where (latitude is null) <> (longitude is null)
   or latitude not between -90 and 90
   or longitude not between -180 and 180;
```

`GET /availability` e `GET /arenas` aceitam `latitude`, `longitude` e
`sort=distance` ou `sort=price`. O par de coordenadas e opcional para buscas
normais, mas obrigatorio para `sort=distance`. `GET /arenas` tambem aceita
`sport`, alem do filtro de `city` existente. A resposta so inclui `distance_km`
quando a distancia e conhecida; nunca inclui as coordenadas da arena. O
calculo Haversine e feito no backend (linha reta, nao trajeto viario). Arenas
sem coordenadas continuam visiveis e ficam por ultimo apenas em
`sort=distance`. `sort=price` usa o menor preco do slot disponivel em cada
arena na tela de resultados. A ordenacao padrao nao muda.

No navegador, a posicao e lida uma unica vez por acao explicita, arredondada
para tres casas decimais antes do request e mantida so em memoria durante a
pagina. Nao vai para analytics, perfil ou banco. A cidade escolhida continua
sendo filtrada normalmente. Nao ha `watchPosition` nem prompt no carregamento.
Guest e player usam o mesmo fluxo. Em producao, HTTPS e necessario.
Como `GET` inclui latitude/longitude arredondadas na URL, configure redacao
desses parametros em logs de proxy/CDN se sua politica de privacidade abrange
logs de infraestrutura.

## Coordenadas da arena

O owner pode usar **Usar minha posicao na arena** em **Minha arena**, desde
que esteja fisicamente no local; a posicao so e salva ao enviar o formulario.
Essa acao pede alta precisao e rejeita leituras com erro estimado acima de
150 metros. A busca do player continua usando baixa precisao.
Se o endereco/cidade/estado mudar sem uma posicao capturada, o backend tenta
geocodificar uma vez, apenas se `ARENA_GEOCODING_URL` estiver configurada. Se
nao houver provider, resultado confiavel ou rede, salva o endereco e limpa as
coordenadas antigas para evitar distancias falsas. Buscas nunca geocodificam.

Para geocodificacao automatica, configure no backend um endpoint HTTPS de
busca **Nominatim-compativel** cujo contrato permita persistir coordenadas
compartilhadas entre usuarios:

```text
ARENA_GEOCODING_URL=https://<seu-provider-licenciado>/search
ARENA_GEOCODING_USER_AGENT=PlayArena/1.0 (+https://useplayarena.com.br)
```

Nao coloque chave secreta no frontend. Google Geocoding nao foi ativado: os
[termos atuais de cache do Google](https://cloud.google.com/maps-platform/terms/maps-service-terms)
restringem o armazenamento compartilhado e duradouro de latitude/longitude.
Se optar pelo Nominatim publico para um piloto pequeno, confirme a
[politica oficial](https://operations.osmfoundation.org/policies/nominatim/):
limite agregado de 1 request/segundo, identificacao propria, atribuicao OSM e
restricoes de uso em lote. Para producao, prefira provider privado/licenciado
ou instancia propria e exiba a atribuicao exigida pelo provider escolhido.

## Backfill manual

Nao ha job automatico nem chamada em lote a mapas. Para cada arena existente,
obtenha coordenadas confirmadas pelo owner no local ou por fonte com direito
de persistencia. Como alternativa administrativa, aplique manualmente, uma
arena por vez, apos revisar o ID e os valores:

```sql
begin;
update public.arenas
set latitude = -22.720000, longitude = -47.640000
where id = '<UUID_DA_ARENA>' and latitude is null and longitude is null
returning id, name, latitude, longitude;
commit;
```

Os numeros acima sao **exemplo**, nao coordenadas de nenhuma arena real. Se
`returning` vier vazio, nao force a atualizacao sem investigar. Para dezenas
ou centenas de arenas, Haversine em Python continua simples e suficiente;
considere PostGIS apenas se volume, consultas por raio ou desempenho real
justificarem.
