const HEADER_NAME = "authorization";

function extractAuthorizationHeader(req) {
  const value = req.get?.(HEADER_NAME);
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value;
}

export function createServiceAuthMiddleware(expectedToken) {
  if (!expectedToken) {
    throw new Error("createServiceAuthMiddleware requires a non-empty token");
  }
  const expectedHeader = `Bearer ${expectedToken}`;

  return function requireServiceAuth(req, res, next) {
    const provided = extractAuthorizationHeader(req);
    if (typeof provided !== "string" || provided !== expectedHeader) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
