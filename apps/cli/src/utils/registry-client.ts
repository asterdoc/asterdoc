/**
 * Registry Client Utility
 *
 * Handles HTTP requests to artifact registries with persistent caching.
 */

import type {
  RegistryIndex,
  RegistryItemSummary,
  ResolvedRegistry,
} from '../types.js'
import { fetch } from 'undici'
import type { RegistryRelease } from '../types.js'
import {
  buildRegistryIndexUrl,
  buildReleaseUrl,
  buildLayerFileUrl,
} from './registry.js'
import {
  SECURITY_LIMITS,
  NETWORK_TIMEOUTS,
  validateArtifactContentType,
  validateLayerContentType,
  DEFAULT_ALLOWED_CONTENT_TYPES,
} from './constants.js'
import { sanitizeForDisplay, validateUrl } from './security.js'
import { cacheManager, type CacheResult } from './cache.js'
import { formatBytes } from './format.js'
import { computeHashFromContent } from './hash.js'
import { checkRegistryManifest, parseRegistryManifest } from './registry-manifest.js'
import { parse } from '@asterdoc/core'

/**
 * ContentRef from a registry item (inline text or file reference)
 */
export type RegistryContentRef =
  | { kind: 'inline'; text: string }
  | { kind: 'file'; path: string; mimeType: string; checksum?: string }

/**
 * Registry item with full details: the artifact file of one release, fetched
 * from the path the manifest lists for it.
 *
 * A registry serves the artifact itself, flat, as `asterdoc registry compile`
 * writes it. `tags` and a file layer's `url` are registry metadata that the
 * installed artifact does not carry.
 */
export interface RegistryItem {
  $schema?: string
  name: string
  kind: 'form' | 'document' | 'checklist' | 'bundle'
  version: string
  edition?: { key: string; label: string; date?: string; effectiveFrom?: string }
  title?: string
  description?: string
  tags?: string[]
  layers?: Record<string, RegistryLayerInfo>
  instructions?: RegistryContentRef
  agentInstructions?: RegistryContentRef
}

/**
 * Base layer information shared by all layer types
 */
interface RegistryLayerBase {
  mimeType: string
  title?: string
  description?: string
  checksum?: string
}

/**
 * Inline layer with embedded text content
 */
export interface RegistryInlineLayer extends RegistryLayerBase {
  kind: 'inline'
  text: string
}

/**
 * File-backed layer referenced by path
 */
export interface RegistryFileLayer extends RegistryLayerBase {
  kind: 'file'
  path: string
  /** Download URL a registry may publish; registry metadata, never installed. */
  url?: string
  /** Font a PDF layer draws with; downloaded beside the layer file. */
  font?: { path: string; checksum?: string }
  /** PDF layers only: AcroForm field name to Asterdoc path. */
  bindings?: Record<string, string>
  /** PDF layers only: key of a sibling PDF layer whose bindings this layer reuses. */
  bindingsFrom?: string
}

/**
 * Layer information from registry item
 */
export type RegistryLayerInfo = RegistryInlineLayer | RegistryFileLayer

/**
 * Fetch error with status code
 */
export class RegistryFetchError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public url?: string
  ) {
    super(message)
    this.name = 'RegistryFetchError'
  }
}

/**
 * Error thrown when file size exceeds the limit
 */
export class FileSizeExceededError extends Error {
  constructor(
    message: string,
    public url: string,
    public size: number,
    public limit: number
  ) {
    super(message)
    this.name = 'FileSizeExceededError'
  }
}

/**
 * Error thrown when request times out
 */
export class RequestTimeoutError extends Error {
  constructor(message: string, public url: string) {
    super(message)
    this.name = 'RequestTimeoutError'
  }
}

/**
 * Error thrown when URL validation fails (SSRF protection, invalid scheme, etc.)
 */
export class UrlValidationError extends Error {
  constructor(message: string, public url: string) {
    super(message)
    this.name = 'UrlValidationError'
  }
}

/**
 * Error thrown when content type validation fails
 */
export class ContentTypeError extends Error {
  constructor(
    message: string,
    public url: string,
    public contentType: string
  ) {
    super(message)
    this.name = 'ContentTypeError'
  }
}

/**
 * Error thrown when a downloaded artifact file is not the release the
 * manifest lists: its bytes do not match the checksum, or the artifact names
 * another name, version or edition.
 */
export class RegistryReleaseMismatchError extends Error {
  constructor(message: string, public url: string) {
    super(message)
    this.name = 'RegistryReleaseMismatchError'
  }
}

/**
 * Validate a URL before making a request
 * @throws UrlValidationError if URL is invalid or blocked
 */
function assertValidUrl(url: string): string[] {
  const result = validateUrl(url)

  if (!result.valid) {
    throw new UrlValidationError(result.error || 'Invalid URL', url)
  }

  return result.warnings
}

/**
 * Check Content-Length header and throw if exceeds limit
 */
type RegistryResponse = Awaited<ReturnType<typeof fetch>>

function checkContentLength(response: RegistryResponse, url: string, maxSize: number): void {
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const size = parseInt(contentLength, 10)
    if (!isNaN(size) && size > maxSize) {
      throw new FileSizeExceededError(
        `File size (${formatBytes(size)}) exceeds limit (${formatBytes(maxSize)})`,
        url,
        size,
        maxSize
      )
    }
  }
}

/**
 * Read a response body, refusing it once it grows past maxSize
 * (covers streaming responses without Content-Length)
 */
async function readBytesWithSizeLimit(response: RegistryResponse, url: string, maxSize: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader()
  if (!reader) {
    return new Uint8Array(await response.arrayBuffer())
  }

  const chunks: Uint8Array[] = []
  let totalSize = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    totalSize += value.length
    if (totalSize > maxSize) {
      reader.cancel()
      throw new FileSizeExceededError(
        `Download size (>${formatBytes(totalSize)}) exceeds limit (${formatBytes(maxSize)})`,
        url,
        totalSize,
        maxSize
      )
    }
    chunks.push(value)
  }

  const allChunks = new Uint8Array(totalSize)
  let position = 0
  for (const chunk of chunks) {
    allChunks.set(chunk, position)
    position += chunk.length
  }

  return allChunks
}

/**
 * Limits and checks applied to one registry request
 */
interface FetchLimits {
  /** Abort the request if response headers do not arrive within this time. */
  timeoutMs: number
  /** Largest body accepted, by Content-Length and by bytes read. */
  maxSize: number
  headers?: Record<string, string>
  /** Returns an error message when the response Content-Type is not accepted. */
  validateContentType: (contentType: string) => string | null
}

/**
 * Fetch a URL and read its body as bytes, enforcing URL validation, timeout,
 * status, content-type, and size limits
 */
async function fetchBytesWithLimits(url: string, limits: FetchLimits): Promise<Uint8Array<ArrayBuffer>> {
  // Validate URL before making request
  const warnings = assertValidUrl(url)
  if (warnings.length > 0) {
    // Log warnings to stderr (they'll be visible but not break the operation)
    warnings.forEach((w) => console.warn(`Warning: ${w}`))
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), limits.timeoutMs)

  try {
    const response = await fetch(url, {
      headers: { ...limits.headers },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new RegistryFetchError(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
        response.status,
        url
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    const contentTypeError = limits.validateContentType(contentType)
    if (contentTypeError) {
      throw new ContentTypeError(contentTypeError, url, contentType)
    }

    // Check Content-Length before downloading
    checkContentLength(response, url, limits.maxSize)

    const bytes = await readBytesWithSizeLimit(response, url, limits.maxSize)
    clearTimeout(timeoutId)
    return bytes
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RequestTimeoutError(`Request timed out after ${limits.timeoutMs}ms`, url)
    }
    throw error
  }
}

function sanitizeRegistryItem(item: RegistryItem): RegistryItem {
  return {
    ...item,
    name: sanitizeForDisplay(item.name),
    kind: sanitizeForDisplay(item.kind) as RegistryItem['kind'],
    version: sanitizeForDisplay(item.version),
    title: item.title === undefined ? undefined : sanitizeForDisplay(item.title),
    description: item.description === undefined ? undefined : sanitizeForDisplay(item.description),
    tags: item.tags?.map(sanitizeForDisplay),
    ...(item.layers && !Array.isArray(item.layers) ? {
      layers: Object.fromEntries(Object.entries(item.layers).map(([name, layer]) => [name, {
        ...layer,
        title: layer.title === undefined ? undefined : sanitizeForDisplay(layer.title),
        description: layer.description === undefined ? undefined : sanitizeForDisplay(layer.description),
      }]))
    } : {}),
  }
}

/**
 * Sanitize the free text of a manifest item for display. Names, edition keys,
 * versions and paths need none: the manifest schema restricts their characters.
 */
function sanitizeRegistryItemSummary(item: RegistryItemSummary): RegistryItemSummary {
  const text = {
    ...(item.title !== undefined && { title: sanitizeForDisplay(item.title) }),
    ...(item.description !== undefined && { description: sanitizeForDisplay(item.description) }),
    ...(item.tags !== undefined && { tags: item.tags.map(sanitizeForDisplay) }),
    ...(item.layers !== undefined && { layers: item.layers.map(sanitizeForDisplay) }),
  }
  if (item.editions === undefined) return { ...item, ...text }
  return {
    ...item,
    ...text,
    editions: Object.fromEntries(Object.entries(item.editions).map(([key, edition]) => [key, {
      ...edition,
      label: sanitizeForDisplay(edition.label),
    }])),
  }
}

function sanitizeRegistryIndex(index: RegistryIndex): RegistryIndex {
  return {
    ...index,
    ...(index.description !== undefined && { description: sanitizeForDisplay(index.description) }),
    ...(index.homepage !== undefined && { homepage: sanitizeForDisplay(index.homepage) }),
    items: index.items.map(sanitizeRegistryItemSummary),
  }
}

/**
 * Refuse an artifact file that is not the release the manifest lists: the
 * artifact's own name, version and edition key must be the release's.
 */
function assertReleaseIdentity(artifact: unknown, name: string, release: RegistryRelease, url: string): void {
  const record = typeof artifact === 'object' && artifact !== null && !Array.isArray(artifact)
    ? artifact as Record<string, unknown>
    : {}
  const edition = typeof record.edition === 'object' && record.edition !== null
    ? (record.edition as Record<string, unknown>).key
    : undefined

  const mismatches: string[] = []
  const expect = (label: string, expected: string, actual: unknown) => {
    if (actual !== expected) {
      const got = typeof actual === 'string' ? `"${sanitizeForDisplay(actual)}"` : 'none'
      mismatches.push(`${label} "${expected}" expected, the file has ${got}`)
    }
  }
  expect('name', name, record.name)
  expect('version', release.version, record.version)
  if (release.edition !== null) expect('edition', release.edition.key, edition)

  if (mismatches.length > 0) {
    throw new RegistryReleaseMismatchError(
      `The file at ${url} is not the release the registry manifest lists: ${mismatches.join('; ')}.`,
      url,
    )
  }
}

/**
 * Fetch the bytes of registry JSON or YAML (manifest or artifact file); the
 * body must be a JSON or YAML content type
 */
async function fetchJsonBytes(
  url: string,
  headers: Record<string, string> | undefined,
  maxSize: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return fetchBytesWithLimits(url, {
    timeoutMs: NETWORK_TIMEOUTS.CONNECT_TIMEOUT,
    maxSize,
    headers: { Accept: 'application/json', ...headers },
    validateContentType: validateArtifactContentType,
  })
}

const parseBytes = (bytes: Uint8Array): unknown => parse(new TextDecoder().decode(bytes))

/**
 * Fetch layer bytes; the body must be one of the allowed layer content types
 */
async function fetchLayerBytes(
  url: string,
  headers: Record<string, string> | undefined,
  allowedContentTypes: readonly string[],
): Promise<Uint8Array<ArrayBuffer>> {
  return fetchBytesWithLimits(url, {
    timeoutMs: NETWORK_TIMEOUTS.DOWNLOAD_TIMEOUT,
    maxSize: SECURITY_LIMITS.MAX_LAYER_SIZE,
    headers,
    validateContentType: (contentType) => validateLayerContentType(contentType, allowedContentTypes),
  })
}

/**
 * Options for fetching with cache
 */
export interface FetchOptions {
  /** Cache TTL in seconds. 0 disables caching. */
  cacheTtl?: number
  /** Skip cache and fetch fresh. */
  skipCache?: boolean
}

/**
 * Registry Client for fetching artifacts from registries
 */
export class RegistryClient {
  // In-memory cache for current session (faster than disk for repeated lookups)
  private sessionCache: Map<string, RegistryIndex> = new Map()
  private cacheInitialized = false

  /**
   * Initialize the cache manager with configuration
   * @param config - Cache configuration
   */
  async initCache(config?: { directory?: string; defaultTtl?: number }): Promise<void> {
    if (!this.cacheInitialized) {
      await cacheManager.init(config)
      this.cacheInitialized = true
    }
  }

  /**
   * Fetch the registry manifest (every artifact, with its editions and versions)
   * Uses persistent cache with configurable TTL. The manifest is checked
   * against the registry.json schema; one that breaks it is refused.
   *
   * @param registry - Resolved registry configuration
   * @param options - Fetch options including cache TTL
   */
  async fetchIndex(registry: ResolvedRegistry, options?: FetchOptions): Promise<RegistryIndex> {
    const url = buildRegistryIndexUrl(registry)
    const ttl = options?.cacheTtl

    // Check session cache first (fastest)
    if (!options?.skipCache) {
      const sessionCached = this.sessionCache.get(url)
      if (sessionCached) {
        return sessionCached
      }
    }

    // Initialize cache if not already done
    if (!this.cacheInitialized) {
      await this.initCache()
    }

    // Check persistent cache (if not skipping)
    if (!options?.skipCache && ttl !== 0) {
      const cacheResult: CacheResult<unknown> = await cacheManager.get<unknown>(url, ttl)
      // A cached entry that is not a valid manifest is not used; the network copy is.
      const cached = cacheResult.hit ? checkRegistryManifest(cacheResult.data) : undefined
      if (cached?.ok) {
        const sanitized = sanitizeRegistryIndex(cached.manifest)
        // Store in session cache for fast repeated access
        this.sessionCache.set(url, sanitized)
        return sanitized
      }
    }

    // Fetch from network
    const bytes = await fetchJsonBytes(url, registry.headers, SECURITY_LIMITS.MAX_INDEX_SIZE)
    const index = sanitizeRegistryIndex(parseRegistryManifest(parseBytes(bytes), url))

    // Store in persistent cache (if caching is enabled)
    if (ttl !== 0) {
      await cacheManager.set(url, index, ttl)
    }

    // Store in session cache
    this.sessionCache.set(url, index)

    return index
  }

  /**
   * Invalidate cache for a registry
   * @param registry - Registry to invalidate cache for
   */
  async invalidateCache(registry: ResolvedRegistry): Promise<boolean> {
    const url = buildRegistryIndexUrl(registry)
    this.sessionCache.delete(url)
    return cacheManager.invalidate(url)
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<{ deleted: number; errors: number }> {
    this.sessionCache.clear()
    return cacheManager.clear()
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    directory: string
    defaultTtl: number
    entries: number
    totalSize: number
    sessionEntries: number
  }> {
    const stats = await cacheManager.stats()
    return {
      ...stats,
      sessionEntries: this.sessionCache.size,
    }
  }

  /**
   * Fetch the artifact file of one release and check it is that release:
   * the bytes must match the manifest's SHA-256, and the artifact's own name,
   * version and edition must be the release's.
   * @param registry - Resolved registry configuration
   * @param artifactName - Name of the manifest item
   * @param release - The release, from `resolveRegistryRelease`
   * @throws RegistryReleaseMismatchError when the file is not the release
   */
  async fetchRelease(
    registry: ResolvedRegistry,
    artifactName: string,
    release: RegistryRelease,
  ): Promise<{ item: RegistryItem; url: string }> {
    const url = buildReleaseUrl(registry, release.path)
    const bytes = await fetchJsonBytes(url, registry.headers, SECURITY_LIMITS.MAX_ARTIFACT_SIZE)

    const actual = computeHashFromContent(bytes)
    if (actual !== release.sha256) {
      throw new RegistryReleaseMismatchError(
        `Checksum mismatch for ${url}: the registry manifest lists sha256 ${release.sha256}, the file has ${actual}. The file may have been changed or corrupted.`,
        url,
      )
    }

    const item = parseBytes(bytes)
    assertReleaseIdentity(item, artifactName, release, url)
    return { item: sanitizeRegistryItem(item as RegistryItem), url }
  }

  /** Fetch one artifact from its exact URL without consulting a registry manifest. */
  async fetchItemUrl(url: string, headers?: Record<string, string>): Promise<{ item: RegistryItem; url: string }> {
    const item = parseBytes(await fetchJsonBytes(url, headers, SECURITY_LIMITS.MAX_ARTIFACT_SIZE)) as RegistryItem
    return { item: sanitizeRegistryItem(item), url }
  }

  /**
   * Fetch a layer file as binary
   * @param registry - Resolved registry configuration
   * @param filePath - Path to the file (or full URL from layer info)
   * @param allowedContentTypes - List of allowed MIME types for layers
   */
  async fetchLayerBinary(
    registry: ResolvedRegistry,
    filePath: string,
    allowedContentTypes: readonly string[] = DEFAULT_ALLOWED_CONTENT_TYPES
  ): Promise<ArrayBuffer> {
    const url = filePath.startsWith('https') || filePath.startsWith('http') ? filePath : buildLayerFileUrl(registry, filePath)
    const bytes = await fetchLayerBytes(url, registry.headers, allowedContentTypes)
    return bytes.buffer
  }

  /**
   * Search artifacts in a registry by query
   * @param registry - Resolved registry configuration
   * @param options - Search options
   * @param fetchOptions - Fetch options including cache TTL
   */
  async searchArtifacts(
    registry: ResolvedRegistry,
    options: {
      query?: string
      kind?: string
      tags?: string[]
    },
    fetchOptions?: FetchOptions
  ): Promise<RegistryItemSummary[]> {
    // Fetch the full index and filter client-side
    // (In the future, this could use server-side search if available)
    const index = await this.fetchIndex(registry, fetchOptions)

    let results = [...index.items]

    // Filter by query (searches name, title, description)
    if (options.query) {
      const queryLower = options.query.toLowerCase()
      results = results.filter(
        (item) =>
          item.name.toLowerCase().includes(queryLower) ||
          item.title?.toLowerCase().includes(queryLower) ||
          item.description?.toLowerCase().includes(queryLower)
      )
    }

    // Filter by kind
    if (options.kind) {
      results = results.filter((item) => item.kind === options.kind)
    }

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      results = results.filter(
        (item) => item.tags && options.tags!.some((tag) => item.tags!.includes(tag))
      )
    }

    return results
  }
}

// Singleton instance
export const registryClient = new RegistryClient()
