import rateLimit from "express-rate-limit";

export function createRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/healthz",
  });
}
