[![Cursourcing — Your Codex just hired Cursor.](assets/hero.png)](https://github.com/cogine-ai/cursourcing)

<p align="center">
  <strong>Cursor implements and self-checks; Codex accepts and finishes.</strong><br />
  <a href="#install">Install Cursourcing</a> ·
  <a href="https://github.com/cogine-ai/marketplace">Cogine AI Marketplace</a> ·
  <a href="README.zh-CN.md">中文</a>
</p>

## Tokenmaxxing for the Astra × Grok era.

Your **GPT-6 Astra budget in Codex is running low**. Your **Grok 4.6 allowance in Cursor still has room**. Put that spare capacity to work.

**Cursourcing = Cursor + outsourcing.** Have Cursor's Grok 4.6 deliver the first complete result, including investigation, implementation and self-checks. Codex supplies constraints and handles blocking decisions, then takes over acceptance and local corrections.

You stay in Codex. When saving Codex usage is the goal, the workflow limits repeated investigation and progress checks; actual savings depend on the task and review effort.

| Phase | Owner | Work |
| --- | --- | --- |
| First complete result | Cursor | Investigates, implements, fixes self-check failures, and returns evidence against the agreed constraints. |
| Acceptance and finish work | Codex | Reviews the actual changes, runs independent checks for material risks, makes local corrections, and rechecks affected results. |

After taking over, Codex keeps bounded corrections locally by default. New investigation or substantial rework can justify another complete delegated unit, and explicit user choices take precedence. Saved Cursor sessions remain available; this is a division of responsibility, not a one-turn limit.

Your main Codex model stays the one you selected. Cursor currently runs **Grok 4.6 · xhigh · fast**.

## Token savings benchmark

In a local controlled evaluation on September 17, 2026, **Cursourcing 0.2.2 (B4) used 43.93% fewer Codex tokens across three tasks than Astra alone (A)**, saving 1,026,033 tokens.

Both groups used **GPT-6 Astra · high** as the main model. A completed the work directly. B4 used a local snapshot of the committed 0.2.2 package, delegating the first implementation, self-checks and evidence to **Cursor Grok 4.6 · xhigh · fast**, then keeping acceptance and local corrections with Astra. Each B4 task ran once in a fresh, independent session, against the earlier A sample for the same task.

| Task | A: Astra alone | B4: Astra + Cursourcing 0.2.2 | Codex token savings |
| --- | ---: | ---: | ---: |
| Redesign a 14-route React website | 1,562,806 | 723,832 | **53.68%** |
| Fix Click boolean flag defaults | 385,253 | 309,222 | **19.74%** |
| Extract Tornado DNS resolvers across files | 387,808 | 276,780 | **28.63%** |
| **Total** | **2,335,867** | **1,309,834** | **43.93%** |

**Measurement:** Codex input and output tokens across each implementation session, including delegation, waiting, review and local corrections. Cached reads are already included in input; reasoning is already included in output. Separate launcher sessions and shared evaluation setup, external acceptance and reporting overhead are accounted for separately and excluded from this table. Savings are `(A − B4) / A`; the total uses summed tokens.

**Quality and controls:** Task briefs, original starters, main-model settings and frozen acceptance checks stayed the same; workflow instructions differed by role, with B4 explicitly keeping subsequent corrections in Astra. All three tasks passed frozen functional acceptance and received source or visual review. The frontend passed 28 checks across 14 routes at desktop and mobile sizes; Click and Tornado passed independent regression tests. Tornado still omitted the new module from its package type declarations, so functional success does not establish a complete type entry point.

**Limits:** This is one sample per task, and the frontend contributes most of the total. Model variability, caching and service load can affect results; the measured reduction is not a guarantee. Fewer Codex tokens do not necessarily mean faster completion or lower combined cost: both backend tasks remained slower than Astra alone, Click's Codex API-equivalent cost was slightly higher, and Cursor usage was not fully returned. Raw evaluation records remain local and have not been published with the repository.

## Install

**You'll need:** Codex with plugin support, Node.js 22+, and an installed, authenticated [Cursor CLI](https://cursor.com/docs/cli/overview). Run `agent login` if you haven't signed in. Cursor must have access to the configured Grok model.

### 1. Add the Cogine AI Marketplace

```bash
codex plugin marketplace add cogine-ai/marketplace
```

Already added it? Refresh its catalog with `codex plugin marketplace upgrade cogine-ai`.

### 2. Install Cursourcing

In the Codex app, open **Plugins → Cogine AI → Cursourcing** and install it. Or use the CLI:

```bash
codex plugin add cursourcing@cogine-ai
```

The runtime is bundled. Installation needs no repository clone, `npm install`, or build step.

### 3. Give it a real task

Start a new Codex task in your project and invoke **`$cursourcing:cursourcing`**:

```text
Use $cursourcing for the first complete implementation and self-checks,
then take over acceptance and local corrections in Codex.
```

Cursor can investigate an open implementation approach. While Cursor owns the unit, Codex handles blockers or genuinely independent work and defers review of changing artifacts until handoff. Invoking the skill doesn't require immediate delegation.

**[Browse all seven plugins in the Cogine AI Marketplace →](https://github.com/cogine-ai/marketplace#available-plugins)**

## Give your spare Cursor capacity a job

- **A scoped implementation.** Add an agreed feature in the relevant files, run the appropriate checks, and report what changed.
- **An investigation.** Trace a failure, gather evidence, and bring findings back for Codex to assess.
- **Independent work in parallel.** Run separate Cursor conversations for tasks that can proceed independently, using suitable directories or worktrees.
- **Further delegated work.** Reuse the same Cursor conversation when new investigation, substantial rework, or your explicit request warrants another unit.

Codex decides what to do directly and what to delegate as the task develops. Native Codex collaboration remains available.

## Built for the handoff—and the way back

| Capability | What it means in practice |
| --- | --- |
| Asynchronous execution | A task ID returns while Cursor starts. Ordinary progress stays local; Codex collects delivery or blocking decisions. |
| Questions and permissions | Cursor requests come back to Codex so it can respond using the existing authorization or involve you. |
| Compact results | Start and wait return necessary status and unread delivery reports. Request full details and native history when needed. |
| Session recovery | Reload a saved conversation and continue it. Recovery doesn't automatically rerun interrupted instructions. |
| Acceptance stays with Codex | Inspect the delivered result and evidence, finish local corrections, and verify the affected behavior. |

## A few useful answers

**How does usage work?** Codex and Cursor use their own accounts and allowances. Cursourcing delegates work between them; it doesn't transfer tokens. Codex still uses capacity for coordination and review. The benefit depends on the task and how the work is divided.

**Does this change my Codex model?** No. Astra is the motivating use case, but Cursourcing keeps whichever Codex model you select for the main task.

**Does it force every task through Cursor?** No. The skill is normally discoverable, and Codex chooses when delegation helps. Cursourcing installs no Hooks and doesn't disable native subagents.

**Will it keep working after Codex closes?** This version runs with its MCP server. If that process exits, active tasks are interrupted; saved conversations can be recovered. It doesn't independently wake an idle Codex task.

**Which directory does Cursor use?** The absolute directory Codex passes for the subtask, including a worktree when appropriate. Cursourcing doesn't create worktrees automatically.

**Can I choose another Cursor model?** This release uses Grok 4.6 with xhigh effort and fast enabled. An unavailable configuration fails explicitly.

## Update

**0.2.3** reduces routine coordination and makes interrupted-session recovery safer:

- Waits now default to 120 seconds, with a 150-second MCP deadline; delivery and blocking requests return early.
- Failed execution finishes process cleanup before returning an actionable failure. Runtime shutdown also drains its owned CLI processes.
- Recovery and replacement work are blocked while a previous runtime's execution is alive or unconfirmed. Failure summaries indicate whether a session exists and can be resumed.
- The skill reads progress only when it affects a decision and uses longer waits for local validation commands.

The two-phase workflow introduced in 0.2.2 remains: Cursor delivers the first
complete result and self-check evidence; Codex owns acceptance and bounded
corrections. Grok 4.6 xhigh fast remains the execution model. The historical
[token savings benchmark](#token-savings-benchmark) measures 0.2.2 (B4); the
additional savings from 0.2.3 have not been measured.
See [runtime details](docs/runtime.md) and the [0.2 migration notes](docs/runtime.md#compact-results-and-02-migration).

```bash
codex plugin marketplace upgrade cogine-ai
codex plugin add cursourcing@cogine-ai
codex plugin list --json
```

Confirm that Cursourcing reports version `0.2.3`, then start a new task to pick up
the refreshed skill and tools.

## Go deeper

- [Runtime, permissions, configuration, and history](docs/runtime.md)
- [Development and verification](docs/development.md)
- [Icon and share card](docs/brand.md)
- [Report a bug or suggest an improvement](https://github.com/cogine-ai/cursourcing/issues)
- [Cogine AI Marketplace](https://github.com/cogine-ai/marketplace) — Cursourcing and the role-based skill collection.

## License

Cursourcing's original material is licensed under [Apache-2.0](LICENSE), copyright 2026 [Cogine AI](https://github.com/cogine-ai). See [NOTICE](NOTICE) for attribution. Bundled third-party dependencies retain their respective licenses in [THIRD_PARTY_NOTICES.md](dist/THIRD_PARTY_NOTICES.md).

Built by [Cogine AI](https://github.com/cogine-ai). Know someone whose Codex runs out before their Cursor does? Send them this repo.
