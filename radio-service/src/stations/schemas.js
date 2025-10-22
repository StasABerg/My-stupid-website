import { z } from "zod";

export const SCHEMA_VERSION = 3;

export const stationSchema = z.object({
  stationuuid: z.string(),
  name: z.string().min(1),
  url: z.string().url().or(z.string().min(1)),
  url_resolved: z.string().optional(),
  homepage: z.string().nullable().optional(),
  favicon: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  countrycode: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  geo_lat: z.coerce.number().nullable().optional(),
  geo_long: z.coerce.number().nullable().optional(),
  bitrate: z.coerce.number().nullable().optional(),
  codec: z.string().nullable().optional(),
  lastcheckok: z.coerce.number().nullable().optional(),
  ssl_error: z.coerce.number().nullable().optional(),
  lastchecktime: z.string().nullable().optional(),
  lastchangetime: z.string().nullable().optional(),
  clickcount: z.coerce.number().nullable().optional(),
  clicktrend: z.coerce.number().nullable().optional(),
  votes: z.coerce.number().nullable().optional(),
  hls: z.coerce.number().nullable().optional(),
});
