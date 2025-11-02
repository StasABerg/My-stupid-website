import Fastify from "fastify";
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

function buildCorsHeaders(request) {
  const origin = request.headers?.origin;
  const allowedOrigin = resolveAllowedOrigin(origin);
  const headers = { Vary: "Origin" };
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  return headers;
}

function ensureCorsAllowed(request, reply, context = {}) {
  const origin = request.headers?.origin;
  if (!origin) {
    return true;
  }
  if (allowAllOrigins) {
    return true;
  }
  if (!allowedOrigins.includes(origin)) {
    reply
      .code(403)
      .headers({ "Content-Type": "application/json", Vary: "Origin" })
      .send({ message: "CORS origin denied" });
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

function handleOptions(request, reply) {
  const headers = {
    ...buildCorsHeaders(request),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };
  reply.code(204).headers(headers).send();
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

function createRequestContext(request) {
  const requestIdHeader = request.headers["x-request-id"];
  const requestId =
    typeof requestIdHeader === "string" && requestIdHeader.trim().length
      ? requestIdHeader
      : randomUUID();
  const baseContext = {
    requestId,
    method: request.method,
    url: request.raw.url,
    remoteAddress: request.raw.socket?.remoteAddress,
    origin: request.headers?.origin,
  };
  request.appContext = {
    baseContext,
    startedAt: process.hrtime.bigint(),
    completed: false,
  };
  logger.info("request.received", baseContext);
}

function completeRequest(request, statusCode, details = {}) {
  const context = request.appContext;
  if (!context || context.completed) {
    return;
  }
  context.completed = true;
  const durationMs = Number(process.hrtime.bigint() - context.startedAt) / 1_000_000;
  logger.info("request.completed", {
    ...context.baseContext,
    statusCode,
    durationMs,
    ...details,
  });
}

const fastify = Fastify({
  bodyLimit: MAX_PAYLOAD_BYTES,
});

fastify.addHook("onRequest", (request, _reply, done) => {
  createRequestContext(request);
  done();
});

fastify.addHook("preHandler", async (request, reply) => {
  const baseContext = request.appContext?.baseContext ?? {};
  if (request.method === "OPTIONS") {
    if (!ensureCorsAllowed(request, reply, baseContext)) {
      completeRequest(request, 403, { reason: "cors-denied" });
      return reply;
    }
    handleOptions(request, reply);
    completeRequest(request, 204, { route: "options" });
    return reply;
  }

  if (!ensureCorsAllowed(request, reply, baseContext)) {
    completeRequest(request, 403, { reason: "cors-denied" });
    return reply;
  }
});

fastify.addHook("onResponse", (request, reply, done) => {
  if (request.appContext && !request.appContext.completed) {
    completeRequest(request, reply.statusCode);
  }
  done();
});

fastify.setNotFoundHandler((request, reply) => {
  reply
    .code(404)
    .headers({
      "Content-Type": "application/json",
      ...buildCorsHeaders(request),
    })
    .send({ message: "Not Found" });
  completeRequest(request, 404, { reason: "not-found" });
});

fastify.setErrorHandler((error, request, reply) => {
  const baseContext = request.appContext?.baseContext ?? {};
  if (error.code === "FST_ERR_BODY_TOO_LARGE") {
    reply
      .code(413)
      .headers({
        "Content-Type": "application/json",
        ...buildCorsHeaders(request),
      })
      .send({ message: "Payload too large" });
    logger.warn("request.body_invalid", {
      ...baseContext,
      statusCode: 413,
      error,
    });
    completeRequest(request, 413, { route: "execute", reason: "invalid-body" });
    return;
  }
  if (error.code === "FST_ERR_CTP_INVALID_JSON") {
    reply
      .code(400)
      .headers({
        "Content-Type": "application/json",
        ...buildCorsHeaders(request),
      })
      .send({ message: "Invalid JSON payload" });
    logger.warn("request.body_invalid", {
      ...baseContext,
      statusCode: 400,
      error,
    });
    completeRequest(request, 400, { route: "execute", reason: "invalid-body" });
    return;
  }

  logger.error("request.unhandled_exception", {
    ...baseContext,
    error,
  });

  reply
    .code(500)
    .headers({
      "Content-Type": "application/json",
      ...buildCorsHeaders(request),
    })
    .send({ message: "Internal Server Error" });
  completeRequest(request, 500, { reason: "unhandled-exception" });
});

fastify.get("/healthz", async (request, reply) => {
  reply.send({ status: "ok" });
  completeRequest(request, 200, { route: "healthz" });
});

fastify.get("/info", async (request, reply) => {
  const response = await handleInfo();
  reply
    .code(response.status)
    .headers({
      "Content-Type": "application/json",
      ...buildCorsHeaders(request),
    })
    .send(response.payload);
  completeRequest(request, response.status, { route: "info" });
});

fastify.post("/execute", async (request, reply) => {
  const body = (request.body && typeof request.body === "object") ? request.body : {};
  const response = await handleExecute(body);
  reply
    .code(response.status)
    .headers({
      "Content-Type": "application/json",
      ...buildCorsHeaders(request),
    })
    .send(response.payload);
  completeRequest(request, response.status, { route: "execute" });
});

async function start() {
  try {
    await ensureSandboxFilesystem();
  } catch (error) {
    logger.error("sandbox.init_failed", { error });
    process.exitCode = 1;
    return;
  }

  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    logger.info("server.started", {
      port: PORT,
      sandboxRoot: SANDBOX_ROOT,
    });
  } catch (error) {
    logger.error("server.start_failed", { error });
    process.exit(1);
  }
}

start();

async function shutdown(signal) {
  logger.info("signal.received", { signal });
  try {
    await fastify.close();
  } catch (error) {
    logger.warn("server.close_failed", { error });
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    logger.error("shutdown.unhandled_error", { error });
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    logger.error("shutdown.unhandled_error", { error });
    process.exit(1);
  });
});
