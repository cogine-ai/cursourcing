# Development and verification

```sh
npm ci
npm run build
npm test
npm run test:live
```

`test:live` uses the installed Cursor account and creates temporary workspaces. It checks parallel tasks, a file edit, cancellation, and cross-process session recovery through the real MCP interface. It cleans up its own processes/workspaces and prints a verification report. It does not test automatic Codex routing decisions or every Cursor extension.

Automated tests cover the MCP entrypoint, concurrent tasks, requests, cancellation, recovery, compact storage, native-history replay, and preview configuration compatibility. Live reports may contain local workspace paths and session identifiers; keep them locally rather than publishing them.

The compact-result regressions check the bundled MCP interface, full-view compatibility,
unresolved requests, configuration evidence, and output pagination. Transport-error
fixtures exercise diagnostics split across chunks immediately before `end_turn`,
normal prose/quoted errors, truncated replies, and explicit continuation without
automatic replay. A local-wait regression withholds filesystem notifications to
verify prompt completion, blocking input, and listener cleanup independently of
OS watcher latency. These are offline protocol tests, not a measurement of model
routing, paid token savings, or live Cursor service reliability.

History regressions cover stalled initialization/replay without a host cancel,
host and explicit cancellation, shutdown, and follow-ups after cleanup. They
verify that the session stays guarded until the replay client has closed,
unrelated tasks still run, cached delivery survives, and history can be retried
without prompting the model. The bundled MCP test exercises a real local fixture
process that stalls replay, then verifies same-session continuation.

For the 0.2.2 workflow, review the skill, tool descriptions, invocation prompts and
both READMEs together: none should default to sending routine acceptance findings
back to Cursor. Preserve explicit user choices, investigation-only tasks, worthwhile
rework, permission requests and independent verification. Check sequencing of writes,
builds and dependent checks, and distinguish worker evidence from coordinator checks.
Offline protocol tests and skill-format validation do not prove these model choices;
measure them in fresh behavioral runs with the same task and acceptance criteria.
If the outer evaluation prompt changes too, record that separately from the plugin
version. Keep historical attempts intact and local until selected for publication.

The source of truth is [cogine-ai/cursourcing](https://github.com/cogine-ai/cursourcing). The marketplace carries a release snapshot with the bundled runtime and skill, so users do not need npm dependencies or a build step.

After building, export that snapshot with `node scripts/export-plugin.mjs <destination>`. Dependency license texts ship in `dist/THIRD_PARTY_NOTICES.md`.

Runtime design references: T3 Code `CursorAdapter.ts`, `AcpSessionRuntime.ts`, and `ProviderService.ts` at commit `5ea6439816470288d3f2b6b43635fea41fbbb101`, plus [Cursor's ACP documentation](https://cursor.com/docs/cli/acp). A later review of T3 commit `935c55b3778fdeae0e25b250ce2a9fa7e79c0327` informed lifecycle regression coverage and conservative handling of standalone transport diagnostics. The bridge is an independent implementation; no T3 source was copied.


[Back to the README](../README.md)
