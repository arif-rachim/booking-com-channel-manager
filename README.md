# booking-com-channel-manager

Research notes and a Node.js probe script for reading a Booking.com property's day-by-day availability. The script calls the public GraphQL `AvailabilityCalendar` endpoint that Booking.com's own property pages use. The notes also compare the official ways to push availability back to Booking.com: iCal sync and the Connectivity API.

> Research only. The GraphQL endpoint is undocumented and using it goes against Booking.com's Terms of Service. For production use, the notes point to the official Demand API (reading) and Connectivity API (writing).

## Contents

- `docs/booking-availability-pattern.md`, findings verified live on 2026-07-09:
  - the `AvailabilityCalendar` request and response shape. A property is keyed by `countryCode` + `pagename` from its URL, with a window of up to 61 days
  - anti-bot behaviour: AWS WAF challenge on HTML pages, while the calendar call went through
  - the per-room / per-rate model (ARI) and what the public GraphQL schema exposes (`propertyDetails`, which needs a browser session)
  - writing availability: iCal import (polling, availability only) vs. Connectivity API (`OTA_HotelAvailNotif`, which requires a contract and certification)
- `scripts/availability-calendar.js`, a dependency-free probe that prints each day's availability, "from" price and minimum length of stay

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
