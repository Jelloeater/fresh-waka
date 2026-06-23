/// <reference path="../types/fresh.d.ts" />

/**
 * fresh-wakatime — WakaTime plugin for Fresh Editor
 * ===================================================
 *
 * Sends WakaTime heartbeats via wakatime-cli on:
 *   • File save      → is_write = true
 *   • File open      → is_write = false (debounced 2 min)
 *   • Buffer edit    → is_write = false (debounced 2 min)
 *   • Cursor move    → is_write = false (debounced 2 min)
 *
 * The plugin is a thin TypeScript wrapper — all language detection,
 * project resolution, and API communication is delegated to the
 * standalone wakatime-cli binary (searched in PATH).
 *
 * Required: wakatime-cli installed on the system.
 * Optional: ~/.wakatime.cfg with api_key (CLI reads it too).
 */

// ─────────────────────────────────────────────────────────────
//  Typed Plugin API  (consumable from init.ts or other plugins)
// ─────────────────────────────────────────────────────────────

declare global {
  interface FreshPluginRegistry {
    "fresh-wakatime": FreshWakaTimeApi;
  }
}

interface WakaTimeStatus {
  /** Whether heartbeats are being sent */
  enabled: boolean;
  /** Whether an API key was found in ~/.wakatime.cfg */
  hasApiKey: boolean;
  /** Unix-epoch ms of the last heartbeat, or null */
  lastHeartbeat: number | null;
  /** Absolute path of the file in the last heartbeat */
  lastHeartbeatFile: string | null;
}

interface FreshWakaTimeApi {
  readonly version: string;
  readonly enabled: boolean;
  readonly hasApiKey: boolean;
  getStatus(): WakaTimeStatus;
}

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const PLUGIN_VERSION = "1.0.0";

/** Minimum interval (ms) between non-save heartbeats for the same file */
const HEARTBEAT_INTERVAL_MS = 120_000; // 2 minutes

/** Plugin identifier sent in the User-Agent header via the --plugin flag */
const PLUGIN_UA = `fresh-editor/1.0.0 fresh-wakatime/${PLUGIN_VERSION}`;

/** Regex for validating a WakaTime API key (UUID v4 with optional waka_ prefix) */
const API_KEY_RE =
  /^(?:waka_)?[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i;

/** Best-effort format check — does not block heartbeats, only affects status display. */
function isValidApiKey(key: string): boolean {
  return API_KEY_RE.test(key);
}

// ─────────────────────────────────────────────────────────────
//  Mutable state
// ─────────────────────────────────────────────────────────────

let enabled = true;
let apiKey: string | null = null;
let lastHeartbeatTime = 0;
let lastHeartbeatFile: string | null = null;

// ─────────────────────────────────────────────────────────────
//  Initialisation
// ─────────────────────────────────────────────────────────────

/**
 * Called once when the plugin file is evaluated.
 * Sets up event hooks, commands, and exports the typed API.
 */
function init(): void {
  // WAKATIME_API_KEY env var takes priority over ~/.wakatime.cfg
  const envKey = editor.getEnv("WAKATIME_API_KEY");
  // ponytail: no validation here — wakatime-cli does it.
  // We forward whatever we find; a bad key just means no dashboard data.
  if (envKey) apiKey = envKey;

  // Read the API key from disk (async, best-effort)
  loadApiKeyFromConfig();

  // ── Event hooks ──────────────────────────────────────────
  // Handlers must be global function names (closures are not supported).
  editor.on("buffer_save", "onWakaTimeSave");
  editor.on("after_file_open", "onWakaTimeFileOpen");
  editor.on("buffer_modified", "onWakaTimeModified");
  editor.on("cursor_moved", "onWakaTimeCursorMoved");

  // ── Palette commands ────────────────────────────────────
  editor.registerCommand(
    "wakatime:toggle",
    "WakaTime: Toggle heartbeats on/off",
    "wakatimeToggle",
  );

  editor.registerCommand(
    "wakatime:status",
    "WakaTime: Show plugin status",
    "wakatimeStatus",
  );

  // ── Export typed API ────────────────────────────────────
  const api: FreshWakaTimeApi = {
    version: PLUGIN_VERSION,
    get enabled() {
      return enabled;
    },
    get hasApiKey() {
      return apiKey !== null;
    },
    getStatus: () => ({
      enabled,
      hasApiKey: apiKey !== null,
      lastHeartbeat: lastHeartbeatTime > 0 ? lastHeartbeatTime : null,
      lastHeartbeatFile,
    }),
  };

  editor.exportPluginApi("fresh-wakatime", api);
  editor.info("fresh-wakatime loaded");
}

// ─────────────────────────────────────────────────────────────
//  Config file parsing
// ─────────────────────────────────────────────────────────────

/**
 * Reads ~/.wakatime.cfg and caches the api_key value.
 *
 * This is best-effort and asynchronous: the CLI binary also reads
 * the same config file, so passing --key is only an optimisation
 * that avoids a redundant filesystem read inside wakatime-cli.
 */
function loadApiKeyFromConfig(): void {
  const home = editor.getEnv("HOME");
  if (!home || home.length === 0) return;

  // ponytail: API is pathJoin(...parts: string[]) not pathJoin(parts: string[])
  const configPath = editor.pathJoin(home, ".wakatime.cfg");
  if (!editor.fileExists(configPath)) return;

  editor
    .readFile(configPath)
    .then((content: string) => {
      const key = parseIniValue(content, "settings", "api_key");
      if (key) apiKey = key;
    })
    .catch(() => {
      /* config is optional – ignore read errors */
    });
}

/**
 * Minimal INI parser — extracts the value of `key` inside `[section]`.
 * Returns null when the key is not found.
 */
function parseIniValue(
  content: string,
  section: string,
  key: string,
): string | null {
  const targetSection = `[${section.toLowerCase()}]`;
  let inSection = false;

  for (const raw of content.split("\n")) {
    const line = raw.trim();

    // Empty or comment lines
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    // Section header
    if (line.startsWith("[")) {
      inSection = line.toLowerCase() === targetSection;
      continue;
    }

    if (!inSection) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const k = line.substring(0, eq).trim();
    if (k !== key) continue;

    return line.substring(eq + 1).trim();
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
//  Global event handlers
//  (Referenced by name via editor.on — must live on globalThis)
// ─────────────────────────────────────────────────────────────

globalThis.onWakaTimeSave = function onWakaTimeSave(): void {
  sendHeartbeatIfNeeded(true);
};

/** ponytail: this event name may not be in the public API spec.
 *  Fresh dispatches events by name string; it works in practice.
 *  Upgrade path: switch to buffer_activated if after_file_open is removed. */
globalThis.onWakaTimeFileOpen = function onWakaTimeFileOpen(): void {
  sendHeartbeatIfNeeded(false);
};

globalThis.onWakaTimeModified = function onWakaTimeModified(): void {
  sendHeartbeatIfNeeded(false);
};

globalThis.onWakaTimeCursorMoved = function onWakaTimeCursorMoved(): void {
  sendHeartbeatIfNeeded(false);
};

// ─────────────────────────────────────────────────────────────
//  Palette command handlers
// ─────────────────────────────────────────────────────────────

globalThis.wakatimeToggle = function wakatimeToggle(): void {
  enabled = !enabled;
  editor.setStatus(
    "WakaTime: " + (enabled ? "heartbeats enabled" : "heartbeats disabled"),
  );
};

globalThis.wakatimeStatus = function wakatimeStatus(): void {
  const statusLabel = enabled ? "enabled" : "disabled";
  const keyLabel = apiKey
    ? isValidApiKey(apiKey)
      ? "configured"
      : "invalid format"
    : "not set";
  const fileLabel = lastHeartbeatFile
    ? editor.pathBasename(lastHeartbeatFile)
    : "none";

  editor.info(
    `WakaTime: ${statusLabel} | API key: ${keyLabel} | Last file: ${fileLabel}`,
  );
};

// ─────────────────────────────────────────────────────────────
//  Heartbeat logic
// ─────────────────────────────────────────────────────────────

/**
 * Decide whether a heartbeat should be sent, then fire the CLI.
 *
 * Debounce rule: non-save events for the same file are discarded if
 * fewer than HEARTBEAT_INTERVAL_MS ms have elapsed since the last
 * heartbeat.  Save events (isWrite = true) always go through.
 */
function sendHeartbeatIfNeeded(isWrite: boolean): void {
  if (!enabled) return;

  const bufId = editor.getActiveBufferId();
  if (bufId === 0) return; // no active buffer

  const path = editor.getBufferPath(bufId);
  if (!path || path.length === 0) return; // virtual / unsaved buffer

  const now = Date.now();

  if (
    !isWrite &&
    path === lastHeartbeatFile &&
    now - lastHeartbeatTime < HEARTBEAT_INTERVAL_MS
  ) {
    return; // debounced
  }

  lastHeartbeatFile = path;
  lastHeartbeatTime = now;

  const cursorPos = editor.getCursorPosition();
  const lineNo = editor.getCursorLine(); // 1-indexed
  spawnWakaTimeCli(path, isWrite, cursorPos, lineNo);
}

/**
 * Build the argv array and launch wakatime-cli in the background.
 *
 * The CLI is responsible for:
 *   • detecting the project name and branch
 *   • detecting the syntax language
 *   • sending the heartbeat to the WakaTime API
 *   • offline queuing when the network is unavailable
 */
function spawnWakaTimeCli(
  entity: string,
  isWrite: boolean,
  cursorpos: number,
  lineno: number,
): void {
  const args: string[] = [
    "--entity",
    entity,
    "--plugin",
    PLUGIN_UA,
    "--cursorpos",
    String(cursorpos),
    "--lineno",
    String(lineno),
  ];

  if (isWrite) {
    args.push("--write");
  }

  // Passing --key is optional — wakatime-cli reads ~/.wakatime.cfg on its own.
  // We forward it when we have it cached to save the CLI a redundant file read.
  if (apiKey !== null) {
    args.push("--key", apiKey);
  }

  editor
    .spawnBackgroundProcess("wakatime-cli", args)
    .catch((err: unknown) => {
      /* wakatime-cli not on PATH or another transient error — warn once */
      editor.warn("WakaTime: failed to spawn wakatime-cli: " + String(err));
    });
}

// ─────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────

init();
