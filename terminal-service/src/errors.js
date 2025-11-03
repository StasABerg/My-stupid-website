export class SandboxError extends Error {
  constructor(message, { status = 400, code = "SANDBOX_ERROR" } = {}) {
    super(message);
    this.name = "SandboxError";
    this.status = status;
    this.code = code;
  }
}

