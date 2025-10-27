import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { logger } from "./logger.js";

const posix = path.posix;

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const SANDBOX_ROOT = path.resolve(process.env.SANDBOX_ROOT ?? "/app/sandbox");
const MAX_PAYLOAD_BYTES = Number.parseInt(
  process.env.MAX_PAYLOAD_BYTES ?? "2048",
  10,
);
const DEFAULT_CWD = sanitizeVirtualPath("/home/demo");
const HELP_TEXT = [
  "Available commands:",
  "  help       Show this help",
  "  clear      Clear the terminal output",
  "  ls [path]  List directory contents (flags: -a, -l, -la, -lh, -lah)",
  "  pwd        Print the current directory",
  "  whoami     Show the simulated user",
  "  cat FILE   Display a file inside the sandbox",
  "  cd DIR     Change the current directory",
  "  history    History is tracked in your browser",
  "  echo TEXT  Print the provided text",
  "  motd       Display the message of the day",
  "",
  "Commands run inside an isolated sandbox with no network access.",
];
const MOTD_VIRTUAL_PATH = "/etc/motd";

const LS_ALLOWED_FLAGS = new Set(["-a", "-l", "-la", "-al", "-lh", "-hl", "-lah", "-hal"]);
const UNAME_ALLOWED_FLAGS = new Set(["-a", "-s", "-r", "-m"]);

const allowedOrigins = (process.env.CORS_ALLOW_ORIGIN ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowAllOrigins = allowedOrigins.length === 0 || allowedOrigins.includes("*");

const sandboxRootWithSlash = `${SANDBOX_ROOT}${path.sep}`;

function resolveAllowedOrigin(origin) {
  if (!origin) {
    return null;
  }
  if (allowAllOrigins) {
    return origin;
  }
  return allowedOrigins.find((allowed) => allowed === origin) ?? null;
}

function buildCorsHeaders(req) {
  const origin = req.headers?.origin;
  const allowedOrigin = resolveAllowedOrigin(origin);
  const headers = { Vary: "Origin" };
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  return headers;
}

function ensureCorsAllowed(req, res, context = {}) {
  const origin = req.headers?.origin;
  if (!origin) {
    return true;
  }
  if (allowAllOrigins) {
    return true;
  }
  if (!allowedOrigins.includes(origin)) {
    res.writeHead(403, { "Content-Type": "application/json", Vary: "Origin" });
    res.end(JSON.stringify({ message: "CORS origin denied" }));
    logger.warn("cors.origin_denied", {
      ...context,
      origin,
      reason: "origin-not-allowed",
    });
    return false;
  }
  return true;
}

function sanitizeVirtualPath(input) {
  const candidate = input ? posix.normalize(input) : DEFAULT_CWD;
  if (!candidate.startsWith("/")) {
    throw new Error("Virtual paths must be absolute");
  }
  const withoutTrailingSlash = candidate.replace(/\/+$/, "") || "/";
  if (withoutTrailingSlash.includes("\0")) {
    throw new Error("Invalid path character detected");
  }
  return withoutTrailingSlash;
}

function resolveVirtualPath(current, input) {
  const base = sanitizeVirtualPath(current ?? DEFAULT_CWD);
  if (!input || input === ".") {
    return base;
  }
  const resolved = input.startsWith("/")
    ? sanitizeVirtualPath(input)
    : sanitizeVirtualPath(posix.resolve(base, input));
  return resolved;
}

function toRealPath(virtualPath) {
  const normalized = sanitizeVirtualPath(virtualPath);
  const resolved = path.resolve(SANDBOX_ROOT, `.${normalized}`);
  if (
    resolved !== SANDBOX_ROOT &&
    !resolved.startsWith(sandboxRootWithSlash)
  ) {
    throw new Error(`Resolved path escapes sandbox: ${virtualPath}`);
  }
  return resolved;
}

function toDisplayPath(virtualPath) {
  const normalized = sanitizeVirtualPath(virtualPath);
  if (normalized === "/home/demo" || normalized.startsWith("/home/demo/")) {
    const suffix = normalized.slice("/home/demo".length);
    return suffix ? `~${suffix}` : "~";
  }
  return normalized;
}

function withDisplay(command, result) {
  return {
    command,
    ...result,
    displayCwd: toDisplayPath(result.cwd),
  };
}

function splitLines(raw) {
  const clean = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return clean.length ? clean.split("\n") : [];
}

async function ensureSandboxFilesystem() {
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
      virtualPath: MOTD_VIRTUAL_PATH,
      content: [
        "Welcome to gitgud.qzz.io",
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

class SandboxError extends Error {
  constructor(message, { status = 400, code = "SANDBOX_ERROR" } = {}) {
    super(message);
    this.name = "SandboxError";
    this.status = status;
    this.code = code;
  }
}

function formatPermissions(stats) {
  const modes = [
    stats.isDirectory() ? "d" : "-",
    stats.mode & 0o400 ? "r" : "-",
    stats.mode & 0o200 ? "w" : "-",
    stats.mode & 0o100 ? "x" : "-",
    stats.mode & 0o040 ? "r" : "-",
    stats.mode & 0o020 ? "w" : "-",
    stats.mode & 0o010 ? "x" : "-",
    stats.mode & 0o004 ? "r" : "-",
    stats.mode & 0o002 ? "w" : "-",
    stats.mode & 0o001 ? "x" : "-",
  ];
  return modes.join("");
}

function formatHumanReadableSize(bytes) {
  const units = ["B", "K", "M", "G", "T"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? size : size.toFixed(1);
  return `${rounded}${units[unitIndex]}`;
}

function formatTimestamp(date) {
  const utcString = date.toUTCString(); // Example: "Mon, 08 Jul 2024 12:34:56 GMT"
  const parts = utcString.split(" ");
  if (parts.length < 5) {
    // Fallback to ISO formatting if the expected structure is unavailable
    return date.toISOString().replace("T", " ").slice(0, 16);
  }
  const [, dayRaw, month, timeRaw] = parts;
  const day = dayRaw.padStart(2, " ");
  const time = timeRaw.slice(0, 5);
  return `${month.padStart(3, " ")} ${day} ${time}`;
}

async function safeStat(realPath) {
  try {
    return await stat(realPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseLsArgs(args) {
  const flags = [];
  const positional = [];

  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (!LS_ALLOWED_FLAGS.has(arg)) {
        throw new Error(`Flag "${arg}" is not allowed`);
      }
      flags.push(arg);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error("ls accepts at most a single path in this sandbox");
  }

  return { flags, pathArg: positional[0] ?? null };
}

function parseUnameArgs(args) {
  const flags = [];
  for (const arg of args) {
    if (!UNAME_ALLOWED_FLAGS.has(arg)) {
      throw new Error(`Flag "${arg}" is not allowed`);
    }
    flags.push(arg);
  }
  return flags;
}

async function handleLs(currentVirtualCwd, args) {
  let parsed;
  try {
    parsed = parseLsArgs(args);
  } catch (error) {
    throw new SandboxError(error.message, { status: 422, code: "INVALID_FLAG" });
  }
  const { flags, pathArg } = parsed;
  const showAll = flags.some((flag) => flag.includes("a"));
  const longFormat = flags.some((flag) => flag.includes("l"));
  const humanReadable = flags.some((flag) => flag.includes("h"));
  const targetVirtual = pathArg
    ? resolveVirtualPath(currentVirtualCwd, pathArg)
    : currentVirtualCwd;
  const realTarget = toRealPath(targetVirtual);
  const targetStats = await safeStat(realTarget);

  if (!targetStats) {
    const label = pathArg ?? ".";
    throw new SandboxError(`ls: ${label}: No such file or directory`, {
      status: 404,
      code: "NOT_FOUND",
    });
  }

  if (targetStats.isDirectory()) {
    const dirEntries = await readdir(realTarget, { withFileTypes: true });
    const results = [];

    if (showAll) {
      results.push({ name: ".", stats: targetStats });
      const parentVirtual = resolveVirtualPath(targetVirtual, "..");
      const parentStats = await safeStat(toRealPath(parentVirtual));
      if (parentStats) {
        results.push({ name: "..", stats: parentStats });
      }
    }

    for (const dirent of dirEntries) {
      if (!showAll && dirent.name.startsWith(".")) {
        continue;
      }
      const entryStats = await safeStat(path.join(realTarget, dirent.name));
      if (!entryStats) continue;
      results.push({ name: dirent.name, stats: entryStats });
    }

    const formatted = results.map(({ name, stats }) => {
      if (!longFormat) {
        return name;
      }
      const permissions = formatPermissions(stats);
      const links = String(stats.nlink ?? 1).padStart(2, " ");
      const owner = String(stats.uid ?? 0).padEnd(5, " ");
      const group = String(stats.gid ?? 0).padEnd(5, " ");
      const sizeValue = humanReadable
        ? formatHumanReadableSize(stats.size ?? 0)
        : String(stats.size ?? 0);
      const size = sizeValue.toString().padStart(humanReadable ? 5 : 8, " ");
      const mtime = formatTimestamp(stats.mtime ?? new Date());
      return `${permissions} ${links} ${owner} ${group} ${size} ${mtime} ${name}`;
    });

    return {
      output: formatted,
      error: false,
      cwd: currentVirtualCwd,
    };
  }

  const name = pathArg ?? targetVirtual.split("/").pop() ?? targetVirtual;
  if (!longFormat) {
    return {
      output: [name],
      error: false,
      cwd: currentVirtualCwd,
    };
  }

  const permissions = formatPermissions(targetStats);
  const links = String(targetStats.nlink ?? 1).padStart(2, " ");
  const owner = String(targetStats.uid ?? 0).padEnd(5, " ");
  const group = String(targetStats.gid ?? 0).padEnd(5, " ");
  const sizeValue = humanReadable
    ? formatHumanReadableSize(targetStats.size ?? 0)
    : String(targetStats.size ?? 0);
  const size = sizeValue.toString().padStart(humanReadable ? 5 : 8, " ");
  const mtime = formatTimestamp(targetStats.mtime ?? new Date());
  return {
    output: [`${permissions} ${links} ${owner} ${group} ${size} ${mtime} ${name}`],
    error: false,
    cwd: currentVirtualCwd,
  };
}

async function handleCat(currentVirtualCwd, args) {
  if (!args.length) {
    return {
      output: ["cat: missing file operand"],
      error: true,
      cwd: currentVirtualCwd,
    };
  }

  if (args.length > 1) {
    return {
      output: ["cat: multiple files are not supported in this sandbox"],
      error: true,
      cwd: currentVirtualCwd,
    };
  }

  const targetVirtual = resolveVirtualPath(currentVirtualCwd, args[0]);
  const realTarget = toRealPath(targetVirtual);

  const targetStats = await safeStat(realTarget);
  if (!targetStats) {
    return {
      output: [`cat: ${args[0]}: No such file or directory`],
      error: true,
      cwd: currentVirtualCwd,
    };
  }

  if (!targetStats.isFile()) {
    return {
      output: [`cat: ${args[0]}: Not a regular file`],
      error: true,
      cwd: currentVirtualCwd,
    };
  }

  const contents = await readFile(realTarget, "utf-8");
  return {
    output: splitLines(contents),
    error: false,
    cwd: currentVirtualCwd,
  };
}

async function handleCd(currentVirtualCwd, args) {
  const targetArg = args[0];
  const nextVirtual = targetArg
    ? resolveVirtualPath(currentVirtualCwd, targetArg)
    : DEFAULT_CWD;
  const realTarget = toRealPath(nextVirtual);
  const targetStats = await safeStat(realTarget);

  if (!targetStats || !targetStats.isDirectory()) {
    return {
      output: [`cd: ${targetArg ?? ""}: Not a directory`],
      error: true,
      cwd: currentVirtualCwd,
    };
  }

  return {
    output: [],
    error: false,
    cwd: nextVirtual,
  };
}

async function handleMotd(currentVirtualCwd) {
  try {
    const contents = await readFile(toRealPath(MOTD_VIRTUAL_PATH), "utf-8");
    return {
      output: splitLines(contents),
      cwd: currentVirtualCwd,
      error: false,
    };
  } catch (error) {
    return {
      output: ["motd: Unable to read message of the day."],
      cwd: currentVirtualCwd,
      error: true,
    };
  }
}

async function handleUname(currentVirtualCwd, args) {
  const flags = parseUnameArgs(args);
  const kernelName = os.type();
  const release = os.release();
  const machine = os.arch();
  const hostname = os.hostname();
  const version = typeof os.version === "function" ? os.version() : "";

  let output;
  if (flags.includes("-a")) {
    output = `${kernelName} ${hostname} ${release} ${version} ${machine}`.trim();
  } else if (flags.includes("-r")) {
    output = release;
  } else if (flags.includes("-m")) {
    output = machine;
  } else if (flags.includes("-s")) {
    output = kernelName;
  } else {
    output = kernelName;
  }

  return {
    output: [output],
    error: false,
    cwd: currentVirtualCwd,
  };
}

async function handleExecute(body) {
  if (!body || typeof body !== "object") {
    return {
      status: 400,
      payload: { message: "Malformed JSON body" },
    };
  }

  const { input, cwd } = body;

  if (typeof input !== "string") {
    return {
      status: 422,
      payload: { message: "Field \"input\" must be a string" },
    };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    let sanitizedCwd;
    try {
      sanitizedCwd = sanitizeVirtualPath(cwd ?? DEFAULT_CWD);
    } catch {
      sanitizedCwd = DEFAULT_CWD;
    }
    return {
      status: 200,
      payload: withDisplay(input, {
        cwd: sanitizedCwd,
        output: [],
        error: false,
      }),
    };
  }

  let currentVirtualCwd;
  try {
    currentVirtualCwd = sanitizeVirtualPath(cwd ?? DEFAULT_CWD);
  } catch {
    throw new SandboxError("Invalid working directory", {
      status: 422,
      code: "INVALID_CWD",
    });
  }
  const [rawCommand, ...args] = trimmed.split(/\s+/);
  const command = rawCommand.toLowerCase();

  try {
    switch (command) {
      case "help":
        return {
          status: 200,
          payload: withDisplay(input, {
            output: HELP_TEXT,
            error: false,
            cwd: currentVirtualCwd,
          }),
        };
      case "clear":
        return {
          status: 200,
          payload: withDisplay(input, {
            output: [],
            error: false,
            cwd: currentVirtualCwd,
            clear: true,
          }),
        };
      case "ls":
        return {
          status: 200,
          payload: withDisplay(input, await handleLs(currentVirtualCwd, args)),
        };
      case "pwd":
        return {
          status: 200,
          payload: withDisplay(input, {
            output: [toDisplayPath(currentVirtualCwd)],
            error: false,
            cwd: currentVirtualCwd,
          }),
        };
      case "whoami":
        return {
          status: 200,
          payload: withDisplay(input, {
            output: ["sandbox-runner"],
            error: false,
            cwd: currentVirtualCwd,
          }),
        };
      case "cat":
        return {
          status: 200,
          payload: withDisplay(input, await handleCat(currentVirtualCwd, args)),
        };
      case "cd":
        return {
          status: 200,
          payload: withDisplay(input, await handleCd(currentVirtualCwd, args)),
        };
      case "history":
        return {
          status: 200,
          payload: withDisplay(input, {
            output: ["History is tracked client-side for each session."],
            error: false,
            cwd: currentVirtualCwd,
          }),
        };
      case "echo":
        return {
          status: 200,
          payload: withDisplay(input, {
            output: [args.join(" ")],
            error: false,
            cwd: currentVirtualCwd,
          }),
        };
      case "motd":
        return {
          status: 200,
          payload: withDisplay(input, await handleMotd(currentVirtualCwd)),
        };
      case "uname":
        return {
          status: 200,
          payload: withDisplay(input, await handleUname(currentVirtualCwd, args)),
        };
      default:
        return {
          status: 400,
          payload: withDisplay(input, {
            output: [
              `Command "${command}" is not available in this sandbox.`,
              "Type `help` to see supported commands.",
            ],
            error: true,
            cwd: currentVirtualCwd,
          }),
        };
    }
  } catch (error) {
    if (error instanceof SandboxError) {
      return {
        status: error.status,
        payload: withDisplay(input, {
          output: [error.message],
          error: true,
          cwd: currentVirtualCwd,
        }),
      };
    }
    logger.error("command.unhandled_error", {
      command,
      error: error instanceof Error ? error : { message: String(error) },
    });
    return {
      status: 500,
      payload: withDisplay(input, {
        output: ["Command failed due to an unexpected error."],
        error: true,
        cwd: currentVirtualCwd,
      }),
    };
  }
}

function handleOptions(req, res) {
  if (!ensureCorsAllowed(req, res)) {
    return;
  }
  const headers = {
    ...buildCorsHeaders(req),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };
  res.writeHead(204, headers);
  res.end();
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let tooLarge = false;

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (tooLarge) {
        return;
      }
      buffer += chunk;
      if (buffer.length > MAX_PAYLOAD_BYTES) {
        tooLarge = true;
      }
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new Error("Payload too large"));
        return;
      }
      if (!buffer) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(buffer);
        resolve(parsed);
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

async function handleInfo() {
  return {
    status: 200,
    payload: {
      displayCwd: toDisplayPath(DEFAULT_CWD),
      virtualCwd: DEFAULT_CWD,
      supportedCommands: [
        "help",
        "clear",
        "ls",
        "pwd",
        "whoami",
        "cat",
        "cd",
        "history",
        "echo",
        "motd",
        "uname",
      ],
      motd: await handleMotd(DEFAULT_CWD).then((result) => result.output),
    },
  };
}

const server = http.createServer(async (req, res) => {
  const requestIdHeader = req.headers["x-request-id"];
  const requestId =
    typeof requestIdHeader === "string" && requestIdHeader.trim().length
      ? requestIdHeader
      : randomUUID();
  const requestStartedAt = process.hrtime.bigint();
  const baseContext = {
    requestId,
    method: req.method,
    url: req.url,
    remoteAddress: req.socket?.remoteAddress,
    origin: req.headers?.origin,
  };

  const complete = (statusCode, details = {}) => {
    const durationMs = Number(process.hrtime.bigint() - requestStartedAt) / 1_000_000;
    logger.info("request.completed", {
      ...baseContext,
      statusCode,
      durationMs,
      ...details,
    });
  };

  logger.info("request.received", baseContext);

  try {
    if (req.method === "OPTIONS") {
      if (!ensureCorsAllowed(req, res, baseContext)) {
        complete(403, { reason: "cors-denied" });
        return;
      }
      handleOptions(req, res);
      complete(204, { route: "options" });
      return;
    }

    if (!ensureCorsAllowed(req, res, baseContext)) {
      complete(403, { reason: "cors-denied" });
      return;
    }

    if (req.url === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      const payload = { status: "ok" };
      res.end(JSON.stringify(payload));
      complete(200, { route: "healthz" });
      return;
    }

    if (req.url === "/info" && req.method === "GET") {
      const response = await handleInfo();
      res.writeHead(response.status, {
        "Content-Type": "application/json",
        ...buildCorsHeaders(req),
      });
      res.end(JSON.stringify(response.payload));
      complete(response.status, { route: "info" });
      return;
    }

    if (req.url === "/execute" && req.method === "POST") {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to parse request body";
        const status = message === "Payload too large" ? 413 : 400;
        res.writeHead(status, {
          "Content-Type": "application/json",
          ...buildCorsHeaders(req),
        });
        res.end(JSON.stringify({ message }));
        logger.warn("request.body_invalid", {
          ...baseContext,
          statusCode: status,
          error: error instanceof Error ? error : { message },
        });
        complete(status, { route: "execute", reason: "invalid-body" });
        return;
      }

      const response = await handleExecute(body);
      res.writeHead(response.status, {
        "Content-Type": "application/json",
        ...buildCorsHeaders(req),
      });
      res.end(JSON.stringify(response.payload));
      complete(response.status, { route: "execute" });
      return;
    }

    res.writeHead(404, {
      "Content-Type": "application/json",
      ...buildCorsHeaders(req),
    });
    res.end(JSON.stringify({ message: "Not Found" }));
    logger.warn("request.not_found", baseContext);
    complete(404, { reason: "not-found" });
  } catch (error) {
    logger.error("request.unhandled_exception", {
      ...baseContext,
      error,
    });
    res.writeHead(500, {
      "Content-Type": "application/json",
      ...buildCorsHeaders(req),
    });
    res.end(JSON.stringify({ message: "Internal Server Error" }));
    complete(500, { reason: "unhandled-exception" });
  }
});

ensureSandboxFilesystem()
  .then(() => {
    server.listen(PORT, () => {
      logger.info("server.started", {
        port: PORT,
        sandboxRoot: SANDBOX_ROOT,
      });
    });
  })
  .catch((error) => {
    logger.error("sandbox.init_failed", { error });
    process.exitCode = 1;
  });

process.on("SIGTERM", () => {
  logger.info("signal.received", { signal: "SIGTERM" });
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("signal.received", { signal: "SIGINT" });
  server.close(() => {
    process.exit(0);
  });
});
