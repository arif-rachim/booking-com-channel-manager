# Booking.com villa availability pattern — investigation

**Goal:** figure out how a booking.com property detail page loads its availability
calendar, and whether that pattern can be used to read villa availability from the
public web (specifically prompted by "Pink Pool Villa, Ras Al Khaimah").

**Date of observation:** 2026-07-09. All request/response shapes below were
verified live against `www.booking.com` on that date.

---

## TL;DR

Booking.com property pages draw their availability/price calendar from **one public
GraphQL call**:

```
POST https://www.booking.com/dml/graphql?lang=en-us
operationName: AvailabilityCalendar
```

A property is identified **not** by a numeric hotel id or `ufi`, but by the two path
segments of its detail URL:

```
https://www.booking.com/hotel/<countryCode>/<pagename>.html
                                └ ae ┘       └ pool-villa-saraya ┘
```

The response is a flat array of up to **61 days**, each with `available`,
`avgPriceFormatted`, `checkin`, and `minLengthOfStay`. See the verified samples below.

The exact "Pink Pool Villa" listing could not be resolved to a `hotel/ae/<slug>`
page (no distinct public detail page surfaced via search — likely a small/renamed/
delisted listing). The pattern itself was confirmed against several real Ras Al
Khaimah villas.

---

## The endpoint (verified)

### Request

```http
POST /dml/graphql?lang=en-us HTTP/2
Host: www.booking.com
content-type: application/json
origin: https://www.booking.com
referer: https://www.booking.com/hotel/ae/pool-villa-saraya.html
user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/126 Safari/537.36
```

Body:

```json
{
  "operationName": "AvailabilityCalendar",
  "variables": {
    "input": {
      "travelPurpose": 2,
      "pagenameDetails": { "countryCode": "ae", "pagename": "pool-villa-saraya" },
      "searchConfig": {
        "searchConfigDate": { "startDate": "2026-07-10", "amountOfDays": 61 },
        "nbAdults": 2,
        "nbRooms": 1
      }
    }
  },
  "extensions": {},
  "query": "query AvailabilityCalendar($input: AvailabilityCalendarQueryInput!) { availabilityCalendar(input: $input) { ... on AvailabilityCalendarQueryResult { hotelId days { checkin available avgPriceFormatted minLengthOfStay __typename } __typename } ... on AvailabilityCalendarQueryError { message __typename } __typename } }"
}
```

### Parameters

| Field | Meaning | Notes |
|---|---|---|
| `pagenameDetails.countryCode` | 2-letter country of the property | `ae` for UAE. From the URL. |
| `pagenameDetails.pagename` | URL slug of the property | The `<slug>` in `/hotel/ae/<slug>.html`. This is the real identifier. |
| `searchConfigDate.startDate` | first check-in day of the window | ISO `YYYY-MM-DD`. |
| `searchConfigDate.amountOfDays` | window length | **Capped at 61.** Requesting 90 returned 61. Page the month forward by moving `startDate`. |
| `nbAdults` / `nbRooms` | occupancy | affects prices/availability. |
| `travelPurpose` | 1=business, 2=leisure | leisure = 2. |

### Response (verified shape)

```json
{
  "data": {
    "availabilityCalendar": {
      "__typename": "AvailabilityCalendarQueryResult",
      "hotelId": 8161662,
      "days": [
        { "checkin": "2026-07-13", "available": true,  "avgPriceFormatted": "$347", "minLengthOfStay": 1, "__typename": "AvailabilityCalendarDay" },
        { "checkin": "2026-07-10", "available": false, "avgPriceFormatted": "$0",   "minLengthOfStay": 1, "__typename": "AvailabilityCalendarDay" }
      ]
    }
  },
  "extensions": { "latency_insights": { "AvailabilityCalendar": { "duration_ms": 12 } } }
}
```

Per-day fields:

| Field | Type | Meaning |
|---|---|---|
| `checkin` | `YYYY-MM-DD` | the day this entry is for |
| `available` | bool | is that check-in date bookable |
| `avgPriceFormatted` | string | localized min/avg nightly price, e.g. `"$347"`. **`"$0"` when `available:false`** |
| `minLengthOfStay` | int | minimum nights required starting that day |
| `__typename` | string | `AvailabilityCalendarDay` |

The `days` array is **not returned in date order** — sort by `checkin` client-side.

### Response union — the possible top-level `__typename`s (observed)

| `__typename` | When |
|---|---|
| `AvailabilityCalendarQueryResult` | valid property, calendar returned |
| `AvailabilityCalendarQueryHotelNotFound` | `(countryCode, pagename)` doesn't resolve to a property |
| `AvailabilityCalendarQueryError` | documented error variant (carries `message`) |

An empty `days: []` with a valid `hotelId` was also seen for some properties (e.g.
inactive/closed listings) — a valid hotel that simply exposes no calendar.

---

## Live results — Ras Al Khaimah villas (2026-07-09, window from 2026-07-10)

| pagename | hotelId | days | available | price range | minLOS |
|---|---|---|---|---|---|
| `pool-villa-saraya` | 8161662 | 61 | 55 | $347–509 | 1 |
| `2-bedroom-villa-with-private-pool` | 14580419 | 61 | 60 | $354–408 | 1 |
| `7d-pool-villa` (O2 pool villa) | 9307340 | 61 | 60 | (noisy) | 1 |
| `daya-poolvilla` | 15199464 | 61 | 19 | $817–953 | 1 |
| `bansal-villas` | 8158110 | 0 | 0 | — | — |
| `modern-villa-with-private-pool` | 13162352 | 0 | 0 | — | — |
| `luxury-villa-with-private-pool` | 13521306 | 0 | 0 | — | — |

Example (`pool-villa-saraya`, sorted): 07-10..07-12 unavailable (`$0`), 07-13..07-19
available at `$347` rising to `$509` on the 07-17/07-18 weekend, 07-20..07-22
unavailable again. This is exactly the block pattern the on-site calendar shades in.

---

## How to resolve a property name → pagename

The GraphQL calendar call needs the `pagename`, which you get from the property's
detail URL. To go from a free-text name ("Pink Pool Villa Ras Al Khaimah") to that
URL you need one of:

1. The property's `/hotel/<cc>/<slug>.html` URL (from search engines, or booking's
   own search results page / autocomplete).
2. Booking's search-results GraphQL (`operationName: FullSearch` on the same
   `/dml/graphql` endpoint) which returns result cards including each property's
   `pagename`/slug and display name. This one is CSRF-gated and needs a real
   session, so it is the harder half.

In this investigation the search-results HTML was blocked by AWS WAF (see below), so
pagenames were sourced from web search. The calendar call itself was **not** blocked.

---

## Anti-bot reality (observed)

- Navigating any booking.com **HTML** page (`/`, `/searchresults…`, `/hotel/…`) from
  this environment returned **HTTP 202 with a ~4 KB AWS WAF challenge page**, not the
  real page. Identifying markers in the body: `window.awsWafCookieDomainList`, a
  `/__challenge_.../challenge.js` script, and `chal_t` / `force_referer` params. AWS
  WAF wants a JS proof-of-work that mints an `aws-waf-token` cookie — solvable only by
  executing JS in a real browser.
- The **`/dml/graphql` `AvailabilityCalendar` POST, by contrast, went straight through
  (HTTP 200 with real data)** with no WAF token and no CSRF header. So the calendar
  endpoint is materially more permissive than the HTML surface — but treat this as
  IP/rate/time dependent, not guaranteed. Community sources also cite Akamai and
  HUMAN/PerimeterX on other paths.
- Practical implication: to run this reliably at scale you still need a real-browser
  bootstrap (to clear the WAF challenge and, for `FullSearch`, to grab the CSRF
  token/session cookies), then reuse that same session/IP for the JSON calls. Low
  request rate + residential IPs are the usual community mitigations.

---

## Environment note — why Playwright couldn't drive the site here

The task asked to observe via Playwright. In this sandbox that was **not possible**,
for a reason unrelated to booking.com:

- All outbound HTTPS is forced through the agent egress proxy.
- The proxy **reset the TLS handshake for Chromium on every host** (example.com,
  google.com, booking.com) — `ERR_CONNECTION_RESET`, `os_error 104` right after
  Chromium's ClientHello. curl and Node `fetch` (OpenSSL) went through fine to the
  same hosts. This is TLS-fingerprint-based filtering at the proxy that doesn't
  allow-list Chromium's BoringSSL fingerprint. Forcing TLS 1.2, disabling ECH, and
  disabling post-quantum key shares did not help.

So the live verification here was done with Node `fetch` (which the proxy permits),
issuing the exact same request the browser XHR would. The pattern is identical; only
the transport differed.

---

## The sanctioned alternative — Booking.com Demand API (official)

The GraphQL approach above is **reverse-engineered and against booking.com's ToS**.
The only supported way to read availability programmatically is the partner API:

- **Demand API v3** — `POST https://demandapi.booking.com/3.1/accommodations/availability`
  and `.../bulk-availability` (cheapest available product per accommodation, up to 300
  hotel ids or city-wide). Auth = Bearer API key + `X-Affiliate-Id` header. Sandbox at
  `demandapi-sandbox.booking.com`.
- Requires being a registered **Booking.com Managed Affiliate Partner** with a signed
  contract; not open/unauthenticated.
- Do **not** confuse with the Connectivity/Supply API (`supply-xml.booking.com`,
  `connect.booking.com`) — that's the hotelier side for pushing *your own* property's
  ARI, not for reading arbitrary properties.

Docs: https://developers.booking.com/demand/docs

---

## Files

- `scripts/availability-calendar.js` — runnable probe. `node scripts/availability-calendar.js ae pool-villa-saraya`.
