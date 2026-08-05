# Real-time write to Booking.com via extranet automation — design exploration

**Status:** design exploration only. No implementation. This document weighs the
"Zatanna-style" extranet-automation approach for pushing availability/blocks to
Booking.com in near real-time, for a **single villa the owner controls, sold only
on Booking.com**, whose owner does not want to pay a third-party channel manager.

**Companion docs:** `booking-availability-pattern.md` (read side + iCal vs
Connectivity API write side). This doc goes deeper on the one write path that is
free-ish *and* real-time: driving the owner's own extranet programmatically.

---

## The problem being solved

The owner wants their **own management system ↔ Booking.com** to stay in sync
without the iCal lag:

- **Write** (owner blocks a date in their system → Booking.com shows it closed):
  the official free path is iCal import, but Booking.com controls the pull cadence
  (~1–2h, sometimes longer) and there is **no public API to trigger a refresh**. The
  "Import now" button in the extranet is session-gated, not an endpoint. So iCal
  write latency cannot be reduced from our side.
- **Read** (a guest books on Booking.com → owner's system learns of it): Booking.com
  pushes this in near real-time already via **Pulse app notifications and email** to
  the owner's own account — free and within ToS. Parsing the owner's own booking
  emails, or reading Booking.com's own iCal *export*, both cover this direction.

Since the villa is sold **only on Booking.com**, there is no cross-OTA overbooking
race. The remaining pain is purely the **write latency**: getting a block to appear
on Booking.com quickly. That is what extranet automation targets.

---

## What "extranet automation" (Zatanna-style) actually is

It is **not** an API. It is a bot that logs into the extranet as the owner and
replays the same HTTP requests the extranet web UI fires when a human clicks around.

The Zatanna writeup (https://www.zatanna.ai/blog/booking-com-api-integration-extranet)
describes the shape without publishing endpoints:

1. **Observe** — a human runs the real workflow once in the extranet (e.g. close a
   date) while traffic is captured.
2. **Reconstruct** — the underlying HTTP calls, auth tokens, session handling, and
   multi-step form state are modeled into a repeatable request sequence.
3. **Expose** — that sequence is wrapped behind a single call the owner's system can
   invoke.

They are explicit that it "operates outside Booking.com's sanctioned API ecosystem"
and lean on "TLS fingerprinting, proxy rotation, and detection-sensitive request
behavior" plus "session management, MFA handling, and anti-bot detection
workarounds." In other words: the hard part is not the block request itself — it is
staying logged in and looking human.

---

## Terms-of-service reality — correcting a common assumption

"It's the owner's own credentials on the owner's own property, so it's not a ToS
violation" is **not** how Booking.com's terms are written. The prohibition is on the
**method of access (automation)**, not on **whose account** it is. From the
[Booking.com Terms & Conditions](https://www.booking.com/content/terms.html):

> Booking.com does not allow access, monitoring, copying, scraping/crawling,
> downloading … using any robot, spider, scraper, other automated means, **or
> automated assistants (including AI-powered assistants)** without prior, express
> written permission from Booking.com.

Consequences of enforcement land on the **owner's account** (lock/disable), which is
the exact person this project is meant to help. Extranet accounts are also actively
monitored ("Booking.com keeps a close eye on every visit … and will block anyone —
and any automated system — it suspects of violating these terms").

This does not mean a villa owner automating management of their own listing is doing
something malicious — it is legitimate self-management in spirit. But it is
**against the platform's terms as written**, and the downside risk is real and falls
on the owner. That trade-off is the owner's to make with eyes open; it is not a
technicality that "own credentials" makes disappear.

---

## Technical building blocks required (and why each is hard)

To make this work you must reproduce, unattended, everything a browser+human does:

| Block | What it takes | Difficulty |
|---|---|---|
| **AWS WAF / bot challenge** | The HTML extranet surface is behind the same AWS WAF that blocked us in `booking-availability-pattern.md` (JS proof-of-work minting an `aws-waf-token`). Must be cleared with a real browser engine (headless Chromium), not plain `fetch`. | High — needs a real browser, and headless browsers are fingerprintable. |
| **Login + 2FA every session** | Extranet requires **2FA on every login from an unrecognized device** (6-digit PIN via email/SMS/app). Automation must obtain and submit that code — which means machine access to the owner's 2FA channel. | High — this is the crux, and storing/forwarding 2FA is itself a security liability. |
| **Session persistence** | To avoid re-2FA constantly, persist cookies/device trust and reuse them. Sessions expire and get invalidated on suspicious patterns. | Medium — fragile; a lost session forces a fresh 2FA. |
| **CSRF / multi-step form state** | Write actions carry per-session CSRF tokens and multi-step form state that must be scraped from the preceding page and echoed back correctly. | Medium — breaks whenever the form flow changes. |
| **TLS / header fingerprint** | Requests must match a believable browser fingerprint or get challenged/blocked. | Medium–High — an arms race, not a one-time setup. |
| **UI/endpoint drift** | Booking.com ships silent UI/endpoint changes regularly; any of them can break the scraper with no warning or version notice. | Ongoing — permanent maintenance cost. |

The block request at the center of all this is trivial. **90% of the effort and
100% of the fragility is in the login/session/anti-bot shell around it.** This is
precisely why companies sell it as a service: it needs a team to keep alive.

> Note on scope: this repo will **not** contain code that reverse-engineers specific
> extranet endpoints or implements anti-bot evasion. Documenting the approach and its
> trade-offs is in scope; building a detection-evasion scraper is not.

---

## Risk register

| Risk | Likelihood | Impact | Who it hurts |
|---|---|---|---|
| Owner's extranet account locked/disabled for automated access | Medium over time | Loss of the listing's control channel; can halt bookings | The owner |
| 2FA credential handling compromised (must be machine-accessible) | Low–Medium | Account takeover exposure | The owner |
| Scraper silently breaks on a UI change → blocks not pushed | High over time | Stale availability → missed closes → potential overbooking | The owner + guests |
| Booking.com treats repeated automated writes as abuse → rate-limited | Medium | Sync stops working intermittently | The owner |
| Maintenance burden falls entirely on you (no vendor SLA) | Certain | Ongoing engineering time — the real "cost" the owner was avoiding | You |

The irony worth stating plainly: the owner rejected Beds24/Channex because of a
~US$15/month fee. The self-built extranet-automation path trades that fee for
**permanent maintenance + account-ban risk**, which is usually the more expensive of
the two.

---

## Honest verdict

- **If real-time write is a genuine hard requirement** and the owner accepts the
  account-ban risk in writing, the only *legitimate* real-time path is the
  **Connectivity API** — but onboarding new connectivity partners is currently
  **paused**, and it effectively requires going through a certified provider anyway.
  Extranet automation is the only *free-ish* real-time path, and it buys real-time at
  the cost of ToS-compliance, security, and permanent fragility.
- **If a 1–2h write delay is tolerable** (very often true for a single villa that is
  not selling out by the minute), the **iCal import + email/Pulse read** hybrid in
  `booking-availability-pattern.md` delivers the same outcome for free, legally, and
  with near-zero maintenance. Since this villa sells *only* on Booking.com, the
  overbooking pressure that makes real-time critical is largely absent.

**Recommendation:** default to the iCal hybrid; treat extranet automation as a
last resort the owner explicitly opts into after weighing the account-ban risk. If
they do opt in, the least-bad design is below.

---

## If the owner opts in anyway — least-bad design principles

Not an endorsement; a harm-reduction sketch if the decision is made:

- **Human-in-the-loop 2FA, not stored 2FA.** Prompt the owner to approve/enter the
  PIN on the rare fresh login instead of granting the machine standing access to
  their 2FA channel. Keeps the worst credential-exposure risk off the table.
- **Event-driven, low frequency.** Fire a write only when a block actually changes —
  never poll on a tight loop. Low, human-like request rates are the single biggest
  factor in not getting flagged.
- **Reuse one real browser session** (headless Chromium that has cleared the WAF
  challenge) rather than minting many; persist its cookies; back off hard on any
  challenge response.
- **Fail safe, loudly.** If a write fails or the session dies, alert the owner and
  fall back to the iCal calendar so availability is never silently stale.
- **Keep iCal as the backstop even so.** The automation becomes a "fast lane"; iCal
  remains the correctness floor if the fast lane breaks.

---

## Comparison of the three write paths

| Path | Latency | Legal / ToS | Cost | Maintenance | Ban risk to owner |
|---|---|---|---|---|---|
| iCal import (self-hosted `.ics`) | 1–2h+ (Booking-controlled) | ✅ within ToS | Free | ~None | None |
| Extranet automation (Zatanna-style) | Near real-time | ❌ against ToS | Free + your time | High, permanent | Yes |
| Connectivity API | Real-time | ✅ sanctioned | Contract/cert; onboarding paused | Vendor-side | None |

---

## Sources

- Booking.com Terms & Conditions — automated-access prohibition:
  https://www.booking.com/content/terms.html
- Zatanna, "Booking.com Extranet API Integration: An Alternative to Connectivity
  Certification": https://www.zatanna.ai/blog/booking-com-api-integration-extranet
- Extranet 2FA on every login:
  https://partner.booking.com/en-us/help/account-and-log/settings/logging-bookingcom-extranet
- iCal sync eligibility & behavior:
  https://partner.booking.com/en-us/help/rates-availability/extranet-calendar/syncing-your-bookingcom-calendar-third-party-calendars
- Connectivity API overview (partner-gated): https://developers.booking.com/connectivity/docs
