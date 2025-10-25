import { z } from "zod";

const MAX_LIMIT_DIGITS = 5;
const MAX_PAGINATION_DIGITS = 6;
const MAX_FILTER_LENGTH = 128;
const MAX_SEARCH_LENGTH = 160;

const querySchema = z
  .object({
    refresh: z.enum(["true"], { invalid_type_error: "refresh must be \"true\"" }).optional(),
    limit: z
      .union([
        z.literal("all"),
        z
          .string()
          .regex(/^\d+$/, { message: "limit must be a whole number" })
          .max(MAX_LIMIT_DIGITS),
      ])
      .optional(),
    offset: z
      .string()
      .regex(/^\d+$/, { message: "offset must be a whole number" })
      .max(MAX_PAGINATION_DIGITS)
      .optional(),
    page: z
      .string()
      .regex(/^\d+$/, { message: "page must be a whole number" })
      .max(MAX_PAGINATION_DIGITS)
      .optional(),
    language: z.string().trim().max(MAX_FILTER_LENGTH).optional(),
    country: z.string().trim().max(MAX_FILTER_LENGTH).optional(),
    tag: z.string().trim().max(MAX_FILTER_LENGTH).optional(),
    genre: z.string().trim().max(MAX_FILTER_LENGTH).optional(),
    search: z.string().trim().max(MAX_SEARCH_LENGTH).optional(),
  })
  .strict();

function firstValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : undefined;
  }
  return value;
}

function normalizeFilterValue(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSearchValue(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

export function parseStationsQuery(rawQuery, { config }) {
  const candidate = {};
  for (const [key, value] of Object.entries(rawQuery ?? {})) {
    const resolved = firstValue(value);
    if (typeof resolved === "string") {
      candidate[key] = resolved;
    }
  }

  const parsed = querySchema.safeParse(candidate);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => issue.message);
    return { ok: false, errors: messages };
  }

  const data = parsed.data;

  const forceRefresh = data.refresh === "true";

  const maxPageSize = Math.max(1, config.api.maxPageSize);
  const defaultPageSize = Math.min(maxPageSize, Math.max(1, config.api.defaultPageSize));

  let limit = defaultPageSize;
  let requestedLimit = null;
  if (data.limit === "all") {
    requestedLimit = "all";
    limit = maxPageSize;
  } else if (data.limit) {
    const numericLimit = Number.parseInt(data.limit, 10);
    if (Number.isFinite(numericLimit) && numericLimit > 0) {
      requestedLimit = numericLimit;
      limit = Math.min(numericLimit, maxPageSize);
    }
  }

  const rawOffset = data.offset ? Number.parseInt(data.offset, 10) : Number.NaN;
  const offsetCandidate = Number.isFinite(rawOffset) ? rawOffset : null;

  const rawPage = data.page ? Number.parseInt(data.page, 10) : Number.NaN;
  const pageCandidate = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : null;

  const derivedOffset =
    offsetCandidate !== null
      ? offsetCandidate
      : pageCandidate !== null
        ? (pageCandidate - 1) * limit
        : 0;
  const offset = Math.max(0, Number.isFinite(derivedOffset) ? derivedOffset : 0);
  const page = limit > 0 ? Math.floor(offset / limit) + 1 : 1;

  const filters = {
    language: normalizeFilterValue(data.language),
    country: normalizeFilterValue(data.country),
    tag: normalizeFilterValue(data.tag),
    genre: normalizeFilterValue(data.genre),
    search: normalizeSearchValue(data.search),
  };

  return {
    ok: true,
    value: {
      forceRefresh,
      pagination: {
        limit,
        offset,
        page,
        requestedLimit,
      },
      filters,
    },
  };
}
