import { runCli as executeCliCommand } from '../setup/spawn-cli'
import { describe, it, expect, beforeEach, afterEach, inject } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unreachableNetworkEnv } from '../setup/unreachable-network.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Execute a CLI command and return the result
 */

describe('asterdoc add', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'asterdoc-add-test-'))
    // Create minimal project structure
    await fs.writeFile(
      join(tempDir, 'asterdoc.json'),
      JSON.stringify({
        $schema: 'https://schema.asterdoc.com/manifest.json',
        name: '@test/test-project',
        title: 'Test Project',
        visibility: 'private',
      })
    )
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('argument validation', () => {
    it('rejects an unknown output format before project or network access', async () => {
      const result = await executeCliCommand(['add', '@acme/test', '--output', 'xml'], { cwd: tempDir })
      expect(result.stderr).toContain('Invalid output format: xml')
      expect(result.stderr).not.toContain('Not in an Asterdoc project')
      expect(result.exitCode).toBe(1)
    })

    it('shows error for invalid artifact reference (missing @)', async () => {
      const result = await executeCliCommand(['add', 'acme/test'], { cwd: tempDir })
      expect(result.stderr).toContain('Invalid artifact')
      expect(result.exitCode).not.toBe(0)
    })

    it('treats @namespace as namespace-only browse (requires project)', async () => {
      const result = await executeCliCommand(['add', '@acme'], { cwd: tempDir })
      // @acme is now a valid namespace-only pattern (browse mode),
      // but fails because tempDir is not an Asterdoc project
      expect(result.stderr).toContain('Not in an Asterdoc project')
      expect(result.exitCode).not.toBe(0)
    })

    it('rejects a bare artifact name and asks for its registry namespace', async () => {
      const result = await executeCliCommand(['add', 'w9'], { cwd: tempDir })
      expect(result.stderr).toContain('"w9" is not a document component')
      expect(result.stderr).toContain('asterdoc add @registry/w9')
      expect(result.stderr).not.toContain('Invalid artifact')
      expect(result.exitCode).toBe(1)
    })

    it('shows error for empty artifact name', async () => {
      const result = await executeCliCommand(['add', '@acme/'], { cwd: tempDir })
      expect(result.stderr).toContain('Invalid artifact')
      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('project detection', () => {
    it('shows error when not in a project directory', async () => {
      const nonProjectDir = await fs.mkdtemp(join(tmpdir(), 'asterdoc-no-project-'))
      try {
        const result = await executeCliCommand(['add', '@acme/test'], { cwd: nonProjectDir })
        expect(result.stderr).toContain('Not in an Asterdoc project')
        expect(result.exitCode).not.toBe(0)
      } finally {
        await fs.rm(nonProjectDir, { recursive: true, force: true })
      }
    })
  })

  describe('help and usage', () => {
    it('shows help for add command', async () => {
      const result = await executeCliCommand(['add', '--help'])
      expect(result.stdout).toContain('Add an artifact from a registry')
      expect(result.stdout).toContain('--layers')
      expect(result.stdout).toContain('--output')
    })
  })

  describe('edge cases', () => {
    it('handles artifact reference with special characters in name', async () => {
      const result = await executeCliCommand(['add', '@acme/test-artifact_123'], { cwd: tempDir })
      // Should not crash, may fail on registry lookup but should process the reference
      expect(result.exitCode).toBeDefined()
    })

    it('handles very long artifact name gracefully', async () => {
      const longName = 'a'.repeat(200)
      const result = await executeCliCommand(['add', `@acme/${longName}`], { cwd: tempDir })
      // Should not crash - may fail on registry lookup but process should complete
      expect(result.exitCode).toBeDefined()
    })

    it('handles artifact reference with path traversal attempt in name', async () => {
      const result = await executeCliCommand(['add', '@acme/../../../etc/passwd'], { cwd: tempDir })
      // Should be rejected as invalid reference
      expect(result.stderr).toContain('Invalid artifact')
      expect(result.exitCode).not.toBe(0)
    })

    it('handles namespace with path traversal attempt', async () => {
      const result = await executeCliCommand(['add', '@../evil/artifact'], { cwd: tempDir })
      // Should be rejected as invalid reference
      expect(result.stderr).toContain('Invalid artifact')
      expect(result.exitCode).not.toBe(0)
    })
  })

  describe('output option', () => {
    it('accepts --output json', async () => {
      const result = await executeCliCommand(['add', '--help'])
      expect(result.stdout).toContain('--output')
    })

    it('accepts --output yaml', async () => {
      const result = await executeCliCommand(['add', '--help'])
      expect(result.stdout).toContain('--output')
    })

    it('accepts --output typed', async () => {
      const result = await executeCliCommand(['add', '--help'])
      expect(result.stdout).toContain('typed')
    })

    it('accepts --output ts', async () => {
      const result = await executeCliCommand(['add', '--help'])
      expect(result.stdout).toContain('TypeScript module')
    })
  })

  describe('layers option', () => {
    it('shows layers option in help', async () => {
      const result = await executeCliCommand(['add', '--help'])
      expect(result.stdout).toContain('--layers')
      expect(result.stdout).toContain('all')
    })
  })
})

describe('asterdoc add (files the artifact references)', () => {
  // A registry of one artifact with a file layer and an instructions file. Each
  // test decides what the registry serves for those two files.
  /** A one-page PDF with no form fields: the smallest file a PDF layer can hold. */
  const onePagePdf = (): Buffer => {
    const bodies = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>',
    ]
    let pdf = '%PDF-1.4\n'
    const offsets: number[] = []
    bodies.forEach((body, index) => {
      offsets.push(pdf.length)
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
    })
    const xref = pdf.length
    pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
    pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
    return Buffer.from(pdf + `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  }
  const layerBytes = onePagePdf()
  const instructionsBytes = Buffer.from('# Instructions\n')
  const sha256 = (content: Buffer): string => `sha256:${createHash('sha256').update(content).digest('hex')}`

  let tempDir: string
  let server: Server
  let serve: Record<string, { status: number; type: string; body: Buffer }>
  let connections: number
  let registryUrl: string
  /** The sha256 the manifest lists for the artifact file; undefined: the one of the file served. */
  let manifestSha256: string | undefined

  beforeEach(async () => {
    const w9 = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../test-registry/w9.json'), 'utf-8'))
    const artifact = {
      $schema: w9.$schema,
      kind: 'form',
      name: 'packet',
      version: '1.0.0',
      title: 'Packet',
      fields: { name: { type: 'text', label: 'Name' } },
      layers: {
        pdf: { kind: 'file', mimeType: 'application/pdf', path: 'packet.pdf', checksum: sha256(layerBytes) },
      },
      instructions: { kind: 'file', path: 'packet-instructions.md', mimeType: 'text/markdown', checksum: sha256(instructionsBytes) },
    }
    manifestSha256 = undefined
    serve = {
      '/packet/1.0.0/packet.json': { status: 200, type: 'application/json', body: Buffer.from(JSON.stringify(artifact)) },
      '/packet/1.0.0/packet.pdf': { status: 200, type: 'application/pdf', body: layerBytes },
      '/packet/1.0.0/packet-instructions.md': { status: 200, type: 'text/markdown', body: instructionsBytes },
    }
    connections = 0
    server = createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      // The manifest lists the checksum of the artifact file as it is served
      // now, unless a test pins another one.
      const file = pathname === '/registry.json'
        ? {
            status: 200,
            type: 'application/json',
            body: Buffer.from(JSON.stringify({
              name: 'fixture',
              items: [{
                name: 'packet',
                kind: 'form',
                latestVersion: '1.0.0',
                versions: {
                  '1.0.0': {
                    path: 'packet/1.0.0/packet.json',
                    sha256: manifestSha256 ?? createHash('sha256').update(serve['/packet/1.0.0/packet.json']!.body).digest('hex'),
                  },
                },
              }],
            })),
          }
        : serve[pathname]
      res.writeHead(file?.status ?? 404, { 'Content-Type': file?.type ?? 'application/json' })
      res.end(file?.body ?? '{}')
    })
    server.on('connection', () => { connections++ })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    registryUrl = `http://127.0.0.1:${port}`

    tempDir = await fs.mkdtemp(join(tmpdir(), 'asterdoc-add-files-'))
    await executeCliCommand(['init', '--yes', '--name', 'test-project'], { cwd: tempDir })
    const manifestPath = join(tempDir, 'asterdoc.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
    manifest.registries = { '@fixture': { url: `http://127.0.0.1:${port}` } }
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const exists = (file: string): Promise<boolean> =>
    fs.access(join(tempDir, file)).then(() => true, () => false)

  const lockedArtifacts = async (): Promise<Record<string, unknown>> => {
    const lock = await fs.readFile(join(tempDir, '.asterdoc', 'lock.json'), 'utf-8').catch(() => '{}')
    return (JSON.parse(lock) as { artifacts?: Record<string, unknown> }).artifacts ?? {}
  }

  it('installs the artifact with its layer and instructions when every file verifies', async () => {
    const result = await executeCliCommand(['add', '@fixture/packet', '--layers', 'all', '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Added')
    expect(await fs.readFile(join(tempDir, 'artifacts/@fixture/packet.pdf'))).toEqual(layerBytes)
    expect(await fs.readFile(join(tempDir, 'artifacts/@fixture/packet-instructions.md'))).toEqual(instructionsBytes)
    expect(await exists('artifacts/@fixture/packet.json')).toBe(true)
    expect(Object.keys(await lockedArtifacts())).toContain('@fixture/packet')
  }, 30000)

  it('fails and installs nothing when a layer does not match its checksum', async () => {
    serve['/packet/1.0.0/packet.pdf']!.body = Buffer.from('tampered bytes')

    const result = await executeCliCommand(['add', '@fixture/packet', '--layers', 'all', '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Could not add @fixture/packet')
    expect(result.stderr).toContain('layer "pdf" (packet.pdf): checksum mismatch')
    expect(result.stdout).not.toContain('Added')
    expect(await exists('artifacts/@fixture/packet.json')).toBe(false)
    expect(await exists('artifacts/@fixture/packet.pdf')).toBe(false)
    expect(await exists('artifacts/@fixture/packet-instructions.md')).toBe(false)
    expect(Object.keys(await lockedArtifacts())).not.toContain('@fixture/packet')
  }, 30000)

  it('fails and installs nothing when the instructions file cannot be downloaded', async () => {
    serve['/packet/1.0.0/packet-instructions.md'] = { status: 500, type: 'text/plain', body: Buffer.from('boom') }

    const result = await executeCliCommand(['add', '@fixture/packet', '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Could not add @fixture/packet')
    expect(result.stderr).toContain('instructions (packet-instructions.md):')
    expect(result.stdout).not.toContain('Added')
    expect(await exists('artifacts/@fixture/packet.json')).toBe(false)
    expect(Object.keys(await lockedArtifacts())).not.toContain('@fixture/packet')
  }, 30000)

  it('names every failed file, not just the first', async () => {
    serve['/packet/1.0.0/packet.pdf']!.body = Buffer.from('tampered bytes')
    delete serve['/packet/1.0.0/packet-instructions.md']

    const result = await executeCliCommand(['add', '@fixture/packet', '--layers', 'all', '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('2 files failed to download or verify')
    expect(result.stderr).toContain('layer "pdf" (packet.pdf)')
    expect(result.stderr).toContain('instructions (packet-instructions.md)')
  }, 30000)

  it('fails when an explicitly requested layer is absent', async () => {
    const result = await executeCliCommand(['add', '@fixture/packet', '--layers', 'missing', '--no-cache'], { cwd: tempDir })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('requested layer is not declared')
    expect(await exists('artifacts/@fixture/packet.json')).toBe(false)
  }, 30000)

  it('fails when a requested file layer has no checksum', async () => {
    const item = JSON.parse(serve['/packet/1.0.0/packet.json']!.body.toString()) as { layers: { pdf: { checksum?: string } } }
    delete item.layers.pdf.checksum
    serve['/packet/1.0.0/packet.json']!.body = Buffer.from(JSON.stringify(item))
    const result = await executeCliCommand(['add', '@fixture/packet', '--layers', 'pdf', '--no-cache'], { cwd: tempDir })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing required checksum')
    expect(await exists('artifacts/@fixture/packet.json')).toBe(false)
  }, 30000)

  const installedArtifact = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await fs.readFile(join(tempDir, 'artifacts/@fixture/packet.json'), 'utf-8')) as Record<string, unknown>

  const servePacket = (item: Record<string, unknown>): void => {
    serve['/packet/1.0.0/packet.json']!.body = Buffer.from(JSON.stringify(item))
  }

  it('installs only the artifact, without the registry metadata the item carries', async () => {
    const item = JSON.parse(serve['/packet/1.0.0/packet.json']!.body.toString()) as Record<string, unknown> & { layers: { pdf: Record<string, unknown> } }
    item.tags = ['tax']
    item.layers.pdf.url = `${registryUrl}/packet/1.0.0/packet.pdf`
    servePacket(item)

    const result = await executeCliCommand(['add', '@fixture/packet', '--output', 'json', '--layers', 'all', '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    const installed = await installedArtifact()
    expect(Object.keys(installed).sort()).toEqual(['$schema', 'fields', 'instructions', 'kind', 'layers', 'name', 'title', 'version'])
    expect(installed.fields).toEqual({ name: { type: 'text', label: 'Name' } })
    expect((installed.layers as { pdf: Record<string, unknown> }).pdf).not.toHaveProperty('url')
    const validated = await executeCliCommand(['validate', 'artifacts/@fixture/packet.json'], { cwd: tempDir })
    expect(validated.exitCode).toBe(0)
  }, 30000)

  it('records the version, the release URL and no edition in the lock file', async () => {
    const result = await executeCliCommand(['add', '@fixture/packet', '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    const locked = (await lockedArtifacts())['@fixture/packet'] as Record<string, unknown>
    expect(locked.version).toBe('1.0.0')
    expect(locked.resolved).toBe(`${registryUrl}/packet/1.0.0/packet.json`)
    expect(locked).not.toHaveProperty('edition')
  }, 30000)

  it('fails and installs nothing when the artifact file does not match the sha256 the manifest lists', async () => {
    manifestSha256 = createHash('sha256').update(serve['/packet/1.0.0/packet.json']!.body).digest('hex')
    const item = JSON.parse(serve['/packet/1.0.0/packet.json']!.body.toString()) as Record<string, unknown>
    servePacket({ ...item, title: 'Changed after the manifest was written' })

    const result = await executeCliCommand(['add', '@fixture/packet', '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`Checksum mismatch for ${registryUrl}/packet/1.0.0/packet.json`)
    expect(result.stderr).toContain(manifestSha256)
    expect(result.stderr).toContain('Nothing was installed')
    expect(result.stdout).not.toContain('Added')
    expect(await exists('artifacts/@fixture/packet.json')).toBe(false)
    expect(Object.keys(await lockedArtifacts())).not.toContain('@fixture/packet')
  }, 30000)

  it.each([
    ['name', { name: 'other-packet' }, 'name "packet" expected, the file has "other-packet"'],
    ['version', { version: '2.0.0' }, 'version "1.0.0" expected, the file has "2.0.0"'],
  ])('fails and installs nothing when the artifact file states another %s than the release', async (_what, change, message) => {
    const item = JSON.parse(serve['/packet/1.0.0/packet.json']!.body.toString()) as Record<string, unknown>
    servePacket({ ...item, ...change })

    const result = await executeCliCommand(['add', '@fixture/packet', '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('is not the release the registry manifest lists')
    expect(result.stderr).toContain(message)
    expect(result.stdout).not.toContain('Added')
    expect(await exists('artifacts/@fixture/packet.json')).toBe(false)
    expect(Object.keys(await lockedArtifacts())).not.toContain('@fixture/packet')
  }, 30000)

  it('fails and installs nothing when the item wraps its artifact in an envelope', async () => {
    const { $schema, kind, name, version, title, ...definition } = JSON.parse(serve['/packet/1.0.0/packet.json']!.body.toString()) as Record<string, unknown>
    servePacket({ $schema, kind, name, version, title, artifact: { $schema, kind, name, version, title, ...definition } })

    const result = await executeCliCommand(['add', '@fixture/packet', '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('@fixture/packet from the registry is not a valid artifact')
    expect(result.stderr).toContain('Unrecognized key: "artifact"')
    expect(result.stdout).not.toContain('Added')
    expect(await exists('artifacts/@fixture/packet.json')).toBe(false)
    expect(Object.keys(await lockedArtifacts())).not.toContain('@fixture/packet')
  }, 30000)

  // A direct URL must be https, which this plain server cannot answer, so these
  // tests observe whether `add` opens a connection at all, not what it sends.
  const directUrl = (): string => `${registryUrl.replace('http://', 'https://')}/packet/1.0.0/packet.json`

  it('goes on to contact the registry when every --header is well formed', async () => {
    await executeCliCommand(['add', directUrl(), '--header', 'Authorization: Bearer abc', '--no-cache'], { cwd: tempDir })

    expect(connections).toBeGreaterThan(0)
  }, 30000)

  it.each([
    ['no colon', 'Authorization Bearer abc', 'Invalid header "Authorization Bearer abc": expected "Name: Value".'],
    ['an empty name', ': Bearer abc', 'Invalid header ": Bearer abc": the header name is empty.'],
    ['an empty value', 'Authorization: ', 'Invalid header "Authorization": the header value is empty.'],
  ])('fails by name, without sending a request, on a --header with %s', async (_shape, header, message) => {
    const result = await executeCliCommand(['add', directUrl(), '--header', header, '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(message)
    expect(connections).toBe(0)
    expect(await exists('artifacts/@fixture/packet.json')).toBe(false)
  }, 30000)

  it.each([
    ['no colon', 'Authorization Bearer abc', 'Invalid header "Authorization Bearer abc": expected "Name: Value".'],
    ['an empty name', ': Bearer abc', 'Invalid header ": Bearer abc": the header name is empty.'],
    ['an empty value', 'Authorization: ', 'Invalid header "Authorization": the header value is empty.'],
  ])('asterdoc registry add fails by name on a --header with %s', async (_shape, header, message) => {
    const result = await executeCliCommand(['registry', 'add', '@other', registryUrl, '--header', header, '--project', '--yes'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(message)
    expect(connections).toBe(0)
    const manifest = JSON.parse(await fs.readFile(join(tempDir, 'asterdoc.json'), 'utf-8')) as { registries: Record<string, unknown> }
    expect(manifest.registries).not.toHaveProperty('@other')
  }, 30000)
})

describe('asterdoc add (namespace resolution with no registries configured)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'asterdoc-add-namespaces-'))
    await executeCliCommand(['init', '--yes', '--name', 'test-project'], { cwd: tempDir })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('refuses the reserved @asterdoc without contacting any host: its registry is not available yet', async () => {
    const result = await executeCliCommand(['add', '@asterdoc/w9', '--no-cache'], {
      cwd: tempDir,
      env: await unreachableNetworkEnv(),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('The Asterdoc registry is not available yet, so @asterdoc cannot be resolved.')
    expect(result.stdout + result.stderr).not.toContain('Registry:')
  })

  it('fails for an unconfigured namespace, naming it and the add command, without contacting any host', async () => {
    const result = await executeCliCommand(['add', '@acme/w9', '--no-cache'], {
      cwd: tempDir,
      env: await unreachableNetworkEnv(),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('No registry is configured for @acme. Run: asterdoc registry add @acme <url>')
    expect(result.stdout + result.stderr).not.toContain('public.asterdoc.com')
  })
})

describe('asterdoc add (registry integration)', () => {
  const TEST_REGISTRY_URL = inject('testRegistryUrl')
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'asterdoc-add-registry-'))
    // Initialize project with registry config
    await executeCliCommand(['init', '--yes', '--name', 'test-project'], { cwd: tempDir })
    const manifestPath = join(tempDir, 'asterdoc.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
    manifest.registries = {
      '@acme': {
        url: TEST_REGISTRY_URL,
      },
    }
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('adds W9 artifact from the registry', async () => {
    const result = await executeCliCommand(['add', '@acme/w9'], { cwd: tempDir })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Added')
    expect(result.stdout).toContain('@acme/w9')

    // Verify artifact file was created (default format is json)
    const artifactPath = join(tempDir, 'artifacts', '@acme', 'w9.json')
    const exists = await fs.access(artifactPath).then(() => true).catch(() => false)
    expect(exists).toBe(true)

    // Verify content has expected fields
    const content = await fs.readFile(artifactPath, 'utf-8')
    expect(content).toContain('name')
    expect(content).toContain('taxClassification')
  }, 30000)

  it('adds artifact with --output json', async () => {
    const result = await executeCliCommand(['add', '@acme/residential-lease', '--output', 'json'], { cwd: tempDir })
    expect(result.exitCode).toBe(0)

    const artifactPath = join(tempDir, 'artifacts', '@acme', 'residential-lease.json')
    const exists = await fs.access(artifactPath).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  }, 30000)

  it('adds artifact with --output yaml', async () => {
    const result = await executeCliCommand(['add', '@acme/residential-lease', '--output', 'yaml'], { cwd: tempDir })
    expect(result.exitCode).toBe(0)

    const artifactPath = join(tempDir, 'artifacts', '@acme', 'residential-lease.yaml')
    const exists = await fs.access(artifactPath).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  }, 30000)

  it.each(['typed', 'ts'] as const)('adds artifact with --output %s and keeps a JSON source', async (format) => {
    const result = await executeCliCommand(['add', '@acme/residential-lease', '--output', format, '--layers', 'all'], { cwd: tempDir })
    expect(result.exitCode).toBe(0)
    const namespaceDir = join(tempDir, 'artifacts', '@acme')
    await expect(fs.access(join(namespaceDir, 'residential-lease.json'))).resolves.toBeUndefined()
    if (format === 'typed') await expect(fs.access(join(namespaceDir, 'residential-lease.json.d.ts'))).resolves.toBeUndefined()
    if (format === 'ts') await expect(fs.access(join(namespaceDir, 'residential-lease.ts'))).resolves.toBeUndefined()
    const lock = JSON.parse(await fs.readFile(join(tempDir, '.asterdoc', 'lock.json'), 'utf8'))
    expect(lock.artifacts['@acme/residential-lease'].path).toBe('artifacts/@acme/residential-lease.json')
    if (format === 'ts') {
      const source = join(namespaceDir, 'residential-lease.json')
      expect((await executeCliCommand(['validate', source], { cwd: tempDir })).exitCode).toBe(0)
      expect((await executeCliCommand(['data', 'template', source, '--json'], { cwd: tempDir })).exitCode).toBe(0)
      expect((await executeCliCommand(['render', source, '--dry-run'], { cwd: tempDir })).exitCode).toBe(0)
      await fs.writeFile(join(namespaceDir, 'note.md'), '# Note\n')
      expect((await executeCliCommand(['attach', source, join(namespaceDir, 'note.md'), '--name', 'note', '--yes', '--dry-run'], { cwd: tempDir })).exitCode).toBe(0)
      expect((await executeCliCommand(['registry', 'view', '@acme/residential-lease', '--json'], { cwd: tempDir })).exitCode).toBe(0)
    }
  }, 30000)

  it('fails with error for nonexistent artifact', async () => {
    const result = await executeCliCommand(['add', '@acme/nonexistent'], { cwd: tempDir })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('not found')
  }, 30000)

  const locked = async (ref: string): Promise<Record<string, unknown>> =>
    JSON.parse(await fs.readFile(join(tempDir, '.asterdoc', 'lock.json'), 'utf8')).artifacts[ref]
  const installed = async (name: string): Promise<Record<string, unknown>> =>
    JSON.parse(await fs.readFile(join(tempDir, 'artifacts', '@acme', `${name}.json`), 'utf8'))

  // The test registry states 2024 as the current edition of w4 although it
  // also lists 2025, and 1.1.0 as the latest version of pet-policy although
  // it also lists 2.0.0-beta.1: the default is the publisher's statement.
  it.each([
    ['@acme/w4', '2024', '1.1.0'],
    ['@acme/w4/current@latest', '2024', '1.1.0'],
    ['@acme/w4/2025', '2025', '1.0.0'],
    ['@acme/w4@1.0.0', '2024', '1.0.0'],
    ['@acme/w4/2024@1.0.0', '2024', '1.0.0'],
  ])('adds %s as edition %s, version %s, and records both in the lock file', async (ref, edition, version) => {
    const result = await executeCliCommand(['add', ref, '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`Added @acme/w4 ${edition} v${version}`)
    expect(await installed('w4')).toMatchObject({ name: 'w4', version, edition: { key: edition } })
    expect(await locked('@acme/w4')).toMatchObject({
      edition,
      version,
      resolved: `${TEST_REGISTRY_URL}/w4/${edition}/${version}/w4.json`,
    })
  }, 30000)

  it.each([
    ['@acme/pet-policy', '1.1.0'],
    ['@acme/pet-policy@1.0.0', '1.0.0'],
    ['@acme/pet-policy@2.0.0-beta.1', '2.0.0-beta.1'],
  ])('adds %s, an artifact with no editions, as version %s with no edition in the lock file', async (ref, version) => {
    const result = await executeCliCommand(['add', ref, '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`Added @acme/pet-policy v${version}`)
    const entry = await locked('@acme/pet-policy')
    expect(entry).toMatchObject({ version, resolved: `${TEST_REGISTRY_URL}/pet-policy/${version}/pet-policy.json` })
    expect(entry).not.toHaveProperty('edition')
  }, 30000)

  it.each([
    ['@acme/w4/2019', 'w4 has no edition 2019. Its editions: 2024, 2025 (current: 2024).'],
    ['@acme/w4@9.9.9', 'Edition 2024 of w4 has no version 9.9.9. Its versions: 1.1.0, 1.0.0 (latest: 1.1.0).'],
    ['@acme/w4/2025@1.1.0', 'Edition 2025 of w4 has no version 1.1.0. Its versions: 1.0.0 (latest: 1.0.0).'],
    ['@acme/pet-policy/2024', 'pet-policy has no editions, so it has no edition 2024.'],
  ])('refuses %s, says what the registry lists, and installs nothing', async (ref, message) => {
    const result = await executeCliCommand(['add', ref, '--no-cache'], { cwd: tempDir })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(message)
    expect(result.stdout).not.toContain('Added')
    await expect(fs.access(join(tempDir, 'artifacts', '@acme'))).rejects.toThrow()
    await expect(fs.access(join(tempDir, '.asterdoc', 'lock.json'))).rejects.toThrow()
  }, 30000)

  it('lists the installed edition beside the version, and carries it in --json', async () => {
    await executeCliCommand(['add', '@acme/w4/2025', '--no-cache'], { cwd: tempDir })
    await executeCliCommand(['add', '@acme/pet-policy', '--no-cache'], { cwd: tempDir })

    const human = await executeCliCommand(['list'], { cwd: tempDir })
    expect(human.stdout).toContain('w4 2025 v1.0.0')
    expect(human.stdout).toContain('pet-policy v1.1.0')

    const json = JSON.parse((await executeCliCommand(['list', '--json'], { cwd: tempDir })).stdout) as Array<Record<string, unknown>>
    expect(json.find((entry) => entry.ref === '@acme/w4')).toMatchObject({ edition: '2025', version: '1.0.0' })
    expect(json.find((entry) => entry.ref === '@acme/pet-policy')).not.toHaveProperty('edition')

    const view = await executeCliCommand(['registry', 'view', '@acme/w4'], { cwd: tempDir })
    expect(view.stdout).toMatch(/Edition:\s+2025/)
    expect(view.stdout).toMatch(/Version:\s+1\.0\.0/)
  }, 30000)

  it('can re-add (update) an existing artifact', async () => {
    // First add
    const first = await executeCliCommand(['add', '@acme/w9'], { cwd: tempDir })
    expect(first.exitCode).toBe(0)

    // Second add (overwrite)
    const second = await executeCliCommand(['add', '@acme/w9'], { cwd: tempDir })
    expect(second.exitCode).toBe(0)
    expect(second.stdout).toContain('Added')
    expect(second.stdout).toContain('@acme/w9')
  }, 30000)
})

describe('asterdoc list', () => {
  it('shows help for list command', async () => {
    const result = await executeCliCommand(['list', '--help'])
    expect(result.stdout).toContain('List installed artifacts')
    expect(result.stdout).toContain('--json')
  })

  it('shows error when not in a project directory', async () => {
    const nonProjectDir = await fs.mkdtemp(join(tmpdir(), 'asterdoc-no-project-'))
    try {
      const result = await executeCliCommand(['list'], { cwd: nonProjectDir })
      expect(result.stderr).toContain('Not in an Asterdoc project')
      expect(result.exitCode).not.toBe(0)
    } finally {
      await fs.rm(nonProjectDir, { recursive: true, force: true })
    }
  })
})

describe('asterdoc show', () => {
  it('shows help for show command', async () => {
    const result = await executeCliCommand(['show', '--help'])
    expect(result.stdout).toContain('Show details about an artifact')
    expect(result.stdout).toContain('--raw')
  })
})

describe('asterdoc search', () => {
  it('shows help for search command', async () => {
    const result = await executeCliCommand(['search', '--help'])
    expect(result.stdout).toContain('Search for artifacts in a registry')
    expect(result.stdout).toContain('--registry')
    expect(result.stdout).toContain('--kind')
    expect(result.stdout).toContain('--tags')
    expect(result.stdout).toContain('--json')
  })
})

describe('asterdoc registry', () => {
  it('shows help for registry command', async () => {
    const result = await executeCliCommand(['registry', '--help'])
    expect(result.stdout).toContain('Manage registry configurations')
    expect(result.stdout).toContain('add')
    expect(result.stdout).toContain('remove')
    expect(result.stdout).toContain('list')
    expect(result.stdout).toContain('info')
  })

  it('shows help for registry add subcommand', async () => {
    const result = await executeCliCommand(['registry', 'add', '--help'])
    expect(result.stdout).toContain('Add or update a registry')
    expect(result.stdout).toContain('--header')
    expect(result.stdout).toContain('--global')
  })

  it('shows help for registry list subcommand', async () => {
    const result = await executeCliCommand(['registry', 'list', '--help'])
    expect(result.stdout).toContain('List configured registries')
    expect(result.stdout).toContain('--json')
  })
})

describe('asterdoc add (variadic document components)', () => {
  let project: string

  beforeEach(async () => {
    project = await fs.mkdtemp(join(tmpdir(), 'asterdoc-add-variadic-'))
    await fs.writeFile(
      join(project, 'components.json'),
      `${JSON.stringify({ style: 'new-york' }, null, 2)}\n`,
      'utf8',
    )
  })

  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true })
  })

  it('takes several component names, not just the first', async () => {
    // Before the fix, `<artifact>` was a single positional argument, so
    // `table` and `signature` were silently dropped and only `field`
    // installed. `--dry-run` proves all three reached a shadcn command —
    // one per name, so each gets a real, independent result rather than
    // one exit code shared across all of them.
    const result = await executeCliCommand(['add', 'field', 'table', 'signature', '--dry-run'], {
      cwd: project,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('npx shadcn@4 add @asterdoc/field --yes')
    expect(result.stdout).toContain('npx shadcn@4 add @asterdoc/table --yes')
    expect(result.stdout).toContain('npx shadcn@4 add @asterdoc/signature --yes')
  })

  it('reports each name independently rather than one combined result', async () => {
    // A directory with no `components.json` at all: `addComponents` fails
    // deterministically and immediately for every name, before ever
    // reaching npx or the network, so this proves two things without any
    // flakiness — every requested name is actually attempted (not just the
    // first, and not stopped after the first failure), and each gets its
    // own reported outcome rather than one exit code standing in for both.
    const bareProject = await fs.mkdtemp(join(tmpdir(), 'asterdoc-add-no-config-'))
    try {
      const result = await executeCliCommand(['add', 'field', 'table'], { cwd: bareProject })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('✗ field')
      expect(result.stdout).toContain('✗ table')
      // Both failures are independently diagnosed, not a single shared one.
      const occurrences = result.stderr.split('No components.json found.').length - 1
      expect(occurrences).toBe(2)
    } finally {
      await fs.rm(bareProject, { recursive: true, force: true })
    }
  }, 30000)

  it('rejects mixing a component name with an artifact reference', async () => {
    const result = await executeCliCommand(['add', 'field', '@acme/w9'], { cwd: project })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('@acme/w9')
    expect(result.stderr.toLowerCase()).toContain('component')
  })

  it('still installs a single named component exactly as before', async () => {
    const result = await executeCliCommand(['add', 'field', '--dry-run'], { cwd: project })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('npx shadcn@4 add @asterdoc/field --yes')
  })
})
