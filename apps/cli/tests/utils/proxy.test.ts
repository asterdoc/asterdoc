import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const proxyModule = fileURLToPath(new URL('../../src/utils/proxy.ts', import.meta.url))

const childScript = `
const { initProxy } = await import(process.env.PROXY_MODULE)
initProxy()
const response = await fetch(process.env.TARGET_URL, { signal: AbortSignal.timeout(5000) })
process.stdout.write(await response.text())
`

let target: Server
let proxy: Server
let targetPort: number
let proxyUrl: string
const proxyHits: string[] = []

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

function runChild(env: Record<string, string>): Promise<{ ok: boolean; stdout: string }> {
  const base = { ...process.env }
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS']) {
    delete base[key]
  }
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--input-type=module', '-e', childScript],
      { env: { ...base, PROXY_MODULE: proxyModule, ...env }, timeout: 10_000 },
      (error, stdout) => resolve({ ok: !error, stdout }),
    )
  })
}

beforeAll(async () => {
  target = createServer((_req, res) => res.end('from target'))
  targetPort = await listen(target)

  proxy = createServer((req, res) => {
    proxyHits.push(req.url ?? '')
    res.end('from proxy')
  })
  proxy.on('connect', (req, clientSocket, head) => {
    proxyHits.push(req.url ?? '')
    const upstream = connect(targetPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
  })
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`
})

afterAll(async () => {
  await Promise.all([target, proxy].map((server) => new Promise((resolve) => server.close(resolve))))
})

beforeEach(() => {
  proxyHits.length = 0
})

describe('initProxy', () => {
  it('sends fetch requests through the proxy named in HTTP_PROXY', async () => {
    const result = await runChild({ HTTP_PROXY: proxyUrl, TARGET_URL: `http://registry.test:${targetPort}/index.json` })

    expect(result.ok).toBe(true)
    expect(proxyHits.some((hit) => hit.includes('registry.test'))).toBe(true)
  })

  it('reads the lowercase http_proxy variable', async () => {
    const result = await runChild({ http_proxy: proxyUrl, TARGET_URL: `http://registry.test:${targetPort}/index.json` })

    expect(result.ok).toBe(true)
    expect(proxyHits.some((hit) => hit.includes('registry.test'))).toBe(true)
  })

  it('skips the proxy for a host listed in NO_PROXY', async () => {
    const result = await runChild({
      HTTP_PROXY: proxyUrl,
      NO_PROXY: 'registry.test',
      TARGET_URL: `http://registry.test:${targetPort}/index.json`,
    })

    expect(result.ok).toBe(false)
    expect(proxyHits).toEqual([])
  })

  it('connects directly when no proxy variable is set', async () => {
    const result = await runChild({ TARGET_URL: `http://127.0.0.1:${targetPort}/index.json` })

    expect(result).toEqual({ ok: true, stdout: 'from target' })
    expect(proxyHits).toEqual([])
  })
})
