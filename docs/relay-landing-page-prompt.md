# CC Relay landing-page build command

Build a complete, polished, responsive landing page for **CC Relay**, positioning it as **the IDE of the future**: an AI development workspace where developers can keep several projects moving at once, give every task its own focused session, and always know what is running, what finished, and what needs review.

Act as a senior creative developer and product designer. Complete the page, interactions, animation choreography, responsive layouts, and verification. Make reasonable decisions and proceed without questions. The result should feel like a carefully art-directed product launch, with the spatial storytelling and scroll-controlled assembly of a premium Apple Mac product page, expressed through CC Relay's own product and identity.

## 1. Product story and accurate claims

The audience is developers, independent builders, and engineers who work across multiple repositories with AI coding agents. They already understand terminals. Show them how Relay gives that work structure, continuity, and visibility.

Make these benefits immediately understandable:

- **Several projects, one workspace.** Run work across repositories simultaneously. Each project has its own queue, history, and provider concurrency settings.
- **Every task has a place.** Requests become visible task cards with a project, provider, status, activity, result, and conversation history.
- **Fresh context for fresh work.** New direct Codex and Claude tasks get their own fresh conversation and automatically managed terminal. Unrelated conversation history is not automatically carried into every new task.
- **Return to the work.** Supported Codex and Claude tasks preserve their conversation identity. Continue session can reopen a terminal and resume the same conversation under the same task, subject to provider availability and capacity.
- **Terminals manage themselves.** By default, Relay opens its task terminals when capacity is available and closes the exact terminals it owns at task outcomes. Optional Terminal session mode keeps direct sessions open between turns.
- **Completion becomes review.** Unread completed tasks appear in Ready for review. Project badges, configurable sounds, and optional spoken announcements draw attention to completed work. Users can open results, inspect available changes, and acknowledge reviewed work.
- **A quick view across projects.** The global task monitor shows running work and open terminal sessions across projects. Queue and History remain scoped to the selected project.
- **Plan council.** One of Codex or Claude authors a plan, the other challenges it, and the original author revises it. The user can choose either provider first. The reviewed plan has a separate execution handoff.
- **Standup from recorded work.** Generate a project-scoped changelog from successful execution attempts in a selected one-day or two-day range. Use Added, Changed, Fixed, and Security sections when relevant, with dated follow-up questions.
- **Usage stays visible.** Show provider-reported input and output tokens, daily consumption, output-token speed, and supported Claude and Codex subscription-window percentages with reset countdowns.

Use **CC Relay** as the full brand name. Relay is acceptable in explanatory prose. The phrase "IDE of the future" is the positioning; explain that the actual product orchestrates existing coding agents and terminals. Depict the task-based workspace, without inventing an editor, debugger, language server, cloud development environment, or collaboration suite.

Keep these distinctions accurate throughout the copy and demos:

- Fresh sessions reduce unrelated context carryover. They do not eliminate system instructions, repository context, relevant task context, or provider token costs. Avoid absolute savings claims and invented percentages.
- Continuing a saved conversation restores its relevant history. A fresh native terminal window does not necessarily mean a fresh conversation when the user explicitly continues a task.
- OpenCode is supported for direct headless execution. The fresh native terminal and interactive continuation story specifically concerns Codex and Claude. Plan council and Standup use Codex and Claude.
- Ready for review is an unread completion state. It does not certify code quality or mean that a human already approved the result. Opening a completed task acknowledges that completion in the real product.
- Closing an owned task terminal preserves the task record and supported saved conversation. Retention is an option, not a requirement for conversation history.
- Local task storage and CLI-managed authentication do not mean that AI inference is offline or that provider requests never leave the computer.
- macOS is the tested platform. Windows is experimental and Linux is untested. Present availability accurately.
- Use existing release and license information. Avoid fabricated pricing, testimonials, customer logos, adoption figures, performance benchmarks, or an unrestricted commercial-use promise.

## 2. Creative direction: the workspace comes together

The central visual idea is **individual units of work assembling into a coherent workspace**. Projects, task cards, terminal surfaces, and review indicators are the visual material. Their movement should explain how Relay works.

Use a bright, cool opening with a graphite product surface. Move into a darker chapter for focused sessions and Plan council, then return to light for visibility, Standup, and the final invitation. Make these changes feel like one continuous composition.

Build around this compact palette:

| Token | Value | Role |
| --- | --- | --- |
| Paper | `#F5F7FA` | Main page ground |
| Graphite | `#10151B` | Dark chapters and product shell |
| Ink | `#18212B` | Main text on light surfaces |
| Steel | `#566577` | Supporting text on light surfaces |
| Line | `#DCE2EA` | Light-surface structural boundaries |
| Signal | `#2239C9` | Primary actions and selected controls |

On graphite, use Paper for primary text and a separately contrast-checked light gray for supporting text. Reuse current product colors for provider identity and task states. Preserve the distinctions between running, queued, complete, failed, open session, and ready for review. Include text labels with all state colors.

Use **Instrument Sans** for the landing-page headline and body. Use **JetBrains Mono** for actual terminal content, task IDs, and telemetry. Both are bundled in the Relay repository. Preserve the product's own typography inside faithful app depictions, including Source Serif 4 where the current interface uses it. Keep font licensing notices with copied assets.

Set an intentional type scale: roughly 88-120px desktop hero text, 48-72px section headings, and 18-20px introductory copy. Use fluid sizing and reduce the hero to roughly 42-56px on phones. Give display type a tight but readable line height and modest negative tracking. Keep paragraphs around 45-65 characters wide.

Use a 12-column desktop grid, a maximum content width near 1440px, generous chapter spacing, and strong left alignment. Let the product sometimes extend beyond the text grid. Vary panel sizes according to their purpose. Use modest rounding on controls, larger rounding on the main workspace, and shadows that establish depth.

The signature effect is the product assembly. Surround it with quiet typography and precise controls. Reserve translucency for a small navigation surface or a purposeful foreground layer. Keep structural panels opaque enough to read. Omit stock photography, robot mascots, decorative code rain, random particles, constant floating, and a page composed entirely of identical feature cards.

Reuse the Crowie mark from `public/favicon.svg` when repository assets are available. Treat `docs/assets/cc-relay-overview.png` as a structural reference, then check current product documentation for newer behavior. Reconstruct demo content using fictional projects and tasks; the reference image contains real work and historical interface details.

## 3. Opening and navigation

Use a restrained sticky navigation bar with the CC Relay mark and name, links to Workspace, Sessions, Plan council, and Usage, and a persistent **Download CC Relay** action. On mobile, provide an accessible compact menu.

Use this opening copy as the baseline:

**Headline:** The IDE of the future.

**Supporting line:** Every project in motion. Every task in view.

**Body:** Run your AI coding agents across multiple projects from one workspace. Give each new task a focused session, follow the work live, and come back when it is ready for review.

**Primary action:** Download CC Relay

**Secondary action:** Explore the workspace

**Quiet supporting text:** Works with Codex, Claude Code, and OpenCode. Uses your configured provider CLIs.

The first viewport must already contain the headline, actions, and enough product UI to recognize a real task workspace. Show a usable opening immediately, with the spatial experience beginning as the visitor scrolls.

Use the repository's release destination for Download CC Relay:

`https://github.com/Crowie-s-r-o/CC-Relay/releases/latest`

The secondary action moves to the settled, readable workspace overview. Provide **Skip animation** so visitors can reach that same overview without traversing the full assembly. Use ordinary anchor behavior where possible and account for the sticky navigation height.

## 4. Signature scroll scene: assemble CC Relay

On desktop, give the opening assembly a section around `340svh`, about 3.4 viewport heights, with a sticky stage occupying the available viewport beneath navigation. Treat the percentages below as progress through the actual scroll travel of that stage, after subtracting the sticky stage's height. Tune distances after inspecting the result.

Use one coordinated timeline with distinct background, workspace, and foreground layers. Start with perspective around 1200px, restrained `rotateX` and `rotateY`, and approximately 40-140px depth separation. Keep all meaningful text facing the viewer at reading moments.

| Scroll progress | Choreography | Meaning |
| --- | --- | --- |
| 0-15% | Hold the opening copy. Reveal three project tabs, their task cards, and three corresponding terminal planes suspended around a recognizable workspace silhouette. | Several things can move at once. |
| 15-40% | Project tabs align into the Launchpad rail. The composer settles on the left, the selected project's queue in the center, and Task Activity on the right. Terminal planes move behind their corresponding task cards using matching task identity. | Each task belongs to a project and has its own session. |
| 40-65% | The global monitor slots into place and shows activity from three projects. Different tasks advance to distinct states. Keep the queue visibly scoped to one selected project. | Cross-project awareness with project-specific organization. |
| 65-85% | Ease the workspace to a front-facing view. A completed task receives a Ready for review treatment and its project gains a badge. Trace that relationship with one short, precise highlight. | Completion becomes visible work to inspect. |
| 85-100% | Hold the assembled workspace at a readable scale, with a small copy change to "Everything has a place." Release the sticky stage naturally. | The visitor understands the finished interface. |

Make foreground cards travel slightly farther than the main workspace and the background move least. This is actual depth parallax, tied to scroll position. Keep large rotations brief, roughly within 18 degrees for readable UI planes, and settle them before detailed copy appears.

Scrolling backward should reconstruct earlier visual states coherently. Scroll speed must not change the order of events. A reload halfway down the page should show the correct state without an opening flash or a pile of unpositioned panels.

Use a shared frame and matching geometry for the transition into the next workspace section. Avoid a visible jump between differently sized versions of the same interface.

## 5. Workspace: several projects, one clear view

**Headline:** Keep every project moving.

**Body:** Queue the next request while other work runs. Give each project its own limits, follow active tasks across your workspace, and open the details when something needs your attention.

Create a wide product demonstration with three fictional projects:

- **Atlas**, a customer portal: task #104, "Add invoice export".
- **Beacon**, an API: task #208, "Make webhook retries idempotent".
- **Orbit**, documentation: task #312, "Document workspace setup".

Use independent project identity colors and a shared task vocabulary. Show the global task monitor across the top. Below it, show the selected project's task queue and detail panel. Switching project tabs changes the queue, detail selection, and project counts together.

Keep the primary layout faithful to Relay: project Launchpad, composer, project queue, Task Activity, and global monitor. Simplify text density for presentation while retaining these relationships.

Include working local demo interactions: select a project, select a task, inspect a sample result, and open a sample Changes view. Available task-owned patches should be distinct from a broader workspace comparison. Label the environment **Demo workspace** so simulated activity and token values are clear.

Use a short, unpinned depth transition to bring the selected task forward. Keep ordinary page scrolling throughout this chapter.

## 6. Sessions: fresh work, focused context, saved continuity

**Headline:** A fresh session for every new task.

**Body:** Keep unrelated conversations out of new work. Relay launches a dedicated Codex or Claude terminal for a fresh task, tracks its progress, and preserves the conversation so you can return to it.

This is the second and final extended sticky sequence. Use about `240svh`, or 2.4 viewport heights, on desktop. Place the selected Atlas task at the center of a graphite stage. Separate it into legible planes for the request, relevant context, provider session, and saved result. Each plane must remain visibly associated with the same task ID.

| Scroll progress | Choreography | Caption |
| --- | --- | --- |
| 0-20% | Bring task #104 forward. Nearby tasks move aside while staying attached to their own projects. | One task. Its own conversation. |
| 20-45% | Open a fresh terminal plane behind the task and rotate the grouped layers into a shallow exploded view. Show the request and relevant project context entering that session. | Start with the context this task needs. |
| 45-65% | Reassemble into a readable running session, then reveal its sample result. Update the task to Complete and expose Ready for review. | Follow the work through to its result. |
| 65-80% | Close the owned terminal plane while the task, result, and saved conversation remain in place. | The terminal closes. The work stays. |
| 80-100% | Demonstrate Continue session opening a new terminal for the same saved conversation and same task #104. Reveal the earlier exchange and a new follow-up. | Pick up where you left off. |

Use a small supporting explanation: "New tasks start fresh. Follow-ups restore the conversation you choose."

Below the scene, include an optional **Terminal session mode** explanation: keep a direct session open between turns, send another request, and complete the task explicitly. Distinguish task completion from terminal closure when depicting this option.

Illustrate context boundaries with task-labeled content. Any token values are sample telemetry, not proof of savings. New tasks still receive system and relevant repository context.

## 7. Completion and quick view

**Headline:** Know when it is ready for you.

**Body:** See what is running, hear when work finishes, and collect completed tasks in Ready for review. Open the result, inspect the available changes, and decide what comes next.

Create an asymmetric composition: a compact global monitor, one enlarged completion card, and a readable result or diff surface. On scroll, move the completed task out of the running monitor into its project's review group and increment the badge once.

Offer **Review sample task** as a real demo control. Opening it shows the sample result and acknowledges that sample completion, matching Relay's behavior. Preserve a clear route back to the workspace.

Explain that the global monitor keeps running tasks and open sessions visible across projects, while project queues and history hold the rest of the work. Use the phrase "Quick view of active work" without inventing an unsupported all-project history screen.

A small **Preview completion sound** button may play one short, synthesized chime after an explicit click. Keep the page silent by default and handle unavailable audio gracefully.

## 8. Plan council: show the thinking process

**Headline:** Give important plans a second perspective.

**Body:** Let one agent draft the approach, another challenge it, and the original author refine the plan before you start implementation.

Use one broad editorial section with three connected plan surfaces: **Draft**, **Review**, and **Revised plan**. These are actual sequential stages, so numbering them is appropriate here.

Show Claude authoring, Codex reviewing, and Claude revising as the initial sample. An accessible provider-order switch can reverse those roles. Use neutral plan surfaces with restrained provider accents.

As the section scrolls through view, extend an SVG connector between the stages. Let a small plan sheet rotate slightly toward the reviewer, reveal concise sample objections about edge cases and verification, and settle into the revised plan. Keep the text still long enough to read.

End with a distinct **Execute plan** handoff in the product illustration. In the landing-page demo, it opens an explanatory preview of that handoff and its selected provider. Planning completion itself must not imply that real implementation has already started.

Add one compact supporting mention of **Forward-planning Turbo**: a fresh planner prepares the work, then one fresh executor owns the implementation and may coordinate internal workers. Keep the council story primary in this section.

## 9. Standup: the work becomes the update

**Headline:** Your workday, already documented.

**Body:** Turn recorded, completed work into a concise Standup. Choose a day or two-day range, get a project-specific changelog, and ask follow-up questions grounded in the saved work.

Use a light composition with completed Atlas task rows on one side and an elegant, selectable changelog on the other. Reuse the export task and add two fictional completed Atlas tasks: "Refine invoice date filters" and "Fix refunded invoice totals".

Scroll draws those tasks into three concise lines:

- Added: CSV invoice exports.
- Changed: Invoice date filters.
- Fixed: Totals for refunded invoices.

Show Security only when the sample contains a relevant confirmed change. The output must stay scoped to Atlas; Beacon and Orbit activity must not enter this Standup.

Provide a date selection or preset sample interaction, a working **Copy Standup** button, and one sample dated follow-up. Generate the landing-page demonstration from local fixtures. Announce copy success only when copying succeeds. Keep generated text visible and manually selectable if clipboard access fails.

## 10. Usage: clarity while work is running

**Headline:** Keep your usage in view.

**Body:** Follow native token consumption and the subscription windows your providers report. See what you have used and when supported limits reset, while your projects keep moving.

Create a restrained instrumentation section using bars, clear numerical labels, and a small project breakdown. Show these as three distinct concepts:

1. **Task consumption:** provider-reported input and output tokens.
2. **Today:** daily consumption with a project breakdown.
3. **Subscription windows:** percentage used and time until reset for supported Claude and Codex windows, including a distinct Fable window when reported.

If output speed appears, label it **Average output tokens/s**. Keep it separate from input consumption and subscription allowance. Label percentage bars **used**, and label countdowns **resets in**. Handle missing data with an unavailable state rather than a fabricated zero.

Use one brief scroll-controlled fill that settles at the labeled sample values. Keep all demo numbers clearly illustrative. The story is visibility and control, without fabricated billing amounts or performance comparisons.

## 11. Closing, FAQ, and conversion

Return to a spacious light layout. Bring a small version of the assembled workspace into alignment beneath the closing copy.

**Headline:** Build across projects. Stay on top of every task.

**Body:** Give your AI development work a workspace that keeps the requests, sessions, progress, and results together.

**Primary action:** Download CC Relay

**Secondary action:** Read the documentation

Provide a short, accessible FAQ covering what Relay does, supported providers, fresh tasks versus continued sessions, automatic terminal closure, Plan council, platform availability, and local storage. The FAQ should resolve practical questions in plain language, using the accurate claims above.

Link documentation to the repository README and include repository, releases, and license links in the footer. Credit **Crowie s.r.o.** using the existing product identity. Keep installation requirements close to the download action: macOS is tested; configured provider CLIs are required. Reflect the current source-available license and its commercial-use terms accurately through a concise license note and direct link.

Use these destinations, validating them before delivery:

- Repository: `https://github.com/Crowie-s-r-o/CC-Relay`
- Documentation: `https://github.com/Crowie-s-r-o/CC-Relay/blob/main/README.md`
- License: `https://github.com/Crowie-s-r-o/CC-Relay/blob/main/LICENSE`

The repository currently uses PolyForm Noncommercial 1.0.0, with prior written permission required for commercial or other business use. Recheck the actual license if the source changes. Avoid placeholder signup forms and nonfunctional calls to action.

## 12. Animation and implementation requirements

Implement the choreography with a maintainable timeline architecture. GSAP with ScrollTrigger is a suitable choice for scroll-linked timelines and pinning; consult the [official ScrollTrigger documentation](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) for current behavior and integration. Use the site's existing stack where one exists.

When working inside the current Relay repository, keep the marketing site isolated from the desktop application's renderer and runtime. A dedicated `marketing/` implementation using HTML, CSS, and modular JavaScript is appropriate. Keep any marketing dependencies scoped there. Preserve existing application work and introduce no environment variables.

Build the scene from crisp DOM and SVG layers wherever practical. CSS perspective, transforms, controlled clipping, and deliberate lighting should supply the spatial effect. Keep text as text. Reach for WebGL only when a specific required effect cannot be achieved well with this approach, and retain a complete static fallback.

Apply these rules:

- Use one coordinated timeline for each major scene and one owner for each animated transform. Separate layout, scroll transforms, and hover transforms onto nested wrappers.
- Prefer transform and opacity changes during continuous motion. Reserve space for panels and media before they appear. Recalculate scene geometry after fonts load and on relevant size changes.
- Use either CSS sticky or animation-library pinning for a particular stage. Avoid double pinning and duplicated spacer height. Keep transformed or clipping ancestors from breaking sticky positioning.
- Keep browser scrolling native. Preserve keyboard scrolling, touch momentum, anchor navigation, browser history, and normal scrollbar behavior.
- Make scroll animation reversible and deterministic. Allow a little controlled interpolation, but keep it close enough to the scrollbar that the user feels in control.
- Keep page-load motion brief. Do not animate every paragraph or run decorative perpetual loops. Long sequences respond to scrolling; buttons respond to interaction.
- Limit extended pinning to the workspace assembly and the session lifecycle. All other chapters remain naturally scrollable.
- Use one shared fixture model for projects, task states, review counts, and usage. All visible counts must reconcile with that model at each scene checkpoint.
- Opening an interactive detail view must hold its state stable. Scroll choreography must not change the selected task, move focused controls, or overwrite text the visitor is reading.
- Keep controls outside decorative transformed copies. Decorative copies must be hidden from assistive technology and contain no focusable descendants. Expose one canonical accessible interface.
- Landing-page demos operate entirely on synthetic local state. They must not connect to a live Relay backend, open native terminals, run provider prompts, or mark real tasks reviewed.
- Clean up animation timelines, observers, listeners, and animation frames when their scene or responsive mode is removed. Keep offscreen work idle.

## 13. Mobile, accessibility, and performance

Design the phone experience deliberately. Use a readable sequence of project tabs, task cards, a session example, a plan route, and review results. Avoid squeezing a full desktop interface into illegible miniature text.

Below roughly 768px, replace both long pinned scenes with stacked, shorter illustrations and modest optional motion. On short landscape viewports, use the same simplified presentation. Reduce perspective and depth on tablets. Use stable viewport sizing so mobile browser chrome does not continually restart a scene.

Under `prefers-reduced-motion: reduce`, disable parallax, rotations, long pinning, smooth scrolling, and animated scrubbing. Render complete static workspace, lifecycle, and council states in ordinary document flow. Remove spacer heights along with animation. All copy, controls, and outcomes must remain available. Handle a preference change while the page is already open.

Provide semantic landmarks, one H1, a logical heading order, a skip link, visible focus, accessible tab and dialog behavior, Escape-to-close, focus restoration, and comfortable touch targets. Keep text contrast at least 4.5:1 for normal text and 3:1 for large text. Test text at 200% zoom. Status must be understandable without color, sound, or movement.

Make the first viewport useful before animation initialization. Load only the fonts and assets needed for the opening. Give images dimensions, compress any raster assets, defer lower-page media, and avoid enormous videos or image sequences for effects that DOM layers can achieve.

Include a descriptive page title and meta description, the product favicon, and share metadata using approved product assets or a clean synthetic workspace preview. Keep key copy crawlable in the initial HTML. Set canonical and social-image URLs when the actual public origin is known; keep origin configuration in an ordinary site configuration file and avoid inventing a domain.

Aim for smooth rendering on a normal laptop and a midrange phone. Measure dropped frames and layout shifts during the actual pinned scenes. Use 60fps as a performance target, not a published product claim. Optimize any measured bottleneck before adding more visual effects.

## 14. Completion and verification

Deliver the runnable landing-page source, organized animation code, required local assets, and concise preview/build instructions. Use the existing repository verification commands where applicable. Publish only when the surrounding task has authorized deployment.

Review browser captures at approximately 1440x900, 1024x768, 768x1024, and 390x844. Inspect the opening and intermediate animation states at 0%, 25%, 50%, 75%, and 100%, then scroll backward. Test direct anchor entry, a mid-page reload, resize across the mobile breakpoint, reduced motion, keyboard navigation, and unavailable animation JavaScript.

Check every demo interaction and outbound link. Confirm that task identity survives the terminal-close and Continue session sequence, the global monitor contains the intended running/open tasks, project queues remain scoped correctly, Standup includes only its selected project, and all demo counters agree.

Perform an extra verification pass after the first complete review. Fix overlapping copy, clipped controls, unreadable UI, inconsistent demo state, motion jumps, broken focus, missing assets, and incorrect product claims. If a browser or measurement tool is unavailable, state exactly what remains unverified and perform the strongest available checks.

Finish with a concise delivery note describing what was built, how to preview it, what was verified, and any remaining limitations. Stop every development server, watcher, and other process started for the task. Use no em dash characters in copy or documentation.
