---
name: CC Relay Pricing
description: Requested trial, subscription prices, lifetime offer, and landing-page integration boundaries.
type: decision
tags:
  - relay
  - pricing
  - marketing
---

# CC Relay Pricing

The September 5, 2026 pricing request defines a 30-day free trial, monthly access at $7.99,
yearly access at $79.99, and lifetime access priced at two years of licenses with automatic
updates forever. USD is an explicit implementation assumption because no currency was supplied.

Lifetime uses two annual licenses: $79.99 × 2 = **$159.98 once**. It never expires after two years.
Monthly and yearly plans include access and updates while subscribed. The landing-page copy
presents the same core Relay features in every paid plan and recommends Yearly without claiming
it is the most popular plan.

The reusable copy lives in [[../docs/pricing]]. The existing
[[../docs/relay-landing-page-prompt|landing-page build command]] now includes a Pricing navigation
anchor, three plan cards, shared trial banner, lifetime explanation, provider-cost disclosure,
pricing FAQ, and pricing-specific verification. See [[landing-page-build-prompt]].

> [!note]
> This is pricing content and a build-brief update. There is no marketing-site implementation,
> checkout, trial activation, or paid entitlement system in the current repository. The brief
> requires a visible Planned pricing disclosure and the working release download until those
> flows exist. A release download cannot claim to activate a trial.

Card requirements, trial conversion, cancellation, refunds, taxes, seats, device limits, and
support guarantees are unspecified. Do not invent them in future copy. Provider subscriptions
and model usage remain separate. Automatic updates follow the supported installer behavior in
[[desktop-updates]]; Windows portable installs remain manual downloads.

The existing PolyForm source license is unchanged. Pricing is not itself a commercial source-code
license grant; see [[licensing]]. No environment variables, runtime behavior, release versions,
or changelog entries changed for this task.

## Verification

- `npm test -- --test-reporter=dot` passed.
- `npm run release:check` passed with consistent v0.2.38 metadata.
- `git diff --check` passed.
- The extra verification pass checked integer-cent lifetime arithmetic, matching amounts across
  all five pricing-related documents, local Markdown and wiki links, a unique wiki index entry,
  trailing whitespace, and forbidden punctuation. Content review also replaced empty table labels
  with explicit Plan details and Best fit labels.
- No website or billing flow was created, so browser or payment-flow verification does not apply.
  All verification commands exited; no development server or watcher was started.

#relay #pricing #marketing
