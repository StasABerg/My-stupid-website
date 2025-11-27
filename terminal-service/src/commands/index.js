import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { SandboxError } from "../errors.js";
import {
  DEFAULT_CWD,
  resolveVirtualPath,
  sanitizeVirtualPath,
  splitLines,
  toDisplayPath,
  toRealPath,
  withDisplay,
  safeStat,
} from "../sandbox/filesystem.js";

const LS_ALLOWED_FLAGS = new Set(config.lsAllowedFlags);
const UNAME_ALLOWED_FLAGS = new Set(config.unameAllowedFlags);
const MAX_COMMAND_LENGTH = 256;
const MAX_ARGS = 32;

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
  const utcString = date.toUTCString();
  const parts = utcString.split(" ");
  if (parts.length < 5) {
    return date.toISOString().replace("T", " ").slice(0, 16);
  }
  const [, dayRaw, month, timeRaw] = parts;
  const day = dayRaw.padStart(2, " ");
  const time = timeRaw.slice(0, 5);
  return `${month.padStart(3, " ")} ${day} ${time}`;
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
  const realPath = toRealPath(targetVirtual);
  try {
    const content = await readFile(realPath, { encoding: "utf-8" });
    return {
      output: splitLines(content),
      error: false,
      cwd: currentVirtualCwd,
    };
  } catch (error) {
    return {
      output: [`cat: ${args[0]}: ${error.code === "ENOENT" ? "No such file" : "Cannot read file"}`],
      error: true,
      cwd: currentVirtualCwd,
    };
  }
}

async function handleCd(currentVirtualCwd, args) {
  if (!args.length) {
    return {
      output: [],
      error: false,
      cwd: DEFAULT_CWD,
    };
  }
  if (args.length > 1) {
    throw new SandboxError("cd: too many arguments", { status: 422, code: "INVALID_ARG" });
  }
  const targetVirtual = resolveVirtualPath(currentVirtualCwd, args[0]);
  const realPath = toRealPath(targetVirtual);
  const stats = await safeStat(realPath);
  if (!stats || !stats.isDirectory()) {
    throw new SandboxError(`cd: ${args[0]}: No such directory`, { status: 404, code: "NOT_FOUND" });
  }
  return {
    output: [],
    error: false,
    cwd: targetVirtual,
  };
}

async function handleMotd(currentVirtualCwd, motdProvider) {
  try {
    const motd = await motdProvider();
    return {
      output: motd,
      error: false,
      cwd: currentVirtualCwd,
    };
  } catch (error) {
    return {
      output: ["motd: Failed to read message of the day."],
      error: true,
      cwd: currentVirtualCwd,
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

async function handleExecute(body, { motdProvider }) {
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
      payload: { message: 'Field "input" must be a string' },
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

  if (trimmed.length > MAX_COMMAND_LENGTH) {
    return {
      status: 422,
      payload: { message: `Command length exceeds limit of ${MAX_COMMAND_LENGTH}` },
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

  if (args.length > MAX_ARGS) {
    return {
      status: 422,
      payload: { message: `Too many arguments; maximum is ${MAX_ARGS}` },
    };
  }

  try {
    switch (command) {
      case "help":
        return {
          status: 200,
          payload: withDisplay(input, {
            output: config.helpText,
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
          payload: withDisplay(input, await handleMotd(currentVirtualCwd, motdProvider)),
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
    throw error;
  }
}

async function handleInfo(motd) {
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
      motd,
    },
  };
}

export function createCommandHandlers() {
  return {
    handleExecute,
    handleInfo,
  };
}
