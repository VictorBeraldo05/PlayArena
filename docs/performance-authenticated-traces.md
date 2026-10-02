# PlayArena authenticated performance traces (2026-10-02)

## Method and limits

Two dedicated test accounts were used in separate incognito Chrome profiles against a local production Next build (localhost:3001) and local FastAPI (127.0.0.1:8001) connected to the existing Supabase project. Viewport: 390x844, device emulation on, no CPU/network throttling. Chrome DevTools Protocol captured method, sanitized path without query string, status, encoded bytes, response-header TTFB, and request order. It did **not** retain request/response headers, bodies, cookies, tokens, user IDs, or login credentials. An injected React DevTools hook counted root commits, and Event Timing observed a few trusted clicks. All route figures are **one run before and one run after**, under warm browser/static caches; they are not p50/p95, RUM, comparable cold-load benchmarks, or a statistically established speedup. Times vary with remote Supabase/database connections.

The first player trace used a sandboxed API and its private GETs returned 401 because that process could not reach Supabase Auth (`ConnectError`). Those private timings were discarded. The valid baseline and follow-up used the same API running with outbound network access and 200 responses. On one owner cold login before the change, Supabase `profiles` transiently returned 401; a reload returned 200 with a Bearer header present. A fresh owner login after the change succeeded, but one sample cannot attribute the transient 401 to the duplicate hydration.

`/perfil` for the owner maps to the implemented `/dashboard/perfil` route. `/reservar` was reached by clicking an available slot, then only `GET /player/checkout/quote` was allowed. No checkout POST, Pix, booking, cancellation, edit, or payment operation was triggered.

## Player

Counts include document, JS, CSS, images, analytics and preflights; transfer is Chrome encoded bytes. API TTFB is one post-change GET sample. Direct means a full URL navigation; linked means a real in-app click.

| Route / entry | Requests before -> after | Bytes before -> after | Reveal before -> after | Post-change essential GET TTFB |
| --- | ---: | ---: | ---: | --- |
| `/buscar`, direct | 49 -> 45 | 93,585 -> 88,835 | 920 -> 911 ms | `/sports` 662 ms, `/arenas` 682 ms |
| `/buscar/resultados`, direct | 33 -> 31 | 28,130 -> 26,203 | 454 -> 593 ms | `/availability` 190 ms |
| Arena detail, direct | 37 -> 35 | 34,157 -> 30,837 | 464 -> 464 ms | `/arenas/{id}` 260 ms |
| Arena hours, linked | 6 -> 6 | 6,168 -> 6,172 | 548 -> 543 ms | `/schedule` 244 ms; no repeated arena GET |
| `/reservar`, linked | 7 -> 7 | 6,085 -> 6,082 | 2,299 -> 759 ms | `/player/checkout/quote` 561 ms |
| `/player/reservas`, direct | 32 -> 30 | 34,343 -> 32,377 | 972 -> 1,134 ms | `/player/reservations` 1,029 ms |
| `/player/saldo`, direct | 33 -> 31 | 28,264 -> 26,309 | 1,117 -> 1,113 ms | `/player/wallet` 891 ms |
| `/player/perfil`, direct | 35 -> 33 | 32,357 -> 30,397 | 501 -> 444 ms | `/player/wallet` 528 ms, background |
| Profile -> saldo, linked | 4 -> 4 | 2,219 -> 2,219 | 980 -> 972 ms | `/player/wallet` 823 ms |
| Saldo -> reservas, linked | 4 -> 4 | 8,121 -> 8,121 | 649 -> 660 ms | `/player/reservations` 544 ms |
| Direct quick return to reservas | 32 -> 30 | 30,867 -> 28,907 | 811 -> 679 ms | `/player/reservations` 484 ms |

The results query yielded no options on the sampled future date but completed with 200; this measures the screen/network path, not a populated results render. The client-linked hours screen fetched schedule only. The balance/profile transitions each made one wallet GET: these are separate visits, not duplicate GETs inside one visit. Returning to reservations makes one fresh GET, consistent with `no-store` and status freshness. Preflight `OPTIONS` events are separate from each private GET and are not duplicate application reads.

## Owner

| Route / entry | Requests before -> after | Bytes before -> after | Reveal before -> after | Post-change essential GET TTFB |
| --- | ---: | ---: | ---: | --- |
| `/dashboard`, direct | 42 -> 38 | 43,949 -> 41,619 | 1,116 -> 803 ms | summary 414 ms + opening hours 419 ms, parallel |
| `/dashboard/agenda`, linked | 6 -> 6 | 5,106 -> 5,106 | 665 -> 753 ms | courts 598 ms + agenda 560 ms, parallel |
| `/dashboard/reservas`, direct | 34 -> 32 | 42,030 -> 39,707 | 776 -> 689 ms | owner reservations 512 ms |
| `/dashboard/arena`, direct | 36 -> 34 | 29,455 -> 27,089 | 684 -> 684 ms | owner arena 519 ms |
| Arena -> dashboard, linked | 4 -> 5 | 3,884 -> 3,884 | 646 -> 763 ms | summary 689 ms + opening hours 692 ms |
| Return to `/dashboard/arena`, browser history | 2 -> 2 | 1,771 -> 1,771 | 23 -> 19 ms | **0 owner arena GETs** |
| `/dashboard/perfil`, direct | 31 -> 29 | 28,768 -> 26,446 | 460 -> 477 ms | no page-specific API GET |
| `/dashboard/minha-arena`, direct | 43 -> 41 | 46,780 -> 44,449 | 465 -> 447 ms | no page-specific API GET in sampled view |

The old `/dashboard/arena` two-minute owner-scoped cache worked: a cold direct visit made one arena GET, and a client-history return made none. The new `/dashboard/minha-arena` uses auth-owned arena data in this sample. The 4 -> 5 total count on one dashboard link is static/auxiliary traffic variance, not an extra data GET.

## Auth and waterfall

Before: the provider started `getSession()` **and** registered `onAuthStateChange()`. The installed Supabase Auth SDK emits `INITIAL_SESSION` after registration. Each path called `hydrateAuth`, starting `GET /rest/v1/profiles` and `GET /rest/v1/arena_owners` in parallel. In a typical full navigation, this produced **2 profile + 2 owner-link GETs**. The first player `/buscar` sample showed 4 of each amid extra auth events, which is an outlier, not the typical count. There was no `/me` request; the API verifies private bearer tokens through Supabase `/auth/v1/user` server-side, which is not a separate browser request. Analytics also calls `getSession()` for event metadata but did not generate a profile GET on linked navigation.

After: removed only the provider's parallel `getSession()` call. The listener's `INITIAL_SESSION` now performs the one initial hydration; `SIGNED_IN`, `TOKEN_REFRESHED`, account changes and sign-out still use the same listener. Full direct navigations produced **1 profile + 1 owner-link GET**, both 200, for player and owner. Client navigation produced **0** profile/owner-link GETs. A fresh owner login after the change made one of each and reached `/dashboard`; an owner sign-out returned to `/login`, and direct access to `/dashboard` was rejected. Refresh-token rotation and user switching were not exercised, so their runtime behavior is not claimed as measured.

Representative waterfalls:

```text
Fresh owner login: POST /auth/v1/token -> profiles + arena_owners -> dashboard-summary + opening-hours -> PageReady
Direct player reservas: INITIAL_SESSION -> profiles + arena_owners -> /player/reservations -> PageReady
Linked player perfil -> saldo: no auth hydration -> /player/wallet -> PageReady
Linked owner dashboard -> agenda: no auth hydration -> courts + agenda -> PageReady
Linked owner dashboard -> arena (warm): no auth hydration -> owner arena memory cache -> reveal; no arena GET
```

`Server-Timing: app` is opt-in on the local API. A private GET includes server-side token validation through Supabase Auth plus DB work, so its TTFB cannot be attributed solely to SQL. No change to verifier, JWT handling, authorization, wallet, holds, payment, or reservation rules was made.

## PageReady, commits and interaction samples

Critical gates observed/source-verified: auth/profile/owner access on private screens; reservations data for player/owner reservations; wallet on `/player/saldo`; arena plus fresh schedule on arena hours; quote on `/reservar`; summary **and** opening-hours on owner dashboard; agenda **and** courts on owner agenda; arena data on the old owner arena editor. `/player/perfil` fetches wallet as secondary data without blocking PageReady. `/buscar` and results can reveal a skeleton before public results finish. Arena hero/checkout ticket images do not gate PageReady after phase 2. The owner dashboard opening-hours request may be a background candidate, but it completed near summary in this sample, so no measurable reveal gain was established and no change was made.

The injected React DevTools hook counted about 9-12 root commits per sampled direct load. Linked transitions added roughly 8-10 commits, except a warm arena return (about 3). These are root commits, **not component render counts**, and the hook itself may affect timing. Chrome Event Timing on representative trusted navigation clicks reported about 24-56 ms for player and 24-40 ms for owner. These are individual event durations, **not** a production INP percentile or complete user-journey INP.

## Decision and follow-up

- **Implemented, P1 / low risk:** remove duplicate initial auth hydration. The measured effect is one fewer profile GET and one fewer owner-link GET per typical full navigation, often plus avoided CORS preflights; private routes remained 200. Bytes fell about 1.9-3.3 KB on comparable direct screens, but reveal times varied and no millisecond speedup is claimed.
- **Already working:** short public arena handoff cache, 5-minute sports HTTP cache, and two-minute owner arena cache. The owner warm return measured 0 arena GETs and 19 ms reveal. No private response was cached in the PWA.
- **Recommended, not implemented:** consider local JWT/JWKS verification with rotation/fail-closed controls only after a separate security review. The current server makes a remote Supabase Auth call for each private API GET, contributing to 400-1000+ ms sampled TTFB. This is an auth-security architecture change, not a low-risk performance tweak.
- **Recommended, not implemented:** investigate an explicitly invalidated, short-lived private reservations/wallet handoff only if freshness and account isolation can be proven. The observed one GET per visit is expected; blindly caching balance/status is unsafe.
- **Recommended, not implemented:** repeated staging/RUM captures with fixed network/CPU profiles for p50/p95 reveal and real INP. Keep the dashboard opening-hours gate and checkout/provider spans unchanged until a representative latency decomposition shows a safe gain.
- **Monitor:** one transient 401 from the owner's profile fetch on the first pre-change cold login; a subsequent authorized reload was 200, and a post-change fresh login was 200. This does not establish cause or a persistent defect.

## Security and validation

Credentials were entered only into an interactive no-echo prompt, held in process memory for browser form input, and never embedded in code, `.env`, tests, command output, network logs, or this report. The temporary collectors lived only under Git-ignored `.next`; Chrome used isolated incognito profiles. No JWT, refresh token, cookie, Authorization value, request body, or raw sensitive query string was recorded. All temporary collectors and Chrome profiles were removed after the trace. Git status/diff was checked for secret-bearing artifacts. No real payment or Pix was initiated.

Validation: browser traces on both test roles, fresh owner login and sign-out passed. Final lint/typecheck/build and relevant tests are recorded in the task close-out.
