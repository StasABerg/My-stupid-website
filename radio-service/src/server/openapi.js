const schemaIds = {
  station: "Station",
  stationListResponse: "StationListResponse",
  favoritesResponse: "FavoritesResponse",
  favoritesUpsertBody: "FavoritesUpsertBody",
  stationIdentifierParams: "StationIdentifierParams",
  stationsQuerystring: "StationsQuerystring",
};

export const schemaRefs = {
  station: `${schemaIds.station}#`,
  stationListResponse: `${schemaIds.stationListResponse}#`,
  favoritesResponse: `${schemaIds.favoritesResponse}#`,
  favoritesUpsertBody: `${schemaIds.favoritesUpsertBody}#`,
  stationIdentifierParams: `${schemaIds.stationIdentifierParams}#`,
  stationsQuerystring: `${schemaIds.stationsQuerystring}#`,
};

export function registerOpenApiSchemas(fastify) {
  fastify.addSchema({
    $id: schemaIds.station,
    type: "object",
    additionalProperties: false,
    required: ["id", "name", "streamUrl", "languages", "tags", "hls", "isOnline", "clickCount"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      streamUrl: { type: "string", format: "uri" },
      homepage: { type: ["string", "null"], format: "uri" },
      favicon: { type: ["string", "null"], format: "uri" },
      country: { type: ["string", "null"] },
      countryCode: { type: ["string", "null"], minLength: 2, maxLength: 3 },
      state: { type: ["string", "null"] },
      languages: {
        type: "array",
        items: { type: "string" },
      },
      tags: {
        type: "array",
        items: { type: "string" },
      },
      bitrate: { type: ["integer", "null"] },
      codec: { type: ["string", "null"] },
      hls: { type: "boolean" },
      isOnline: { type: "boolean" },
      clickCount: { type: "integer" },
    },
  });

  fastify.addSchema({
    $id: schemaIds.stationListResponse,
    type: "object",
    additionalProperties: false,
    required: ["meta", "items"],
    properties: {
      meta: {
        type: "object",
        additionalProperties: true,
        properties: {
          total: { type: "integer" },
          filtered: { type: "integer" },
          matches: { type: "integer" },
          hasMore: { type: "boolean" },
          page: { type: "integer" },
          limit: { type: "integer" },
          maxLimit: { type: ["integer", "null"] },
          requestedLimit: {
            anyOf: [
              { type: "integer" },
              { type: "string", enum: ["all"] },
              { type: "null" },
            ],
          },
          offset: { type: "integer" },
          cacheSource: { type: ["string", "null"] },
          origin: { type: ["string", "null"] },
          updatedAt: { type: ["string", "null"] },
          countries: {
            type: "array",
            items: { type: "string" },
          },
          genres: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      items: {
        type: "array",
        items: { $ref: schemaRefs.station },
      },
    },
  });

  fastify.addSchema({
    $id: schemaIds.favoritesResponse,
    type: "object",
    additionalProperties: false,
    required: ["meta", "items"],
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["maxSlots"],
        properties: {
          maxSlots: { type: "integer" },
        },
      },
      items: {
        type: "array",
        items: { $ref: schemaRefs.station },
      },
    },
  });

  fastify.addSchema({
    $id: schemaIds.favoritesUpsertBody,
    type: ["object", "null"],
    additionalProperties: false,
    properties: {
      slot: {
        type: "integer",
        minimum: 0,
        maximum: 5,
        description: "Optional slot index (0-based) to store the favorite in a fixed position.",
      },
    },
  });

  fastify.addSchema({
    $id: schemaIds.stationIdentifierParams,
    type: "object",
    additionalProperties: false,
    required: ["stationId"],
    properties: {
      stationId: {
        type: "string",
        minLength: 3,
        maxLength: 128,
        pattern: "^[A-Za-z0-9:_-]+$",
      },
    },
  });

  fastify.addSchema({
    $id: schemaIds.stationsQuerystring,
    type: "object",
    additionalProperties: true,
    properties: {
      refresh: {
        type: "string",
        enum: ["true"],
        description:
          "Force the service to refresh station data from the origin. Requires an Authorization: Bearer <token> header.",
      },
      limit: {
        anyOf: [
          {
            type: "string",
            enum: ["all"],
          },
          {
            type: "string",
            pattern: "^\\d+$",
          },
        ],
        description: "Maximum number of stations to return. Use \"all\" to request the maximum allowed page size.",
      },
      offset: {
        type: "string",
        pattern: "^\\d+$",
        description: "Offset to start returning stations from.",
      },
      page: {
        type: "string",
        pattern: "^\\d+$",
        description: "1-based page index to derive pagination offset.",
      },
      language: {
        type: "string",
        description: "Filter stations by a specific language.",
      },
      country: {
        type: "string",
        description: "Filter stations by a specific country or ISO code.",
      },
      tag: {
        type: "string",
        description: "Filter stations by tag label.",
      },
      genre: {
        type: "string",
        description: "Filter stations by genre label.",
      },
      search: {
        type: "string",
        description: "Full-text search term applied to station metadata.",
      },
    },
  });
}
