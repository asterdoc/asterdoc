import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('undici', async (importOriginal) => {
  const undici = await importOriginal<typeof import('undici')>()
  return {
    ...undici,
    fetch: (input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init),
  }
})
import {
  RegistryClient,
  RegistryFetchError,
  FileSizeExceededError,
  RequestTimeoutError,
  UrlValidationError,
  ContentTypeError,
  RegistryReleaseMismatchError,
} from '../../src/utils/registry-client.js'
import { RegistryManifestError } from '../../src/utils/registry-manifest.js'
import { createHash } from 'node:crypto'
import { resolveRegistryRelease, type RegistryItemSummary } from '@paradoc/schemas'
import { SECURITY_LIMITS, NETWORK_TIMEOUTS } from '../../src/utils/constants.js'
import type { ResolvedRegistry } from '../../src/types.js'

describe('Registry Client Error Classes', () => {
  describe('RegistryFetchError', () => {
    it('creates error with status code and url', () => {
      const error = new RegistryFetchError('Not found', 404, 'https://example.com/artifact.json')
      expect(error.name).toBe('RegistryFetchError')
      expect(error.message).toBe('Not found')
      expect(error.statusCode).toBe(404)
      expect(error.url).toBe('https://example.com/artifact.json')
    })

    it('creates error without optional fields', () => {
      const error = new RegistryFetchError('General error')
      expect(error.name).toBe('RegistryFetchError')
      expect(error.statusCode).toBeUndefined()
      expect(error.url).toBeUndefined()
    })
  })

  describe('FileSizeExceededError', () => {
    it('creates error with size details', () => {
      const error = new FileSizeExceededError(
        'File too large',
        'https://example.com/layer.pdf',
        50 * 1024 * 1024, // 50MB
        20 * 1024 * 1024 // 20MB limit
      )
      expect(error.name).toBe('FileSizeExceededError')
      expect(error.message).toBe('File too large')
      expect(error.url).toBe('https://example.com/layer.pdf')
      expect(error.size).toBe(50 * 1024 * 1024)
      expect(error.limit).toBe(20 * 1024 * 1024)
    })
  })

  describe('RequestTimeoutError', () => {
    it('creates error with url', () => {
      const error = new RequestTimeoutError('Request timed out', 'https://example.com/slow')
      expect(error.name).toBe('RequestTimeoutError')
      expect(error.message).toBe('Request timed out')
      expect(error.url).toBe('https://example.com/slow')
    })
  })

  describe('UrlValidationError', () => {
    it('creates error with url', () => {
      const error = new UrlValidationError('Blocked internal IP', 'http://127.0.0.1/secret')
      expect(error.name).toBe('UrlValidationError')
      expect(error.message).toBe('Blocked internal IP')
      expect(error.url).toBe('http://127.0.0.1/secret')
    })
  })
})

describe('Security Constants', () => {
  it('has reasonable file size limits', async () => {
    const { SECURITY_LIMITS } = await import('../../src/utils/constants.js')

    // Artifact size should be limited
    expect(SECURITY_LIMITS.MAX_ARTIFACT_SIZE).toBeLessThanOrEqual(10 * 1024 * 1024) // Max 10MB
    expect(SECURITY_LIMITS.MAX_ARTIFACT_SIZE).toBeGreaterThan(0)

    // Layer size should be limited
    expect(SECURITY_LIMITS.MAX_LAYER_SIZE).toBeLessThanOrEqual(100 * 1024 * 1024) // Max 100MB
    expect(SECURITY_LIMITS.MAX_LAYER_SIZE).toBeGreaterThan(0)

    // Index size should be limited
    // The manifest lists every edition and version, so its cap is 10 MB
    expect(SECURITY_LIMITS.MAX_INDEX_SIZE).toBe(10 * 1024 * 1024)
  })

  it('has reasonable network timeouts', async () => {
    const { NETWORK_TIMEOUTS } = await import('../../src/utils/constants.js')

    // Connect timeout should be reasonable (not too short, not too long)
    expect(NETWORK_TIMEOUTS.CONNECT_TIMEOUT).toBeGreaterThanOrEqual(5000) // At least 5 seconds
    expect(NETWORK_TIMEOUTS.CONNECT_TIMEOUT).toBeLessThanOrEqual(120000) // Max 2 minutes

    // Download timeout (for large files)
    expect(NETWORK_TIMEOUTS.DOWNLOAD_TIMEOUT).toBeGreaterThanOrEqual(60000)
    expect(NETWORK_TIMEOUTS.DOWNLOAD_TIMEOUT).toBeLessThanOrEqual(600000)
  })
})

describe('RegistryClient network fetches', () => {
  const registry: ResolvedRegistry = {
    namespace: '@test',
    baseUrl: 'https://registry.example.com',
    headers: { Authorization: 'Bearer t0ken' },
  }
  const indexUrl = 'https://registry.example.com/registry.json'
  const layerUrl = 'https://registry.example.com/layers/doc.md'
  const noCache = { skipCache: true, cacheTtl: 0 }

  function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
  }

  function stubFetch(respond: (url: string, init: RequestInit) => Promise<Response> | Response) {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
      respond(String(input), init ?? {})
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function hangUntilAborted(_url: string, init: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    })
  }

  let cacheDir: string

  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'registry-client-test-'))
  })

  afterAll(async () => {
    await rm(cacheDir, { recursive: true, force: true })
  })

  /** A client whose shared cache points at a scratch directory, never ~/.paradoc. */
  async function newClient(): Promise<RegistryClient> {
    const client = new RegistryClient()
    await client.initCache({ directory: cacheDir })
    return client
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('registry JSON', () => {
    it('fetches an exact item URL without requesting the registry index', async () => {
      const itemUrl = 'https://registry.example.com/custom/form.json'
      const fetchMock = stubFetch(() => new Response(JSON.stringify({ name: 'form', kind: 'form', version: '1.0.0' }), { headers: { 'content-type': 'application/json' } }))
      const result = await (await newClient()).fetchItemUrl(itemUrl, registry.headers)
      expect(result.url).toBe(itemUrl)
      expect(result.item.name).toBe('form')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0]![0]).toBe(itemUrl)
    })

    it('parses YAML registry items', async () => {
      stubFetch(() => new Response('name: lease\nkind: document\nversion: 1.0.0\n', { headers: { 'content-type': 'application/yaml' } }))
      const result = await (await newClient()).fetchItemUrl('https://registry.example.com/items/lease.yaml')
      expect(result.item).toMatchObject({ name: 'lease', kind: 'document', version: '1.0.0' })
    })

    it('parses the index and sends Accept plus registry headers', async () => {
      const index = { name: 'test', items: [] }
      const fetchMock = stubFetch(
        () => new Response(JSON.stringify(index), { headers: { 'content-type': 'application/json' } })
      )

      await expect((await newClient()).fetchIndex(registry, noCache)).resolves.toMatchObject(index)

      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe(indexUrl)
      expect(init?.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer t0ken' })
    })

    it('refuses a manifest of the old shape, naming each issue with its path', async () => {
      const oldShape = {
        name: 'test',
        artifactsPath: '/r',
        items: [{ name: 'w-9', kind: 'form', version: '1.0.0', path: 'w-9.json' }],
      }
      stubFetch(() => new Response(JSON.stringify(oldShape), { headers: { 'content-type': 'application/json' } }))

      const error = await (await newClient()).fetchIndex(registry, noCache).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RegistryManifestError)
      const message = (error as RegistryManifestError).message
      expect(message).toContain(`The registry manifest at ${indexUrl} is not valid:`)
      expect(message).toMatch(/• root: .*artifactsPath/)
      expect(message).toMatch(/• items\[0\]: .*(version|path)/)
    })

    it('does not use a cached manifest that is not valid, and fetches a new one', async () => {
      const client = await newClient()
      const staleRegistry = { ...registry, baseUrl: 'https://stale.example.com' }
      const { cacheManager } = await import('../../src/utils/cache.js')
      await cacheManager.set('https://stale.example.com/registry.json', { name: 'test', items: [{ name: 'w-9', kind: 'form', version: '1.0.0' }] }, 3600)
      const fetchMock = stubFetch(
        () => new Response(JSON.stringify({ name: 'test', items: [] }), { headers: { 'content-type': 'application/json' } })
      )

      const index = await client.fetchIndex(staleRegistry, { cacheTtl: 3600 })
      expect(index.items).toEqual([])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('refuses a non-OK status', async () => {
      stubFetch(() => new Response('nope', { status: 404, statusText: 'Not Found' }))

      const error = await (await newClient()).fetchIndex(registry, noCache).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RegistryFetchError)
      expect((error as RegistryFetchError).message).toBe(`Failed to fetch ${indexUrl}: 404 Not Found`)
      expect((error as RegistryFetchError).statusCode).toBe(404)
    })

    it('refuses a non-JSON, non-YAML content type', async () => {
      stubFetch(() => new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }))

      const error = await (await newClient()).fetchIndex(registry, noCache).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ContentTypeError)
      expect((error as ContentTypeError).message).toBe("Artifact must be JSON or YAML, got 'text/html'")
    })

    it('refuses a declared Content-Length over the index limit', async () => {
      const limit = SECURITY_LIMITS.MAX_INDEX_SIZE
      stubFetch(
        () =>
          new Response('{}', {
            headers: { 'content-type': 'application/json', 'content-length': String(limit + 1) },
          })
      )

      const error = await (await newClient()).fetchIndex(registry, noCache).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(FileSizeExceededError)
      expect((error as FileSizeExceededError).message).toBe('File size (10.0 MB) exceeds limit (10.0 MB)')
      expect((error as FileSizeExceededError).size).toBe(limit + 1)
      expect((error as FileSizeExceededError).limit).toBe(limit)
    })

    it('refuses a streamed body that grows past the index limit', async () => {
      const limit = SECURITY_LIMITS.MAX_INDEX_SIZE
      const chunk = new Uint8Array(1024 * 1024)
      stubFetch(
        () =>
          new Response(streamOf(Array.from({ length: 11 }, () => chunk)), {
            headers: { 'content-type': 'application/json' },
          })
      )

      const error = await (await newClient()).fetchIndex(registry, noCache).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(FileSizeExceededError)
      expect((error as FileSizeExceededError).message).toBe('Download size (>11.0 MB) exceeds limit (10.0 MB)')
      expect((error as FileSizeExceededError).limit).toBe(limit)
    })

    it('times out after the connect timeout', async () => {
      vi.useFakeTimers()
      stubFetch(hangUntilAborted)

      const pending = (await newClient()).fetchIndex(registry, noCache).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(NETWORK_TIMEOUTS.CONNECT_TIMEOUT)

      const error = await pending
      expect(error).toBeInstanceOf(RequestTimeoutError)
      expect((error as RequestTimeoutError).message).toBe(
        `Request timed out after ${NETWORK_TIMEOUTS.CONNECT_TIMEOUT}ms`
      )
      expect((error as RequestTimeoutError).url).toBe(indexUrl)
    })

    it('refuses a non-https URL before fetching', async () => {
      const fetchMock = stubFetch(() => new Response('{}'))

      const error = await (await newClient())
        .fetchIndex({ ...registry, baseUrl: 'ftp://registry.example.com' }, noCache)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UrlValidationError)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })



  describe('release file', () => {
    const artifact = { name: 'w-9', kind: 'form', version: '1.1.0', edition: { key: '2024-03', label: 'Rev. March 2024' }, fields: {} }
    const body = JSON.stringify(artifact)
    const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
    const item = (digest: string): RegistryItemSummary => ({
      name: 'w-9',
      kind: 'form',
      currentEdition: '2024-03',
      editions: {
        '2024-03': {
          label: 'Rev. March 2024',
          latestVersion: '1.1.0',
          versions: { '1.1.0': { path: 'w-9/2024-03/1.1.0/w-9.json', sha256: digest } },
        },
      },
    })
    const releaseOf = (digest: string) => {
      const resolution = resolveRegistryRelease(item(digest))
      if (!resolution.ok) throw new Error('fixture does not resolve')
      return resolution.release
    }
    const serve = (text: string) =>
      stubFetch(() => new Response(text, { headers: { 'content-type': 'application/json' } }))

    it('fetches the file at the manifest path under the base address when its bytes and identity match', async () => {
      const fetchMock = serve(body)
      const result = await (await newClient()).fetchRelease(registry, 'w-9', releaseOf(sha256(body)))
      expect(result.url).toBe('https://registry.example.com/w-9/2024-03/1.1.0/w-9.json')
      expect(fetchMock.mock.calls[0]![0]).toBe(result.url)
      expect(result.item).toMatchObject({ name: 'w-9', version: '1.1.0' })
    })

    it('refuses bytes that do not match the sha256 the manifest lists', async () => {
      serve(body.replace('Rev. March 2024', 'Rev. March 2025'))
      const error = await (await newClient()).fetchRelease(registry, 'w-9', releaseOf(sha256(body))).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RegistryReleaseMismatchError)
      expect((error as Error).message).toContain('Checksum mismatch for https://registry.example.com/w-9/2024-03/1.1.0/w-9.json')
      expect((error as Error).message).toContain(sha256(body))
    })

    it.each([
      ['name', { ...artifact, name: 'w-8' }, 'name "w-9" expected, the file has "w-8"'],
      ['version', { ...artifact, version: '1.0.0' }, 'version "1.1.0" expected, the file has "1.0.0"'],
      ['edition', { ...artifact, edition: { key: '2018-10', label: 'Rev. October 2018' } }, 'edition "2024-03" expected, the file has "2018-10"'],
      ['missing edition', { name: 'w-9', kind: 'form', version: '1.1.0' }, 'edition "2024-03" expected, the file has none'],
    ])('refuses a file with the right checksum and another %s', async (_what, other, expected) => {
      const text = JSON.stringify(other)
      serve(text)
      const error = await (await newClient()).fetchRelease(registry, 'w-9', releaseOf(sha256(text))).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RegistryReleaseMismatchError)
      expect((error as Error).message).toContain('is not the release the registry manifest lists')
      expect((error as Error).message).toContain(expected)
    })
  })

  describe('layer binary', () => {
    it('returns exactly the streamed bytes', async () => {
      stubFetch(
        () =>
          new Response(streamOf([new Uint8Array([0x25, 0x50]), new Uint8Array([0x44, 0x46, 0x00])]), {
            headers: { 'content-type': 'application/pdf' },
          })
      )

      const buffer = await (await newClient()).fetchLayerBinary(registry, layerUrl)
      expect(buffer).toBeInstanceOf(ArrayBuffer)
      expect(Array.from(new Uint8Array(buffer))).toEqual([0x25, 0x50, 0x44, 0x46, 0x00])
    })

    it('refuses a streamed body that grows past the layer limit', async () => {
      const limit = SECURITY_LIMITS.MAX_LAYER_SIZE
      const chunk = new Uint8Array(limit / 2)
      stubFetch(
        () =>
          new Response(streamOf([chunk, chunk, new Uint8Array(1)]), {
            headers: { 'content-type': 'application/pdf' },
          })
      )

      const error = await (await newClient()).fetchLayerBinary(registry, layerUrl).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(FileSizeExceededError)
      expect((error as FileSizeExceededError).size).toBe(limit + 1)
      expect((error as FileSizeExceededError).limit).toBe(limit)
    })
  })
})
