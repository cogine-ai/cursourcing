# Development and verification

```sh
npm ci
npm run build
npm test
npm run test:live
```

`test:live` uses the installed Cursor account and creates temporary workspaces. It checks parallel tasks, a file edit, cancellation, and cross-process session recovery through the real MCP interface. It cleans up its own processes/workspaces and prints a verification report. It does not test automatic Codex routing decisions or every Cursor extension.

Automated tests cover the MCP entrypoint, concurrent tasks, requests, cancellation, recovery, compact storage, native-history replay, and preview configuration compatibility. Live reports may contain local workspace paths and session identifiers; keep them locally rather than publishing them.

The source of truth is [cogine-ai/cursourcing](https://github.com/cogine-ai/cursourcing). The marketplace carries a release snapshot with the bundled runtime and skill, so users do not need npm dependencies or a build step.

After building, export that snapshot with `node scripts/export-plugin.mjs <destination>`. Dependency license texts ship in `dist/THIRD_PARTY_NOTICES.md`.

Runtime design references: T3 Code `CursorAdapter.ts`, `AcpSessionRuntime.ts`, and `ProviderService.ts` at commit `5ea6439816470288d3f2b6b43635fea41fbbb101`, plus [Cursor's ACP documentation](https://cursor.com/docs/cli/acp). The bridge is an independent implementation; no T3 source was copied.


[Back to the README](../README.md)
