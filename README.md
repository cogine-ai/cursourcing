[![Cursourcing — Your Codex just hired Cursor.](assets/hero.png)](https://github.com/cogine-ai/cursourcing)

<p align="center">
  <strong>Delegate subtasks to Cursor CLI while Codex stays in charge.</strong><br />
  <a href="#install">Install Cursourcing</a> ·
  <a href="https://github.com/cogine-ai/marketplace">Cogine AI Marketplace</a> ·
  <a href="README.zh-CN.md">中文</a>
</p>

## Tokenmaxxing for the Astra × Grok era.

Your **GPT-6 Astra budget in Codex is running low**. Your **Grok 4.6 allowance in Cursor still has room**. Put that spare capacity to work.

**Cursourcing = Cursor + outsourcing.** Keep Astra focused on planning, judgment, and review. Let Codex hand useful subtasks to Cursor's Grok 4.6, follow the work, and bring the results back into your task.

You stay in Codex. Both subscriptions get work to do.

| Codex plans | Cursor executes | Codex reviews |
| --- | --- | --- |
| Chooses a useful subtask and supplies the context. | Works in the specified project directory and reports progress or questions. | Inspects the changes, checks the result, and follows up when needed. |

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
Use $cursourcing to plan this task, delegate useful work to Cursor
as it develops, and review the results.
```

Codex plans normally. It actively looks for useful work to delegate, including investigations whose implementation approach is still open. Invoking the skill doesn't require immediate delegation.

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
| Asynchronous execution | A task ID returns while Cursor starts. Codex can inspect progress and collect results later. |
| Questions and permissions | Cursor requests come back to Codex so it can respond using the existing authorization or involve you. |
| Compact results | Read progress, the latest reply, and key information first. Load detailed native history when needed. |
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

```bash
codex plugin marketplace upgrade cogine-ai
codex plugin add cursourcing@cogine-ai
```

Start a new task after updating to pick up the refreshed skill and tools.

## Go deeper

- [Runtime, permissions, configuration, and history](docs/runtime.md)
- [Development and verification](docs/development.md)
- [Icon and share card](docs/brand.md)
- [Report a bug or suggest an improvement](https://github.com/cogine-ai/cursourcing/issues)
- [Cogine AI Marketplace](https://github.com/cogine-ai/marketplace) — Cursourcing and the role-based skill collection.

Built by [Cogine AI](https://github.com/cogine-ai). Know someone whose Codex runs out before their Cursor does? Send them this repo.
