import {
  access,
  mkdir,
  stat as fsStat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const posix = path.posix;
const sandboxRootWithSlash = `${config.sandboxRoot}${path.sep}`;

function normalizeVirtual(value) {
  const candidate = posix.normalize(value);
  if (!candidate.startsWith("/")) {
    throw new Error("Virtual paths must be absolute");
  }
  const withoutTrailing = candidate.replace(/\/+$/, "") || "/";
  if (withoutTrailing.includes("\0")) {
    throw new Error("Invalid path character detected");
  }
  return withoutTrailing;
}

export const DEFAULT_CWD = normalizeVirtual(config.defaultVirtualHome ?? "/home/demo");

export function sanitizeVirtualPath(input) {
  if (!input) {
    return DEFAULT_CWD;
  }
  return normalizeVirtual(input);
}

export function resolveVirtualPath(current, input) {
  const base = sanitizeVirtualPath(current ?? DEFAULT_CWD);
  if (!input || input === ".") {
    return base;
  }
  if (input.startsWith("/")) {
    return sanitizeVirtualPath(input);
  }
  return sanitizeVirtualPath(posix.resolve(base, input));
}

export function toRealPath(virtualPath) {
  const normalized = sanitizeVirtualPath(virtualPath);
  const resolved = path.resolve(config.sandboxRoot, `.${normalized}`);
  if (resolved !== config.sandboxRoot && !resolved.startsWith(sandboxRootWithSlash)) {
    throw new Error(`Resolved path escapes sandbox: ${virtualPath}`);
  }
  return resolved;
}

export function toDisplayPath(virtualPath) {
  const normalized = sanitizeVirtualPath(virtualPath);
  if (normalized === DEFAULT_CWD || normalized.startsWith(`${DEFAULT_CWD}/`)) {
    const suffix = normalized.slice(DEFAULT_CWD.length);
    return suffix ? `~${suffix}` : "~";
  }
  return normalized;
}

export function withDisplay(command, result) {
  return {
    command,
    ...result,
    displayCwd: toDisplayPath(result.cwd),
  };
}

export function splitLines(raw) {
  const clean = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return clean.length ? clean.split("\n") : [];
}

export async function safeStat(realPath) {
  try {
    return await fsStat(realPath);
  } catch {
    return null;
  }
}

export async function ensureSandboxFilesystem() {
  const directories = [
    "/home/demo",
    "/home/demo/projects",
    "/home/demo/secrets",
    "/usr/bin",
    "/etc",
  ];

  const files = [
    {
      virtualPath: "/home/demo/README.md",
      content: [
        "# Welcome to the sandbox",
        "",
        "You are exploring a read-only environment managed by the gitgud terminal service.",
        "",
        "Try these commands:",
        "- help",
        "- ls",
        "- cat about.txt",
        "- cd projects",
        "- ls -la",
      ].join("\n"),
    },
    {
      virtualPath: "/home/demo/about.txt",
      content: [
        "User: sandbox-runner",
        "Role: Terminal explorer",
        "Shell: gitgudsh (restricted)",
        "Hint: Use `motd` for the message of the day.",
      ].join("\n"),
    },
    {
      virtualPath: "/home/demo/projects/README.md",
      content: [
        "# Projects",
        "",
        "- codex-terminal",
        "- potato-launcher",
        "- keyboard-navigator",
      ].join("\n"),
    },
    {
      virtualPath: "/home/demo/projects/nebula.log",
      content: [
        "== nebula status ==",
        "hyperdrive: ready",
        "shields: nominal",
        "cheese reserves: critical",
      ].join("\n"),
    },
    {
      virtualPath: "/home/demo/secrets/classified.txt",
      content: "Access denied. This sandbox is read-only.",
    },
    {
      virtualPath: config.motdVirtualPath,
      content: [
        "Welcome to gitgud.zip",
        "This sandbox resets between sessions and has no network access.",
      ].join("\n"),
    },
  ];

  for (const dir of directories) {
    const realDir = toRealPath(dir);
    await mkdir(realDir, { recursive: true });
  }

  await Promise.all(
    files.map(async ({ virtualPath, content }) => {
      const realFile = toRealPath(virtualPath);
      try {
        await access(realFile);
      } catch {
        await writeFile(realFile, content, { encoding: "utf-8", mode: 0o644 });
      }
    }),
  );
}

