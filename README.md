[![Cursourcing — Your Codex just hired Cursor.](assets/hero.png)](https://github.com/cogine-ai/cursourcing)

<p align="center">
  <strong>Delegate complete work to Cursor CLI; verify delivery in Codex.</strong><br />
  <a href="#install">Install Cursourcing</a> ·
  <a href="https://github.com/cogine-ai/marketplace">Cogine AI Marketplace</a> ·
  <a href="README.zh-CN.md">中文</a>
</p>

## Tokenmaxxing for the Astra × Grok era.

Your **GPT-6 Astra budget in Codex is running low**. Your **Grok 4.6 allowance in Cursor still has room**. Put that spare capacity to work.

**Cursourcing = Cursor + outsourcing.** Give Cursor's Grok 4.6 a complete work unit, including investigation and self-checks. Codex supplies constraints, handles blocking decisions, and verifies the delivered result.

You stay in Codex. When saving Codex usage is the goal, the workflow limits repeated investigation and progress checks; actual savings depend on the task and review effort.

| Codex plans | Cursor executes | Codex reviews |
| --- | --- | --- |
| Defines the work unit, constraints, and acceptance criteria. | Investigates, implements, self-checks, and returns evidence or blocking questions. | Inspects actual changes, checks the result, and requests specific corrections when needed. |

Your main Codex model stays the one you selected. Cursor currently runs **Grok 4.6 · xhigh · fast**.

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
Use $cursourcing to give Cursor a complete work unit,
minimize Codex coordination, and verify the delivered result.
```

Cursor can investigate an open implementation approach. Codex intervenes for blocking decisions and delivery review, while continuing genuinely independent work when useful. Invoking the skill doesn't require immediate delegation.

**[Browse all seven plugins in the Cogine AI Marketplace →](https://github.com/cogine-ai/marketplace#available-plugins)**

## Give your spare Cursor capacity a job

- **A scoped implementation.** Add an agreed feature in the relevant files, run the appropriate checks, and report what changed.
- **An investigation.** Trace a failure, gather evidence, and bring findings back for Codex to assess.
- **Independent work in parallel.** Run separate Cursor conversations for tasks that can proceed independently, using suitable directories or worktrees.
- **A follow-up.** Keep the same Cursor conversation and ask it to address review findings or continue from its saved context.

Codex decides what to do directly and what to delegate as the task develops. Native Codex collaboration remains available.

## Built for the handoff—and the way back

| Capability | What it means in practice |
| --- | --- |
| Asynchronous execution | A task ID returns while Cursor starts. Ordinary progress stays local; Codex collects delivery or blocking decisions. |
| Questions and permissions | Cursor requests come back to Codex so it can respond using the existing authorization or involve you. |
| Compact results | Start and wait return necessary status and unread delivery reports. Request full details and native history when needed. |
| Session recovery | Reload a saved conversation and continue it. Recovery doesn't automatically rerun interrupted instructions. |
| Review stays with Codex | A completed Cursor turn is a result to inspect, not an automatic acceptance decision. |

## A few useful answers

**How does usage work?** Codex and Cursor use their own accounts and allowances. Cursourcing delegates work between them; it doesn't transfer tokens. Codex still uses capacity for coordination and review. The benefit depends on the task and how the work is divided.

**Does this change my Codex model?** No. Astra is the motivating use case, but Cursourcing keeps whichever Codex model you select for the main task.

**Does it force every task through Cursor?** No. The skill is normally discoverable, and Codex chooses when delegation helps. Cursourcing installs no Hooks and doesn't disable native subagents.

**Will it keep working after Codex closes?** This version runs with its MCP server. If that process exits, active tasks are interrupted; saved conversations can be recovered. It doesn't independently wake an idle Codex task.

**Which directory does Cursor use?** The absolute directory Codex passes for the subtask, including a worktree when appropriate. Cursourcing doesn't create worktrees automatically.

**Can I choose another Cursor model?** This release uses Grok 4.6 with xhigh effort and fast enabled. An unavailable configuration fails explicitly.

## Update

**0.2.0** focuses delegation on complete work units and reduces repeated progress
checks. `start_task` and `wait` now return compact results by default. Integrations
that need the previous snapshot fields can use `detail: "full"` or `read_task`;
saved sessions remain recoverable. See the [migration notes](docs/runtime.md#compact-results-and-02-migration).

```bash
codex plugin marketplace upgrade cogine-ai
codex plugin add cursourcing@cogine-ai
codex plugin list --json
```

Confirm that Cursourcing reports version `0.2.0`, then start a new task to pick up
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
