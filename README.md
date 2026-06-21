# fresh-wakatime

Automatic WakaTime heartbeats for the [Fresh Editor](https://getfresh.dev).

## Overview

This plugin silently sends coding activity to WakaTime by wrapping the `wakatime-cli` binary. It hooks three editor events:

| Event | `is_write` | Debounced |
|---|---|---|
| `buffer_save` | `true` | No — every save fires a heartbeat |
| `buffer_modified` | `false` | Yes — 2 min per file |
| `cursor_moved` | `false` | Yes — 2 min per file |

All language detection, project/branch resolution, API communication, and offline queuing are handled by the standalone `wakatime-cli`.

## Requirements

- [Fresh Editor](https://getfresh.dev) (any recent version)
- [wakatime-cli](https://github.com/wakatime/wakatime-cli) installed and on `$PATH`

## Installation

### Manual

Copy `wakatime.ts` into Fresh's `plugins/` directory:

```bash
# Locate your plugins folder (varies by installation method)
# macOS (Homebrew):
ln -s $(pwd) $(dirname $(which fresh))/plugins/fresh-wakatime

# General: create a symlink in Fresh's plugins directory
mkdir -p ~/.config/fresh/plugins
ln -s $(pwd)/wakatime.ts ~/.config/fresh/plugins/wakatime.ts
```

### Fresh Package Manager

_(Once published to the Fresh package registry)_

1. Open the command palette (`Ctrl+P`)
2. Run `pkg: Install Plugin`
3. Search for `fresh-wakatime`

## Configuration

The plugin reads your WakaTime API key from `~/.wakatime.cfg`:

```ini
[settings]
api_key = YOUR_API_KEY
```

No additional configuration is required — the `wakatime-cli` binary reads the same config file independently.

## Commands

| Command | Description |
|---|---|
| `WakaTime: Toggle heartbeats on/off` | Enable/disable activity tracking on the fly |
| `WakaTime: Show plugin status` | Display current status in the notification area |

## Plugin API

Other plugins or `init.ts` can import the typed API:

```typescript
const waka = editor.getPluginApi("fresh-wakatime");
if (waka) {
  console.log(waka.version);
  console.log(waka.getStatus());
}
```

See the `FreshWakaTimeApi` interface in `wakatime.ts` for details.

## Troubleshooting

**No heartbeats appearing on WakaTime dashboard:**

1. Verify `wakatime-cli` is installed: `which wakatime-cli`
2. Test it manually: `wakatime-cli --entity /tmp/test.py --plugin "test/1.0" --cursorpos 1 --lineno 1 --key YOUR_KEY`
3. Check Fresh's logs: `tail -f ~/.local/state/fresh/logs/fresh-*.log`
4. Run `WakaTime: Show plugin status` in Fresh to confirm the API key is detected

## License

MIT
