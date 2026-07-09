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

## Per-room / per-rate detail — the model, and what's reachable

The `AvailabilityCalendar` above is a **roll-up**: one `available` bool and one
`avgPriceFormatted` ("from" / cheapest) per day, for the occupancy in your query. It
hides the real structure booking.com uses underneath — **ARI** (Availability, Rates,
Inventory):

```
Property
 └─ Room type        physical inventory unit; has a count ("2 left")
     └─ Rate plan     booking.com calls it a "block": room type + rate + policy
         └─ Calendar   per date: { rooms available, price, restrictions }
```

- A room type can have **many rate plans** (block): e.g. non-refundable w/ breakfast
  vs. flexible free-cancellation vs. member rate — each its own price.
- **Rate** varies by date (season/weekend), **occupancy** (2 vs 4 guests), and
  **length-of-stay**. The `$347→$509` weekend jump seen for `pool-villa-saraya` is the
  *same* room at a date-dependent rate, not a different room.
- **Restrictions**: `minLengthOfStay`/maxLOS, closed-to-arrival (CTA),
  closed-to-departure (CTD), stop-sell. A `$0 / available:false` day = sold out or
  restricted.

### What the public GraphQL exposes (verified live 2026-07-09 by schema-probing)

Introspection is **disabled** (`INTROSPECTION_DISABLED`), but `/dml/graphql` executes
any *valid* GraphQL document and **validation errors fire before the backend**, which
lets you map the schema from error messages. Findings:

| Operation | Keyed by | Session (Irene backend) | Returns |
|---|---|---|---|
| `availabilityCalendar` | `pagenameDetails {countryCode, pagename}` | **not required** — returns data | day roll-up (available + "from" price) |
| `propertyDetails(input: PropertyDetailsQueryInput!)` → `PropertyDetailsQueryOutput` | `hotelId: Int` | **required** — `Internal Server Error` without it | per-room × per-rate detail |
| `searchQueries.search(input: SearchQueryInput!)` → `SearchQueryResult` | `dest_id`/`checkin`/… | **required** — `Internal Server Error` without it | search-result cards (per-property price) |

So the per-room/per-rate grid **does** have a public surface (`propertyDetails`, keyed
by the numeric `hotelId`, not the pagename), but unlike the calendar it is gated behind
the "Irene" service, which needs a **real browser session** (AWS WAF token + cookies +
CSRF). Without a session it returns HTTP 200 with `{"errors":[{"message":"Internal
Server Error"}]}`. Booking also disabled "did you mean" field suggestions, so the room/
rate subfield names cannot be enumerated blind — a live authenticated session is needed
to capture them.

**Practical two-step pattern:** use `availabilityCalendar` (cheap, unauthenticated) to
scan a month for available days + "from" price; then, only for dates of interest, drive
a real browser session to call `propertyDetails` (or parse the property-page room table
/ `b_rooms` Apollo state) for the full room × rate breakdown. Step two is materially
more expensive because of the session/anti-bot requirement.

---

## Writing / syncing availability back TO booking.com

Everything above is about *reading*. Pushing availability (the channel-manager job)
is a different world — two options, very different capabilities:

### Option A — iCal calendar sync (free, extranet, no API)

- Set up **manually in the extranet**: *Calendar → Sync calendars → Import calendar*,
  paste an external `.ics` URL. Booking.com then **pulls** that URL itself.
- **Polling, not push**: booking refreshes imported calendars roughly **every 2–6 hours**
  (sometimes longer). Not real-time. There is a manual **"Refresh"** button per imported
  calendar — that button hits an internal, session-gated `admin.booking.com` endpoint; it
  is **not a public API** and can't be reliably automated.
- **Availability-only, one-directional**: iCal `VEVENT`s carry only blocked/free dates.
  No rates, no inventory counts, no guest data.
- **No API** exists to register an iCal URL or trigger its sync programmatically.

### Option B — Connectivity API (real-time push, contract required)

The official programmatic path. XML "OTA" endpoints on `supply-xml.booking.com`:

| Endpoint | Purpose |
|---|---|
| `POST https://supply-xml.booking.com/hotels/ota/OTA_HotelAvailNotif` | push availability / inventory + restrictions (open/close dates, rooms to sell, minLOS, CTA/CTD) |
| `POST .../hotels/ota/OTA_HotelRateAmountNotif` | push prices/rates |
| Reservations API (`secure-supply-xml.booking.com`) | retrieve incoming reservations (near real-time) |

**Can we just call `OTA_HotelAvailNotif`?** No. The endpoint is a plain HTTPS POST, but
it is fully gated (401/403 without the below), unlike the public `dml/graphql` calendar:

- Must be an onboarded **Connectivity Partner** — and booking.com is currently **pausing
  onboarding of new connectivity providers "until further notice."**
- Needs a **machine account** (created in the Connectivity Portal during onboarding),
  property-level. Auth is either credential-based or token-based (Client ID + Secret →
  token, 1-hour expiry, max 30 tokens/hour); TLS 1.2 required.
- The **property owner must grant a "connection"** (permission) to your machine account
  via the extranet before you can manage their unit.
- Must pass **certification** in a test environment before production access.

Practical takeaway: a single property owner usually can't call `OTA_HotelAvailNotif`
directly — you either go through an already-certified **channel manager**, or use the
free **iCal** pull (Option A) and accept the multi-hour delay. iCal has **no** endpoint;
the Connectivity API has the endpoints but is contract/certification-gated.

Refs: [Connectivity docs](https://developers.booking.com/connectivity/docs) ·
[OTA_HotelAvailNotif](https://developers.booking.com/connectivity/docs/ota-hotelavailnotif) ·
[token auth](https://developers.booking.com/connectivity/docs/token-based-authentication) ·
[partner requirements](https://connectivity.booking.com/s/article/Requirements-for-becoming-a-Booking-com-Connectivity-Partner).

---

## Files

- `scripts/availability-calendar.js` — runnable probe. `node scripts/availability-calendar.js ae pool-villa-saraya`.
