# PlayArena performance audit (2026-10-01)

## Scope and method

This is a local, single-run laboratory baseline, not production RUM. Chrome headless used a fresh profile, 390x844 viewport, 4x CPU slowdown, 100 ms simulated RTT, 500 KB/s download, disabled browser cache and bypassed the service worker. The production Next build on localhost:3001 called a separate local FastAPI instance on 127.0.0.1:8001. Public GETs used the existing development database. No authenticated production session, payment, or mutation was exercised. TTFB below is browser navigation TTFB, not API duration. `reveal` is the time until `.page-ready-content.is-ready`; FCP/LCP can describe the fullscreen loader rather than useful page content.

The initial production build without `NEXT_PUBLIC_API_URL` blocked public API calls through its CSP; its data-page metrics were discarded. The final validation build was rebuilt without the temporary local API override. The local API's database pooler hostname hints at `sa-east-1`; deployed Vercel and Render regions were not verified.

## Browser baseline

| Route | TTFB | FCP | LCP | Reveal | Requests | Transfer | Essential public API |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `/` | 73 ms | 740 ms | 740 ms* | 254 ms | 22 | 459 KB | none |
| `/login` | 10 ms | 580 ms | 580 ms* | 1441 ms | 16 | 308 KB | none for guest |
| `/buscar` | 31 ms | 636 ms | 2036 ms | 1430 ms | 29 | 630 KB | `/sports` + `/arenas` in parallel |
| `/nova-reserva` | 22 ms | 852 ms | 3068 ms | 2412 ms | 23 | 490 KB | `/sports` |
| `/buscar/resultados` | 29 ms | 564 ms | 564 ms* | 1778 ms | 21 | 329 KB | `/availability` |
| `/player/arenas/[id]` | 211 ms | 660 ms | 1944 ms | 1640 ms | 25 | 323 KB | `/arenas/{id}` |
| `/player/arenas/[id]/horarios` | 46 ms | 520 ms | 520 ms* | 1653 ms | 22 | 317 KB | `/arenas/{id}` then `/schedule` |
| `/buscar/disponibilidade` (Beach Tennis) | 17 ms | 636 ms | 636 ms* | 1432 ms | 17 | 315 KB | none without arena context |

`*` LCP element was loader text (`STRONG`) in these samples, so this is not a useful-content LCP. Measured CLS was zero on these production-build samples. No INP was captured because the run had no representative interaction. Analytics generated a CORS preflight plus POST on most routes; this is not a duplicate event and did not gate PageReady. The unthrottled local API had much smaller browser/network overhead than these mobile simulations.

## API baseline and data path

With `PERFORMANCE_REQUEST_LOGGING=true`, `Server-Timing: app;dur=...` showed these ranges across three local GETs after initial connection: `/health` 0.6-2.6 ms; `/sports` 180-249 ms; `/arenas` 158-187 ms; arena detail 196-576 ms; `/availability` 254-406 ms; `/arenas/{id}/schedule` 301-527 ms. Corresponding curl TTFB exceeded app duration by roughly 2 ms on loopback. Thus the observed local delay is predominantly inside the API/DB path, not the loopback network. The first `/sports` against the pre-existing local API process took 1.98 s, versus 0.40-0.45 s for subsequent calls; this is a cold-connection observation, not proof of a Render cold start.

Payloads were small for the sampled data: sports 222 B, arena list 483 B, detail 978 B, availability 957 B, schedule 2214 B. JSON gzip was not returned for these small responses. API responses default to `Cache-Control: no-store`; Next hashed JS is `public, max-age=31536000, immutable`, while direct `/img` assets have `max-age=0`. The service worker caches only same-origin static assets, cleans old `playarena-static-*` versions, and does not cache API, navigation, reservation or payment responses. `next/font/google` self-hosts Space Grotesk at build time; the sampled browser run did not need an external font request.

AuthProvider calls `getSession()` once at provider mount, and `profiles` plus `arena_owners` in parallel during hydration. It also listens for Supabase auth events; a possible `INITIAL_SESSION`/`getSession` double hydration needs an authenticated trace before changing security-sensitive behavior. Same-user `SIGNED_IN`/`TOKEN_REFRESHED` events already avoid tearing down the hydrated owner state. Production `/buscar` made one GET each to `/sports` and `/arenas`; the duplicate pair seen under `next dev` is consistent with React Strict Mode development effects and was not present in the production-build run.

## Request map (code audit)

| Screen | Request order / loading dependency |
| --- | --- |
| `/`, `/login` | Guest UI needs no public API; auth hydration can delay final reveal. |
| `/buscar` | `/sports` and `/arenas?city=...` in parallel; local skeletons now show before both finish. |
| `/nova-reserva` | `/sports`; orbital choices depend on its response. |
| `/buscar/resultados` | `/availability`; geolocation permission may intentionally trigger a second distance-sorted GET. Local result skeletons now show during the first GET. |
| Arena detail | `/arenas/{id}`, including courts/hours; hero image also has a critical-media PageReady gate. |
| Arena hours | `/arenas/{id}` first to choose an active court, then `/arenas/{id}/schedule` for day/court. |
| `/reservar` | Auth/profile, then checkout quote; POST checkout only after user action. Provider creation is inside the POST, so elapsed time combines DB and Mercado Pago. Resume/polling calls are separate. |
| Player reservations / saldo / perfil | `/player/reservations`; `/player/wallet`; profile comes from AuthProvider plus wallet GET. Private data uses no-store. |
| Owner dashboard | Auth/profile/owned arenas, then summary and opening-hours GETs in parallel; both block its PageReady resource. |
| Owner agenda / reservations / arena | Agenda and courts GETs in parallel; reservations GET with no-store and explicit refresh after mutation; arena GET uses the existing two-minute owner-scoped in-memory cache. |

The authenticated rows are source-code findings only; their request counts, bytes, render counts, timings and INP were not measured without representative test accounts. The public browser run did not capture React Profiler commit counts either. No duplicate authenticated request is asserted without a trace.

## Top 10 prioritized findings

| # | Priority / effort | Finding and evidence | Action |
| --- | --- | --- | --- |
| 1 | P1 / low | `ArenaMedia` used original 1254px PNGs (up to 2267 KB) for 64-128px sport thumbnails; `/buscar` transferred a raw 292 KB Society image. | Fixed for local `/img/` sources with Next Image resizing; remote identity fallback stays unchanged. |
| 2 | P1 / medium | Small public API responses took 158-527 ms of application time locally; `NullPool` opens/closes DB connections per request to respect the Supabase pooler limit. | Instrumented; do not change pool sizing without connection-budget and warm/cold measurements. |
| 3 | P1 / high | Schedule took 301-527 ms and executes four SQL statements; the slot query uses `generate_series` plus correlated overlap/pricing checks. | No blind SQL/index change; collect staging `EXPLAIN (ANALYZE, BUFFERS)` and query counts first. |
| 4 | P1 / low | Fullscreen loading hid existing skeletons on discovery/results and waited for first result media. | Removed these gates; one-run reveal comparisons varied, so no numerical speedup is claimed. |
| 5 | P1 / medium | Detail-to-hours navigation fetches `/arenas/{id}` again before schedule; two GETs were observed on the hours page. | Candidate: short public arena-detail cache or pass validated court context; preserve fresh schedule. |
| 6 | P1 / low | `/sports` is public and nearly static yet gets `no-store`; local app duration 180-249 ms and both discovery/orbital routes request it. | Candidate: short public cache with invalidation rules. Not changed without catalog-update contract. |
| 7 | P1 / medium | Auth hydration may run from both `getSession` and `INITIAL_SESSION`; authenticated trace unavailable. | Profile actual auth events before de-duplicating; no security change made. |
| 8 | P2 / low | Four optional schedule-hero paths returned 404 (about 16 KB error body each), while fallback artwork already existed. | Fixed: nonexistent URLs are no longer requested, one avoided 404 per affected visit. |
| 9 | P2 / medium | The sampled public logos are small (6-13 KB), but arbitrary Supabase Storage originals are still used for all logo variants. | Candidate: verify Storage transform support/headers and size distribution before resizing remote images. |
| 10 | P2 / medium | Around 214-222 KB of compressed JS and 26 KB CSS were transferred on sampled public data pages; root client auth/loading code reaches every route. | Profile route chunks and hydration costs before dynamic import or server/client boundary changes. |

Analytics remains fire-and-forget. The preflight+POST is network overhead but is not on the critical loading path. Prefetching arena detail/schedule is not enabled automatically: it could increase API/DB load and serve stale availability. Current SQL has no obvious Python-level N+1; list queries use joins/aggregates and schedule issues a fixed number of statements. Migrations include a GiST overlap exclusion index for active reservations and hold indexes, but no execution plans or production row counts were available to justify another index. The arena city filter uses `lower(city)`, and candidate indexes on city/court/opening-hours/pricing/blocked slots need plan evidence. The database pooler hostname suggests `sa-east-1`, but Vercel/Render deployment regions remain unknown.

## Changes and before/after

- Added opt-in `PERFORMANCE_REQUEST_LOGGING=true`: safe route template, method, status and duration in logs; `Server-Timing` header. Default is off. No URL query, body, token or user ID is logged. Use only in development/staging and turn off after capture.
- Removed four invalid schedule image references and their unnecessary hero-image PageReady gate. The visual fallback already rendered after the old 404; now it renders without requesting the missing file. Society retains its real image.
- Discovery and search results keep visible skeletons while essential data loads; the first result image no longer blocks the whole page. There is no measured reduction in direct-navigation reveal time across single runs, so treat this as a UX behavior change, not a proven timing win.
- Local sport/default fallback images in ArenaMedia now use Next Image. On the same `/buscar` setup, transfer changed from 663 KB to 475 KB (188 KB, about 28% less); JS remained about 220-222 KB. A 128px Society variant returned 200 `image/webp`, 6172 B, versus the 291 KB original PNG. Single-run LCP changed 2712 to 2636 ms but is too noisy to claim an improvement. No DB query or business response was changed.

No SQL query, index, response schema, pool, wallet, booking, pricing, payment, auth permission, PWA private cache, or infrastructure was changed. The only eliminated network requests proven were the optional 404 hero fetches; the larger gain came from lower transferred image bytes, not fewer requests.

## Validation and next measurements

Backend: 269 tests passed, 1 skipped; `compileall` and `pip check` passed. Frontend: 10 Node tests passed; lint, typecheck and final build passed. Browser verification found no 4xx image requests on the sampled public routes after the change. The build warned that Node 20 or earlier will lose support in a future Supabase JS release. Pytest also emitted existing Starlette deprecation and cache-write warnings.

Next, collect authenticated Chrome traces for player and owner accounts (requests, React commits, INP), and repeated p50/p95 mobile runs rather than single samples. Enable `PERFORMANCE_REQUEST_LOGGING` temporarily in staging to separate request/network time; add provider-specific spans before claiming checkout bottlenecks. Run read-only `EXPLAIN (ANALYZE, BUFFERS)` for `/availability` and `/schedule` against a safe representative dataset, inspect `pg_stat_statements` if available, and compare first versus warm Render requests. Verify actual Vercel/Render/Supabase regions and Storage transform/cache policy before cloud or image changes. Do not run checkout/payment load tests against real Pix credentials.
