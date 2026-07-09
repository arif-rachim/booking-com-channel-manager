#!/usr/bin/env node
/*
 * Booking.com public "AvailabilityCalendar" probe.
 *
 * Fetches the per-day availability + min-price calendar that booking.com's own
 * property detail page renders, by calling the same public GraphQL endpoint the
 * page's browser XHR uses:
 *
 *     POST https://www.booking.com/dml/graphql?lang=en-us
 *     operationName: AvailabilityCalendar
 *
 * A property is identified by (countryCode, pagename) — the two path segments of
 * its detail URL: https://www.booking.com/hotel/<countryCode>/<pagename>.html
 *
 * Usage:
 *   node scripts/availability-calendar.js ae pool-villa-saraya
 *   node scripts/availability-calendar.js ae 7d-pool-villa 2026-08-01 61
 *
 * NOTE: This hits booking.com's public frontend, which is protected by AWS WAF
 * and is subject to their Terms of Service. It is meant for research/observation.
 * For production, licensed use the official Booking.com Demand API instead
 * (https://developers.booking.com/demand/docs).
 */

const AVAILABILITY_CALENDAR_QUERY = `query AvailabilityCalendar($input: AvailabilityCalendarQueryInput!) {
  availabilityCalendar(input: $input) {
    ... on AvailabilityCalendarQueryResult {
      hotelId
      days {
        checkin
        available
        avgPriceFormatted
        minLengthOfStay
        __typename
      }
      __typename
    }
    ... on AvailabilityCalendarQueryError { message __typename }
    __typename
  }
}`;

/**
 * @param {string} countryCode  e.g. "ae"
 * @param {string} pagename     e.g. "pool-villa-saraya"
 * @param {object} [opts]
 * @param {string} [opts.startDate]  ISO date, calendar start (check-in). Default: today.
 * @param {number} [opts.amountOfDays]  Window length. Booking caps this at 61.
 * @param {number} [opts.nbAdults]  Default 2.
 * @param {number} [opts.nbRooms]   Default 1.
 * @param {number} [opts.travelPurpose]  1=business, 2=leisure. Default 2.
 */
async function fetchAvailabilityCalendar(countryCode, pagename, opts = {}) {
  const {
    startDate = new Date().toISOString().slice(0, 10),
    amountOfDays = 61,
    nbAdults = 2,
    nbRooms = 1,
    travelPurpose = 2,
  } = opts;

  const body = {
    operationName: 'AvailabilityCalendar',
    variables: {
      input: {
        travelPurpose,
        pagenameDetails: { countryCode, pagename },
        searchConfig: {
          searchConfigDate: { startDate, amountOfDays },
          nbAdults,
          nbRooms,
        },
      },
    },
    extensions: {},
    query: AVAILABILITY_CALENDAR_QUERY,
  };

  const res = await fetch('https://www.booking.com/dml/graphql?lang=en-us', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://www.booking.com',
      referer: `https://www.booking.com/hotel/${countryCode}/${pagename}.html`,
      // A realistic browser UA reduces the chance of being served an AWS WAF challenge.
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  const node = json?.data?.availabilityCalendar;
  return { httpStatus: res.status, typename: node?.__typename, node, raw: json };
}

async function main() {
  const [countryCode, pagename, startDate, amountOfDays] = process.argv.slice(2);
  if (!countryCode || !pagename) {
    console.error('usage: node availability-calendar.js <countryCode> <pagename> [startDate] [amountOfDays]');
    process.exit(1);
  }
  const opts = {};
  if (startDate) opts.startDate = startDate;
  if (amountOfDays) opts.amountOfDays = Number(amountOfDays);

  const { httpStatus, typename, node } = await fetchAvailabilityCalendar(countryCode, pagename, opts);

  if (typename !== 'AvailabilityCalendarQueryResult') {
    console.log(`HTTP ${httpStatus} -> ${typename || 'no data (WAF challenge / blocked?)'}`);
    process.exit(typename ? 0 : 2);
  }

  const days = [...node.days].sort((a, b) => a.checkin.localeCompare(b.checkin));
  const available = days.filter((d) => d.available);
  console.log(`hotelId=${node.hotelId}  window=${days.length} days  available=${available.length}`);
  for (const d of days) {
    console.log(
      `${d.checkin}  ${d.available ? 'AVAILABLE' : '   --    '}  ` +
        `${(d.avgPriceFormatted || '-').padStart(7)}  minLOS=${d.minLengthOfStay}`,
    );
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { fetchAvailabilityCalendar, AVAILABILITY_CALENDAR_QUERY };
