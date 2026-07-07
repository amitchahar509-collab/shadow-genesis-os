/**
 * Cross-platform POSIX shell resolution.
 *
 * Agents emit POSIX command strings (`cd x && y || true`, `2>/dev/null`), so a
 * real `sh` is required. On Linux/macOS that is /bin/sh. On Windows we resolve
 * Git Bash (ships with Git for Windows, which the git tool already requires).
 * cmd.exe is the last resort — POSIX operators mostly work (&&, ||) but
 * redirects like 2>/dev/null do not.
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

export interface ShellSpec {
  file: string;
  args: string[]; // args before the command string, e.g. ["-c"]
  posix: boolean;
}

let cached: ShellSpec | null = null;

export function resolveShell(): ShellSpec {
  if (cached) return cached;
  if (process.platform !== "win32") {
    cached = { file: "/bin/sh", args: ["-c"], posix: true };
    return cached;
  }
  const candidates = [
    process.env.GENESIS_SHELL,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    process.env.ProgramW6432 ? `${process.env.ProgramW6432}\\Git\\bin\\bash.exe` : undefined,
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe` : undefined,
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (existsSync(c)) {
      cached = { file: c, args: ["-c"], posix: true };
      return cached;
    }
  }
  // `where` finds bash.exe if Git's bin dir is on PATH.
  try {
    const found = execSync("where bash.exe", { encoding: "utf8", timeout: 5_000 })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/\\System32\\/i.test(l)); // skip WSL stub — it needs a distro
    if (found && existsSync(found)) {
      cached = { file: found, args: ["-c"], posix: true };
      return cached;
    }
  } catch {}
  cached = { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c"], posix: false };
  return cached;
}

/**
 * Prepare an agent command string for the resolved shell.
 *
 * On Windows the interpolated paths are `C:\...` style, but bash treats `\`
 * as an escape character. Agent commands never contain intentional backslash
 * escapes, so converting all of them to `/` is safe here (Windows APIs, git,
 * bun and node all accept forward slashes).
 */
export function normalizeCommand(cmd: string): string {
  const shell = resolveShell();
  if (process.platform === "win32" && shell.posix) return cmd.replaceAll("\\", "/");
  return cmd;
}
