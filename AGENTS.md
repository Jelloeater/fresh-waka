# Agents.md

Guidance for AI agents working on this codebase.

## Architecture

`wakatime.ts` is a single-file Fresh Editor plugin. It follows the standard Fresh plugin pattern:

1. **File evaluated at startup** — top-level code runs `init()` which registers events, commands, and exports the plugin API.
2. **No build step** — Fresh transpiles `.ts` via OXC at load time.
3. **Handlers are global functions** — must be assigned to `globalThis` because `editor.on()` and `editor.registerCommand()` accept handler names as strings (not closures).

## Design Decisions

- **Delegate to wakatime-cli** — The plugin is intentionally thin. Language detection, project mapping, network calls, and offline queuing are the CLI's job. This keeps the plugin simple and resilient to WakaTime API changes.
- **Config is optional** — `~/.wakatime.cfg` is read as a best-effort optimisation. The CLI reads it independently, so the plugin works even if parsing fails.
- **Buffer ID guard** — `editor.getActiveBufferId()` returning `0` means no active buffer (e.g., empty dashboard). The plugin silently skips heartbeats in this state.
- **Unsaved buffers** — `editor.getBufferPath()` returns empty for unnamed buffers; heartbeats are skipped.

## Key Implementation Details

| Concern | Approach |
|---|---|
| Debounce | Per-file timestamp compare in `sendHeartbeatIfNeeded()` — 2 minute window |
| Process spawning | `editor.spawnBackgroundProcess("wakatime-cli", args)` — fire-and-forget, no stdout/stderr capture needed |
| INI parsing | Custom minimal parser in `parseIniValue()` — handles `#` and `;` comments, case-insensitive section matching |
| Typed API | `editor.exportPluginApi("fresh-wakatime", api)` with global `FreshPluginRegistry` interface augmentation |
| pathJoin | `editor.pathJoin(...parts: string[])` — rest params, **not** an array. `editor.pathJoin(a, b, c)` not `editor.pathJoin([a, b, c])` |

## Conventions

- **No external dependencies** — only the Fresh Plugin API and `wakatime-cli` binary.
- **Error handling** — silent failures (`.catch()` on async ops, no unhandled rejections).
- **Logging** — `editor.info()` for load confirmation, `editor.warn()` for recoverable failures (e.g., missing CLI), `editor.setStatus()` for user-facing toggle feedback.
- **Naming** — event handlers prefixed `onWakaTime`, command handlers lowerCamelCase matching the command name.

## Testing

Testing relies on the `wakatime-cli` binary being present. To verify the plugin works:

1. Open any file in Fresh
2. Run `WakaTime: Show plugin status`
3. Check `~/.wakatime.log` for heartbeat activity

For development, set `WAKATIME_CLI_LOG_LEVEL=debug` to see CLI-level diagnostics.

## Related

- [Fresh Plugin API docs](https://getfresh.dev/docs/plugins/api/)
- [WakaTime Plugin Developer Guide](https://wakatime.com/developers/plugins)
