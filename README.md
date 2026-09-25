# booking-com-channel-manager

This repository collects research notes and a small Node.js probe script from an investigation into how a Booking.com property page loads its day-by-day availability calendar, done as groundwork for a villa channel manager. Booking.com's own pages fetch the calendar from a public GraphQL `AvailabilityCalendar` call keyed by the country code and page name in the property URL, and the script repeats that call to print each day's availability, "from" price and minimum length of stay. The notes, verified live on 2026-07-09 against villas in Ras Al Khaimah, also cover the AWS WAF anti-bot behaviour, the per-room and per-rate data model, and the two official ways to push availability back to Booking.com: extranet iCal import and the contract-gated Connectivity API. It is meant for developers and property owners weighing how to sync a villa's calendar. It is research material only, not a working channel manager.

> Research only. The GraphQL endpoint is undocumented and using it goes against Booking.com's Terms of Service. For production use, the notes point to the official Demand API (reading) and Connectivity API (writing).

## Tech stack

Node.js 18+ (built-in `fetch`, no dependencies) · Booking.com GraphQL (`/dml/graphql`) · Markdown notes

## Contents

- [`docs/booking-availability-pattern.md`](docs/booking-availability-pattern.md), the main document, with findings verified live on 2026-07-09:
  - the `AvailabilityCalendar` request and response shape. A property is keyed by `countryCode` + `pagename` from its URL, with a window of up to 61 days
  - anti-bot behaviour: AWS WAF challenge on HTML pages, while the calendar call went through
  - the per-room / per-rate model (ARI) and what the public GraphQL schema exposes (`propertyDetails`, which needs a browser session)
  - writing availability: iCal import (polling, availability only) vs. Connectivity API (`OTA_HotelAvailNotif`, which requires a contract and certification)
- [`scripts/availability-calendar.js`](scripts/availability-calendar.js), a dependency-free probe that prints each day's availability, "from" price and minimum length of stay

## Usage

Requires Node.js 18 or newer (uses the built-in `fetch`).

```bash
node scripts/availability-calendar.js <countryCode> <pagename> [startDate] [amountOfDays]

# example
node scripts/availability-calendar.js ae pool-villa-saraya
node scripts/availability-calendar.js ae pool-villa-saraya 2026-08-01 61
```

`countryCode` and `pagename` are the two path segments of a property URL: `https://www.booking.com/hotel/<countryCode>/<pagename>.html`. The script exits with code 2 if no data comes back (for example, when a WAF challenge blocks the request).

The module also exports `fetchAvailabilityCalendar` and `AVAILABILITY_CALENDAR_QUERY` for use from other code.
