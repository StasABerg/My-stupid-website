import http from "node:http";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const posix = path.posix;

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const SANDBOX_ROOT = path.resolve(process.env.SANDBOX_ROOT ?? "/app/sandbox");
const COMMAND_TIMEOUT_MS = Number.parseInt(
  process.env.COMMAND_TIMEOUT_MS ?? "4000",
  10,
);
const MAX_PAYLOAD_BYTES = Number.parseInt(
  process.env.MAX_PAYLOAD_BYTES ?? "2048",
  10,
);
const MAX_OUTPUT_BYTES = Number.parseInt(
  process.env.MAX_OUTPUT_BYTES ?? "16384",
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

const SANDBOX_ENV = {
  PATH: "/usr/bin:/bin:/usr/local/bin",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
};

const sandboxRootWithSlash = `${SANDBOX_ROOT}${path.sep}`;

function log(message, extra = {}) {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    msg: message,
    ...extra,
  });
  console.log(payload);
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

async function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: SANDBOX_ENV,
      timeout: COMMAND_TIMEOUT_MS,
      ...options,
    });

    let stdout = "";
    let stderr = "";

    const abort = (reason) => {
      child.kill("SIGKILL");
      reject(reason);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) {
        abort(new Error("Command output limit exceeded"));
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT_BYTES) {
        abort(new Error("Command error output limit exceeded"));
      }
    });

    child.on("error", reject);

    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`Process terminated by signal ${signal}`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
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
  const { flags, pathArg } = parseLsArgs(args);
  const targetVirtual = pathArg
    ? resolveVirtualPath(currentVirtualCwd, pathArg)
    : currentVirtualCwd;
  const realTarget = toRealPath(targetVirtual);
  const targetStats = await stat(realTarget);

  if (targetStats.isDirectory()) {
    const result = await runProcess("ls", flags, { cwd: realTarget });
    const lines = splitLines(result.stdout || result.stderr);
    return {
      output: lines,
      error: result.code !== 0,
      cwd: currentVirtualCwd,
    };
  }

  const result = await runProcess("ls", [...flags, realTarget], {
    cwd: SANDBOX_ROOT,
  });
  const outputText = result.stdout || result.stderr;
  return {
    output: splitLines(outputText),
    error: result.code !== 0,
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

  const targetStats = await stat(realTarget);
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
  const targetStats = await stat(realTarget);

  if (!targetStats.isDirectory()) {
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
  const result = await runProcess("uname", flags, { cwd: SANDBOX_ROOT });
  return {
    output: splitLines(result.stdout || result.stderr),
    error: result.code !== 0,
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
    return {
      status: 200,
      payload: withDisplay(input, {
        cwd: sanitizeVirtualPath(cwd ?? DEFAULT_CWD),
        output: [],
        error: false,
      }),
    };
  }

  const currentVirtualCwd = sanitizeVirtualPath(cwd ?? DEFAULT_CWD);
  const [rawCommand, ...args] = trimmed.split(/\s+/);
  const command = rawCommand.toLowerCase();

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
}

function handleOptions(req, res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  });
  res.end();
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    req.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_PAYLOAD_BYTES) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
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
  try {
    if (req.method === "OPTIONS") {
      handleOptions(req, res);
      return;
    }

    if (req.url === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.url === "/info" && req.method === "GET") {
      const response = await handleInfo();
      res.writeHead(response.status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN ?? "*",
      });
      res.end(JSON.stringify(response.payload));
      return;
    }

    if (req.url === "/execute" && req.method === "POST") {
      const body = await parseJsonBody(req);
      const response = await handleExecute(body);
      res.writeHead(response.status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN ?? "*",
      });
      res.end(JSON.stringify(response.payload));
      return;
    }

    res.writeHead(404, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN ?? "*",
    });
    res.end(JSON.stringify({ message: "Not Found" }));
  } catch (error) {
    log("Request failed", { error: error.message });
    res.writeHead(500, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN ?? "*",
    });
    res.end(JSON.stringify({ message: "Internal Server Error" }));
  }
});

ensureSandboxFilesystem()
  .then(() => {
    server.listen(PORT, () => {
      log("Sandbox terminal service listening", {
        port: PORT,
        sandboxRoot: SANDBOX_ROOT,
      });
    });
  })
  .catch((error) => {
    log("Failed to initialize sandbox filesystem", { error: error.message });
    process.exitCode = 1;
  });

process.on("SIGTERM", () => {
  log("Received SIGTERM, closing server");
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  log("Received SIGINT, closing server");
  server.close(() => {
    process.exit(0);
  });
});
