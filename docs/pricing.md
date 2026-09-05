# CC Relay pricing

## Your workspace. Your choice.

Try CC Relay free for 30 days. Then choose monthly, yearly, or lifetime access.

| Plan details | Monthly | Yearly | Lifetime |
| --- | --- | --- | --- |
| Price (USD) | **$7.99 / month** | **$79.99 / year** | **$159.98 once** |
| Billing | Billed monthly | Billed yearly | One payment, no recurring Relay fee |
| Access | While your subscription is active | While your subscription is active | Lifetime access |
| Updates | Automatic updates while subscribed | Automatic updates while subscribed | Automatic updates forever |
| Best fit | Flexible billing | Recommended | Pay once. Keep building. |

**30 days to make it part of your workflow.** Explore CC Relay's projects, task queues, focused sessions, Plan council, Standup, and usage monitoring before choosing a paid plan. Every paid plan includes the same core Relay features.

**Lifetime means lifetime.** Pay the equivalent of two annual licenses once and keep access, with automatic updates forever. The two years determine the price, not an expiry date.

CC Relay uses your configured Codex, Claude Code, or OpenCode setup. Provider subscriptions and model usage are separate from your Relay plan.

## Pricing FAQ

**How long is the trial?** 30 days to explore CC Relay before choosing a paid plan.

**How much is the yearly plan?** $79.99 USD billed once per year. Monthly billing is $7.99 USD per month.

**Does lifetime access expire after two years?** No. The $159.98 USD one-time price is calculated as two annual licenses: $79.99 × 2. Access lasts for life and includes automatic updates forever.

**Are AI subscriptions included?** No. Relay organizes work through your configured provider CLIs. Their subscriptions, usage charges, and limits remain separate.

**How do automatic updates arrive?** Supported desktop installs download available releases in the background and install them when you restart or quit CC Relay. The Windows portable build requires manual downloads. Lifetime access includes future updates without an additional Relay subscription.

## Landing-page integration

Use the headline, introduction, three plans, and FAQ above for the Pricing section of the [landing-page build command](relay-landing-page-prompt.md). Keep all prices visible together, with Yearly labeled **Recommended**. Place the shared 30-day trial above the cards and the provider-cost note directly below them.

Target action labels once their corresponding flows exist: **Start 30-day trial**, **Choose monthly**, **Choose yearly**, and **Get lifetime access**. Link each to its real trial or plan-specific checkout flow, with the correct currency, amount, and billing interval.

> Implementation status: this document defines the requested pricing and reusable launch copy. The repository currently has no trial activation, checkout, or paid-license enforcement. Until those flows exist, label the section **Planned pricing**, use the existing **Download CC Relay** release link, and explain that paid plans and trial activation are not yet available. A download must not claim to activate a trial or purchase a license.

## Product decisions and boundaries

- Currency is assumed to be USD because the request specified amounts without a currency.
- Lifetime is interpreted as two yearly licenses, totaling $159.98, with perpetual access and automatic updates forever. It is not a two-year subscription or 24 monthly payments.
- The trial duration, paid prices, and lifetime update promise come from the product request. Equal core features across paid plans and Yearly as the recommended option are presentation defaults.
- Do not invent card requirements, automatic conversion after the trial, cancellation or refund policies, tax treatment, seat counts, device limits, or support guarantees. Define those before enabling checkout.
- The existing [source license](../LICENSE) remains PolyForm Noncommercial 1.0.0. Paid product pricing does not itself replace that license or grant commercial source-code rights. Commercial license terms must accompany the paid offering before it launches.
