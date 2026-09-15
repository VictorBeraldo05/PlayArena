# PWA PlayArena

## O que foi implementado

O `arena-web` usa o manifest nativo do App Router em `apps/arena-web/app/manifest.ts`, com escopo `/`, inicio em `/` e modo `standalone`. Os icones ficam em `apps/arena-web/public/icons/` e o service worker em `apps/arena-web/public/sw.js`.

O registro acontece somente em `https` ou em `localhost`. Ele nao interfere em autenticacao, reserva ou navegacao: o service worker armazena apenas assets estaticos locais, como bundles do Next, imagens e icones. Rotas HTML, API, Supabase e qualquer resposta autenticada nao sao armazenadas em cache.

## Como instalar

### Android e desktop com Chrome/Edge

1. Abra o PlayArena em HTTPS.
2. Entre em **Perfil**.
3. Toque ou clique em **Instalar app** e confirme o prompt do navegador.

O navegador tambem pode oferecer a instalacao no menu de endereco.

### iPhone e iPad

1. Abra o PlayArena no Safari.
2. Em **Perfil**, toque em **Instalar app**.
3. Toque em **Compartilhar**, escolha **Adicionar a Tela de Inicio** e confirme.

O Safari para iOS nao emite o prompt `beforeinstallprompt`, por isso o app mostra essas instrucoes curtas em vez de um prompt nativo.

## Cache, seguranca e atualizacoes

- O cache recebe somente arquivos estaticos do mesmo dominio: `/_next/static/`, `/icons/`, `/img/` e extensoes estaticas.
- Navegacoes, endpoints de API, dados de reservas e respostas com sessao nunca entram no cache.
- A versao do cache esta em `STATIC_CACHE` no `sw.js`. Ao alterar a estrategia de cache, incremente esse valor para remover o cache estatico anterior na proxima ativacao.
- O service worker usa `skipWaiting`, `clients.claim` e `updateViaCache: 'none'` para diminuir a chance de assets antigos persistirem apos deploy.

## Deploy e troubleshooting

- A instalacao exige HTTPS fora de `localhost`.
- Confirme que `/manifest.webmanifest`, `/sw.js` e os PNGs em `/icons/` respondem com sucesso no dominio final.
- Se uma versao antiga persistir durante desenvolvimento, abra as DevTools, remova o service worker e limpe o Cache Storage; em seguida recarregue a pagina.
- O iOS nao oferece controle completo de splash screen para PWAs por manifest. O `appleWebApp` e o `viewport-fit=cover` fornecem a integracao disponivel sem adicionar imagens de splash artificialmente.
