# PlayArena performance audit, phase 2 (2026-10-02)

Authenticated follow-up: [player and owner traces](performance-authenticated-traces.md). The public measurements below remain the original phase-2 baseline.

## Scope and evidence

Continuation of [phase 1](performance-audit.md). Measurements used the local FastAPI process with `PERFORMANCE_REQUEST_LOGGING=true`, the existing development database via the Supabase session pooler, public read-only requests, and read-only PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` with a 2-second statement timeout. This is a tiny dataset (2 active arenas, 3 courts, about 21 pricing rules), not representative production cardinality. No Pix, booking mutation, RLS change, pool change, or load test was run. Nearest-rank p50/p95 below use 12 HTTP samples or 8 repository samples as stated. Samples include connection/network variance; differences between independent runs are not causal speedups.

Authenticated player/owner access was unavailable for the original public run. The subsequent follow-up linked above used dedicated test accounts; it should not be conflated with the public API samples below.

## Public API measurements

Phase-1 single-run `app` ranges were: `/sports` 180-249 ms, `/arenas` 158-187 ms, detail 196-576 ms, `/availability` 254-406 ms, schedule 301-527 ms. The phase-1 390x844 browser run had 29 requests/630 KB on `/buscar`, 25/323 KB on detail, and 22/317 KB on hours; those counts include JS, images and analytics and are not API-only.

| Route / setup | n | App p50 | App p95 | Response bytes | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| `/sports`, before cache | 12 | 237.3 ms | 1188.4 ms | 222 | `no-store` |
| `/sports`, after cache | 12 | 190.2 ms | 588.4 ms | 222 | `public, max-age=300`; uncached calls still access DB |
| `/arenas?city=Piracicaba`, before | 12 | 324.4 ms | 1305.2 ms | 483 | Public list |
| `/arenas/{id}`, before | 12 | 321.7 ms | 565.9 ms | 978 | Public detail |
| `/arenas/{id}/schedule`, before | 12 | 319.6 ms | 594.6 ms | 2214 | Fresh every visit |
| `/availability`, default before | 12 | 250.4 ms | 349.3 ms | 957 | 3 options in first sample |
| `/availability`, price before | 12 | 213.0 ms | 292.5 ms | 957 | Same options, Python group sort |
| `/availability`, distance before | 12 | 181.7 ms | 557.0 ms | 1053 | Adds Haversine/distance field |
| `/arenas`, distance after | 12 | 186.5 ms | 239.3 ms | small | 2 arenas; geolocation query |
| `/arenas`, price after | 12 | 168.0 ms | 200.5 ms | small | 2 arenas |

The post-change `/sports` app timings vary with remote connections. HTTP caching avoids a subsequent request; it does **not** speed up a cache miss. The single unthrottled production-build browser trace below validates request elimination, not a repeatable reveal/LCP improvement.

| Chrome public flow, same profile | API request | Network transfer | API TTFB (one run) |
| --- | --- | ---: | ---: |
| Cold `/buscar` | `/sports` | 629 B encoded (222 B body) | 584 ms |
| Direct `/nova-reserva` within 5 minutes | `/sports` served from browser cache | 0 B | 13 ms cache access |
| Direct arena detail | `/arenas/{id}` | 1215 B encoded | 340 ms |
| Click detail -> hours | `/schedule` only; no second arena GET | 1745 B encoded | 295 ms |
| Hard navigate directly to hours | `/arenas/{id}` then `/schedule` | 1215 + 1745 B encoded | 263 + 298 ms |

These are Chrome DevTools network events against localhost:3001/8001 after clearing browser cache. The guest discovery has no `/nova-reserva` bottom-nav link, so that leg used a direct navigation within the same browser profile; detail -> hours used the actual page link. Analytics preflight/POSTs occurred separately and were not counted as public data GETs. The phase-1 hours page had an arena GET plus schedule; the new normal linked navigation has schedule alone. No matching pre-change Chrome trace under identical conditions was available, so the 1215 B avoided is a measured post-change request size rather than a paired before/after transfer benchmark.

## SQL and connection analysis

Direct repository instrumentation counted statements and cursor times (8 calls per route); the plans ran under a read-only transaction. A separate 12-connection `NullPool` sample had connection p50 186.4 ms/p95 485.1 ms; a later sample had p50 134.9 ms/p95 661.4 ms. Connection setup and remote round trips dominate the measured path; changing to a persistent pool without Supabase connection budget and staging traffic evidence would be unsafe.

| Repository call | SQL statements | Wall p50/p95 | Cursor p50 | Principal EXPLAIN execution / planning |
| --- | ---: | ---: | ---: | ---: |
| `public_arena_schedule` | 4 fixed | 267.5 / 320.9 ms (first run) | 70.2 ms combined | Slot query 0.690 / 1.057 ms |
| `available` | 1 | 266.5 / 533.8 ms (first run) | 23.0 ms | Query 0.312 / 2.011 ms |
| `public_arenas`, city+sport+distance | 1 | 160.9 / 225.7 ms (later run) | 15.2 ms | Query 0.262 / 0.762 ms |

Schedule statements are (1) active arena existence, (2) courts/sports, (3) opening hours, (4) generated slots with pricing and conflict checks. First plan returned 10 slots: `generate_series` produced 5 rows per 2 courts; opening hours scanned 12-13 filtered rows; pricing rules scanned about 20 rows per candidate; blocked slots scanned 0 rows; reservation overlap used an index-only scan and holds used an index scan. The 3 small preliminary queries executed in 0.036, 0.146 and 0.032 ms in PostgreSQL. A later day's schedule returned 16 slots with wall p50/p95 199.8/425.6 ms; this is different date/data and not an optimization comparison.

Availability's first plan returned 3 candidates: arena scan 2 rows, courts 3, opening hours about 14, pricing scan about 20 rows per candidate, blocked slots 0, reservation overlap index-only and holds index scan. All reported shared blocks were hits and disk reads were zero. A later date returned zero options, demonstrating that these tiny plans cannot predict behavior under a large production dataset. No expensive correlated check was measured at this scale; no index or SQL rewrite is justified.

The city+sport list plan scanned 2 arenas and executed in 0.262 ms. `lower(city)` currently causes a sequential scan, but a two-row table is correctly cheaper to scan than index. A functional city index would be speculative. Haversine and grouping/sorting occur in Python over returned rows, not an extra SQL query. No N+1 was observed: list and availability use one query, detail uses a fixed three, schedule a fixed four regardless of court count. No migration was created.

## Changes implemented

| Priority / effort | Change | Before | After / safety |
| --- | --- | --- | --- |
| P1 / low | Client memory cache keyed `arena:{id}`, TTL 60 seconds, for public detail only | Detail GET then a second detail GET before hours schedule | Normal detail-to-hours navigation uses one detail GET total; about 978 response-body bytes and one remote DB round trip avoided. A deep link or full reload still GETs detail. Failed responses are never cached; concurrent calls coalesce. Schedule stays `cache: 'no-store'` and always re-fetches. |
| P1 / low | `/sports` HTTP cache keyed by the public URL, `public, max-age=300` | Two independent GETs when navigating `/buscar` to `/nova-reserva` | Within 5 minutes, browser can reuse the first 222-byte response and avoid one API/DB call. No API data or catalog logic changed. Other API routes remain `no-store`. |
| P1 / low | Remove image-only PageReady gates from arena detail hero and checkout ticket | Global reveal could wait for image decode/fallback after the actual arena/quote data was ready | Image remains eager/high-priority where configured but no longer blocks the global loader. Data gates and checkout action are unchanged. No reveal-time claim without another browser trace. |

`/sports` is a seeded public catalog with no public sport-edit endpoint. A catalog update propagates after at most 300 seconds of browser freshness; a changed URL/deploy or browser cache clear also invalidates it. The PWA service worker does not cache API responses. The arena cache is tab-local, keyed by ID, expires after 60 seconds, and never stores schedules, reservations, live availability, wallet, or payments. It can briefly show old public name/logo/court configuration; the fresh schedule remains authoritative for availability and price. No stale-while-revalidate was added because this short TTL plus on-demand refresh avoids a second detail GET and background load. If near-immediate public config updates become a requirement, invalidate this cache on owner edits across tabs or shorten the TTL.

## Remaining audits and decisions

- **Remote images (P2 / low):** the sampled Boleiros Storage original is 474x334 WebP, 12,498 B, `Cache-Control: no-cache`. The real Supabase render endpoint returned 200, a 160x113 JPEG of 4,746 B, `max-age=3600`, `x-transformations: height:160,width:160,resizing_type:fit,quality:75`. It is available, but format/transparency behavior across arbitrary uploaded logos was not verified. Do not swap all logo URLs on this sample alone. Current 76-128px thumbnails receive the 474px original; use an opt-in transformed variant with original fallback after testing transparent PNG/WebP logos and upload invalidation.
- **Payloads (P2 / low):** sampled public list/detail/availability/schedule bodies are 483/978/957/2214 B. List exposes only public identity, count, sports, price and optional distance; detail includes courts/hours needed by its page; availability and schedule contain the options/slots rendered. Splitting response schemas now saves little and risks consumers. No schema change.
- **PageReady:** auth/profile, owned arena and screen-critical reservation/wallet/agenda/quote/schedule resources are critical; optional lists or secondary panels should be reviewed with authenticated traces. Images are decorative and no longer gate the two audited screens. The 380 ms minimum loader and 5 s public timeout remain. No timing improvement is asserted without a browser rerun.
- **Auth (P1 / medium, resolved in follow-up):** the authenticated traces confirmed duplicate profile hydration from `getSession()` plus `INITIAL_SESSION`. The redundant provider call was removed; see the follow-up for before/after counts and safety checks. Analytics still uses `getSession()` for event metadata, not profile hydration.
- **Checkout/provider (P1 / medium, partially measured in follow-up):** an authenticated GET quote was measured without creating a payment or Pix. Provider creation/polling remains unmeasured. `Server-Timing: app` remains opt-in; `db_total` and provider spans need separate safe instrumentation.
- **Bundle (P2 / medium):** production-build client-reference manifests list unique raw JS chunks of approximately 306 KB (`/buscar`), 302 KB (`/buscar/resultados`), 309 KB (`/reservar`) and 280 KB (`/dashboard`). These include shared chunks and are *not* compressed browser transfer. The largest shared chunks are 235.5, 223.6 and 151.8 KB raw. No dynamic import/server-component conversion is justified without route-level coverage and hydration profile; these screens use browser state directly.
- **Regions (P2 / high):** the local database pooler hostname suggests `sa-east-1`; sampled Storage requests reached Cloudflare GIG/GRU, which does not establish database location. Render service and Vercel runtime region were not verifiable from local config. No infrastructure move or pool change.
- **Prefetch (P2 / low):** no arena-detail prefetch was added. Existing link navigation plus short handoff cache addresses the measured duplicate without generating speculative API traffic. Schedule and availability must not be prefetched indiscriminately.

## Validation and next measurement

Backend: 269 passed, 1 skipped; `compileall` and `pip check` passed. Frontend: 14 Node tests passed (run in-process because sandboxed Node test subprocesses returned `spawn EPERM`); lint, typecheck and production build passed. The build required an unsandboxed retry for Next's worker spawning and warned that the current Node 20 runtime will lose future Supabase JS support. Existing pytest Starlette deprecation/cache-write warnings remain.

The authenticated follow-up captured direct and client navigation at 390x844, one-run TTFB/reveal/bytes and root commits; it did not establish production RUM, full INP, or provider latency. Next, repeat representative staging plans, connection timing and browser traces before any index, SQL rewrite, NullPool change, or provider span. Verify deployed Vercel/Render/Supabase regions and transparent-logo transforms separately.
