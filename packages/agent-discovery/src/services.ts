/**
 * The public services Asterdoc advertises. Every URL here is a real hosted
 * resource: the Asterdoc Platform API and the hosted MCP server. Add an entry
 * only when the service exists.
 */

/** The two public hosts that publish discovery metadata. */
export const LANDING_ORIGIN = "https://asterdoc.com";
export const DOCS_ORIGIN = "https://docs.asterdoc.com";

/** Where the hosted Platform API answers (the `/v1` mount of api.asterdoc.com). */
export const PLATFORM_API_URL = "https://api.asterdoc.com/v1";
/** Unauthenticated liveness probe of the Platform API. */
export const PLATFORM_API_STATUS_URL = `${PLATFORM_API_URL}/health/live`;

/** The hosted MCP server (streamable HTTP). */
export const MCP_ORIGIN = "https://mcp.asterdoc.com";
export const MCP_URL = `${MCP_ORIGIN}/mcp`;
/** Unauthenticated health probe of the MCP worker. */
export const MCP_STATUS_URL = `${MCP_ORIGIN}/health`;
/** RFC 9728 protected-resource metadata served by the MCP worker. */
export const MCP_RESOURCE_METADATA_URL = `${MCP_ORIGIN}/.well-known/oauth-protected-resource`;
/** The hosted MCP server's version. The MCP service's tests fail when it drifts. */
export const MCP_SERVER_VERSION = "0.15";

export const API_CATALOG_PATH = "/.well-known/api-catalog";
export const SERVER_CARD_PATH = "/.well-known/mcp/server-card.json";
export const SKILLS_INDEX_PATH = "/.well-known/agent-skills/index.json";
