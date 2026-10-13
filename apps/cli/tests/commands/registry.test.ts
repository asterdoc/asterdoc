import { runCli as executeCliCommand } from '../setup/spawn-cli'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { PARADOC_SCHEMA_URL, RegistryIndexSchema, RegistryItemSchema } from '@paradoc/schemas'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('CLI Registry Command', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paradoc-registry-test-'))
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  const CONFIG = 'registry.config.json'
  const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')

  /** A form source file: one release. */
  function form(name: string, version: string, edition?: { key: string; label: string; date?: string; effectiveFrom?: string }) {
    return {
      $schema: PARADOC_SCHEMA_URL,
      kind: 'form',
      name,
      version,
      ...(edition && { edition }),
      title: `Form ${name}`,
      fields: { name: { type: 'text', label: 'Name', required: true } },
    }
  }

  /** Write source files and a registry.config.json that lists them. */
  async function writeRegistry(dir: string, files: Record<string, unknown>, config: Record<string, unknown> = {}): Promise<string> {
    for (const [file, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
      await fs.writeFile(path.join(dir, file), JSON.stringify(content))
    }
    const configPath = path.join(dir, CONFIG)
    await fs.writeFile(configPath, JSON.stringify({ name: 'test-registry', sources: Object.keys(files), ...config }))
    return configPath
  }

  const readConfig = async (dir: string) => JSON.parse(await fs.readFile(path.join(dir, CONFIG), 'utf-8'))

  async function compile(dir: string, extra: string[] = []) {
    const outDir = path.join(dir, 'out')
    const result = await executeCliCommand(['registry', 'compile', '--config', path.join(dir, CONFIG), '--output', outDir, ...extra])
    return { result, outDir, output: result.stdout + result.stderr }
  }

  const readManifest = async (outDir: string) =>
    RegistryIndexSchema.parse(JSON.parse(await fs.readFile(path.join(outDir, 'registry.json'), 'utf8')))

  describe('registry --help', () => {
    it('should list all subcommands', async () => {
      const result = await executeCliCommand(['registry', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('add')
      expect(result.stdout).toContain('remove')
      expect(result.stdout).toContain('list')
      expect(result.stdout).toContain('make')
      expect(result.stdout).toContain('info')
      expect(result.stdout).toContain('catalog')
      expect(result.stdout).toContain('stats')
      expect(result.stdout).toContain('compile')
      expect(result.stdout).toContain('view')
    })
  })

  describe('registry list', () => {
    it('should list registries with --json', async () => {
      const globalDir = path.join(tempDir, 'global')
      await fs.mkdir(path.join(globalDir, '.paradoc'), { recursive: true })
      await fs.writeFile(
        path.join(globalDir, '.paradoc', 'config.json'),
        JSON.stringify({
          registries: {
            '@test': 'https://example.com/registry',
          },
        })
      )

      const result = await executeCliCommand(['registry', 'list', '--json'], {
        env: { HOME: globalDir, XDG_CONFIG_HOME: path.join(globalDir, '.paradoc') },
      })

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(Array.isArray(parsed)).toBe(true)
    })

    it('should show registries in human format', async () => {
      const globalDir = path.join(tempDir, 'global')
      await fs.mkdir(path.join(globalDir, '.paradoc'), { recursive: true })
      await fs.writeFile(
        path.join(globalDir, '.paradoc', 'config.json'),
        JSON.stringify({
          registries: {
            '@test': 'https://example.com/registry',
          },
        })
      )

      const result = await executeCliCommand(['registry', 'list'], {
        env: { HOME: globalDir, XDG_CONFIG_HOME: path.join(globalDir, '.paradoc') },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('@test')
    })
  })

  describe('registry make', () => {
    it('should create a registry.config.json with --yes --name', async () => {
      const result = await executeCliCommand(
        ['registry', 'make', tempDir, '--yes', '--name', 'test-registry'],
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('test-registry')

      // The config is the publisher's source; the manifest is what compile writes
      const registry = await readConfig(tempDir)
      expect(registry).toEqual({ name: 'test-registry', enableTelemetry: true, enableDirectory: true, sources: [] })
      await expect(fs.access(path.join(tempDir, 'registry.json'))).rejects.toThrow()
    })

    it('should create registry with description and homepage', async () => {
      const result = await executeCliCommand(
        ['registry', 'make', tempDir, '--yes', '--name', 'my-reg', '--description', 'A test registry', '--homepage', 'https://example.com'],
      )

      expect(result.exitCode).toBe(0)

      const registry = await readConfig(tempDir)
      expect(registry.name).toBe('my-reg')
      expect(registry.description).toBe('A test registry')
      expect(registry.homepage).toBe('https://example.com')
    })

    it('should slugify invalid names in --yes mode', async () => {
      const result = await executeCliCommand(
        ['registry', 'make', tempDir, '--yes', '--name', 'My Registry!'],
      )

      expect(result.exitCode).toBe(0)

      const registry = await readConfig(tempDir)
      // Should be slugified to lowercase with hyphens
      expect(registry.name).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    })

    it('has no --artifacts-path: every manifest path is relative to the registry base address', async () => {
      const result = await executeCliCommand(
        ['registry', 'make', tempDir, '--yes', '--name', 'test-reg', '--artifacts-path', '/r'],
      )

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain("unknown option '--artifacts-path'")
    })

    it('should support --no-directory flag', async () => {
      const result = await executeCliCommand(
        ['registry', 'make', tempDir, '--yes', '--name', 'test-reg', '--no-directory'],
      )

      expect(result.exitCode).toBe(0)

      const registry = await readConfig(tempDir)
      expect(registry.enableDirectory).toBe(false)
      expect(registry.enableTelemetry).toBe(true)
    })

    it('writes the registry telemetry opt-out', async () => {
      const result = await executeCliCommand(
        ['registry', 'make', tempDir, '--yes', '--name', 'test-reg', '--no-registry-telemetry'],
      )

      expect(result.exitCode).toBe(0)
      expect((await readConfig(tempDir)).enableTelemetry).toBe(false)
    })

    it('makes a config that compiles to a valid, empty manifest', async () => {
      await executeCliCommand(['registry', 'make', tempDir, '--yes', '--name', 'test-reg'])
      const { result, outDir } = await compile(tempDir)

      expect(result.exitCode).toBe(0)
      expect((await readManifest(outDir)).items).toEqual([])
    })
  })

  describe('registry add', () => {
    it('refuses @paradoc, which is reserved, and writes no config', async () => {
      const home = path.join(tempDir, 'home')
      await fs.mkdir(home, { recursive: true })

      for (const namespace of ['@paradoc', 'paradoc', '@PARADOC']) {
        const result = await executeCliCommand(
          ['registry', 'add', namespace, 'https://evil.example', '--global'],
          { cwd: tempDir, env: { HOME: home } }
        )

        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('is reserved for the Paradoc registry; it cannot be configured')
      }
      await expect(fs.access(path.join(home, '.paradoc', 'config.json'))).rejects.toThrow()
    })

    it('adds any other namespace', async () => {
      const home = path.join(tempDir, 'home')
      await fs.mkdir(home, { recursive: true })

      const result = await executeCliCommand(
        ['registry', 'add', '@acme', 'https://registry.acme.com', '--global'],
        { cwd: tempDir, env: { HOME: home } }
      )

      expect(result.exitCode).toBe(0)
      const config = JSON.parse(await fs.readFile(path.join(home, '.paradoc', 'config.json'), 'utf-8'))
      expect(config.registries).toEqual({ '@acme': 'https://registry.acme.com' })
    })

    it('uses project scope without prompting when --yes is passed in a project', async () => {
      const project = path.join(tempDir, 'project')
      const home = path.join(tempDir, 'home')
      await fs.mkdir(path.join(project, '.paradoc'), { recursive: true })
      await fs.writeFile(path.join(project, 'paradoc.json'), JSON.stringify({ name: '@test/project', title: 'Project' }))

      const result = await executeCliCommand(
        ['registry', 'add', '@acme', 'https://registry.acme.com', '--yes'],
        { cwd: project, env: { HOME: home } },
      )

      expect(result.exitCode).toBe(0)
      expect(result.stdout).not.toContain('Where would you like')
      const manifest = JSON.parse(await fs.readFile(path.join(project, 'paradoc.json'), 'utf8'))
      expect(manifest.registries, result.stdout + result.stderr).toEqual({ '@acme': 'https://registry.acme.com' })
    })
  })

  describe('registry remove', () => {
    it('should show error for non-existent namespace with --global', async () => {
      const globalDir = path.join(tempDir, 'global')
      await fs.mkdir(path.join(globalDir, '.paradoc'), { recursive: true })
      await fs.writeFile(
        path.join(globalDir, '.paradoc', 'config.json'),
        JSON.stringify({ registries: {} })
      )

      const result = await executeCliCommand(
        ['registry', 'remove', '@nonexistent', '--global'],
        { env: { HOME: globalDir, XDG_CONFIG_HOME: path.join(globalDir, '.paradoc') } }
      )

      // Should succeed but report not found
      const output = result.stdout + result.stderr
      expect(output).toMatch(/not found|no registr/i)
    })

    /** Ctrl+C: cancels the selection prompt once it has listed its choices. */
    const CANCEL = '\u0003'

    /** A project and a home that both configure @acme, plus one registry each of their own. */
    async function projectWithBothScopes(): Promise<{ project: string; home: string }> {
      const home = path.join(tempDir, 'home')
      const project = path.join(tempDir, 'project')
      await fs.mkdir(path.join(home, '.paradoc'), { recursive: true })
      await fs.mkdir(path.join(project, '.paradoc'), { recursive: true })
      await fs.writeFile(
        path.join(home, '.paradoc', 'config.json'),
        JSON.stringify({ registries: { '@acme': 'https://global.acme.example', '@global-only': 'https://global-only.example' } })
      )
      await fs.writeFile(
        path.join(project, 'paradoc.json'),
        JSON.stringify({
          name: '@test/test-project',
          title: 'Test Project',
          visibility: 'private',
          registries: { '@acme': 'https://project.acme.example', '@project-only': 'https://project-only.example' },
        })
      )
      return { project, home }
    }

    it('offers only global registries with --global', async () => {
      const { project, home } = await projectWithBothScopes()

      const result = await executeCliCommand(['registry', 'remove', '--global'], { cwd: project, env: { HOME: home }, input: CANCEL })

      expect(result.stdout).toContain('https://global.acme.example')
      expect(result.stdout).toContain('@global-only')
      expect(result.stdout).not.toContain('https://project.acme.example')
      expect(result.stdout).not.toContain('@project-only')
    })

    it('offers only project registries with --project', async () => {
      const { project, home } = await projectWithBothScopes()

      const result = await executeCliCommand(['registry', 'remove', '--project'], { cwd: project, env: { HOME: home }, input: CANCEL })

      expect(result.stdout).toContain('https://project.acme.example')
      expect(result.stdout).toContain('@project-only')
      expect(result.stdout).not.toContain('https://global.acme.example')
      expect(result.stdout).not.toContain('@global-only')
    })

    it('says so when the chosen scope has no registries', async () => {
      const home = path.join(tempDir, 'home')
      await fs.mkdir(home, { recursive: true })

      const result = await executeCliCommand(['registry', 'remove', '--global'], { cwd: tempDir, env: { HOME: home } })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('No registries in global config.')
    })
  })

  describe('registry stats', () => {
    const digest = 'a'.repeat(64)
    const manifest = {
      name: 'test-registry',
      items: [
        {
          name: 'my-form',
          kind: 'form',
          currentEdition: '2024-03',
          editions: {
            '2024-03': { label: 'Rev. March 2024', latestVersion: '1.1.0', versions: {
              '1.1.0': { path: 'my-form/2024-03/1.1.0/my-form.json', sha256: digest },
              '1.0.0': { path: 'my-form/2024-03/1.0.0/my-form.json', sha256: digest },
            } },
            '2018-10': { label: 'Rev. October 2018', latestVersion: '1.0.0', versions: {
              '1.0.0': { path: 'my-form/2018-10/1.0.0/my-form.json', sha256: digest },
            } },
          },
        },
        { name: 'my-doc', kind: 'document', latestVersion: '1.0.0', versions: { '1.0.0': { path: 'my-doc/1.0.0/my-doc.json', sha256: digest } } },
      ],
    }

    it('should show stats for a local registry.json', async () => {
      await fs.writeFile(path.join(tempDir, 'registry.json'), JSON.stringify(manifest))

      const result = await executeCliCommand(
        ['registry', 'stats', '--registry', path.join(tempDir, 'registry.json')],
      )

      expect(result.exitCode).toBe(0)
      const output = result.stdout
      expect(output).toContain('test-registry')
      expect(output).toMatch(/Total artifacts:\s+2/)
      expect(output).toMatch(/Total editions:\s+2/)
      expect(output).toMatch(/Total releases:\s+4/)
    })

    it('should output stats as JSON', async () => {
      await fs.writeFile(path.join(tempDir, 'registry.json'), JSON.stringify(manifest))

      const result = await executeCliCommand(
        ['registry', 'stats', '--registry', path.join(tempDir, 'registry.json'), '--json'],
      )

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toMatchObject({ name: 'test-registry', totalArtifacts: 2, totalEditions: 2, totalReleases: 4 })
      expect(parsed.byKind).toEqual({ form: 1, document: 1 })
    })

    it('refuses a manifest that breaks the schema, and prints each issue with its path', async () => {
      await fs.writeFile(
        path.join(tempDir, 'registry.json'),
        JSON.stringify({
          name: 'test-registry',
          artifactsPath: '/r',
          items: [
            { name: 'my-form', kind: 'form', version: '1.0.0' },
            { ...manifest.items[1], latestVersion: '9.9.9' },
          ],
        })
      )

      const result = await executeCliCommand(
        ['registry', 'stats', '--registry', path.join(tempDir, 'registry.json')],
      )

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('is not a valid registry manifest')
      expect(result.stderr).toMatch(/• root: .*artifactsPath/)
      expect(result.stderr).toMatch(/• items\[0\]: /)
      expect(result.stderr).toContain('• items[1].latestVersion: latestVersion "9.9.9" is not a key of versions (1.0.0)')
    })

    it('rejects a namespace argument: stats read a local registry.json only', async () => {
      const result = await executeCliCommand(['registry', 'stats', '@ns'], { cwd: tempDir })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('too many arguments')
      expect(result.stdout).not.toContain('not yet implemented')
    })

    it('should show error for nonexistent registry.json', async () => {
      const result = await executeCliCommand(
        ['registry', 'stats', '--registry', path.join(tempDir, 'nope.json')],
      )

      expect(result.exitCode).toBe(1)
    })
  })

  describe('registry catalog add', () => {
    const add = (dir: string, file: string) =>
      executeCliCommand(['registry', 'catalog', 'add', path.join(dir, file), '--config', path.join(dir, CONFIG)], { cwd: dir })

    it('should add an artifact source file to the catalog', async () => {
      // Resolve realpath to avoid macOS /var → /private/var symlink mismatch
      const realTempDir = await fs.realpath(tempDir)
      await writeRegistry(realTempDir, {})
      await fs.mkdir(path.join(realTempDir, 'forms'))
      await fs.writeFile(path.join(realTempDir, 'forms', 'my-form.json'), JSON.stringify(form('my-form', '1.0.0')))

      const result = await add(realTempDir, 'forms/my-form.json')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('my-form v1.0.0')
      expect((await readConfig(realTempDir)).sources).toEqual(['forms/my-form.json'])
    })

    it('adds a second version and a second edition of the same artifact as more source files', async () => {
      const realTempDir = await fs.realpath(tempDir)
      const march = { key: '2024-03', label: 'Rev. March 2024', date: '2024-03' }
      await writeRegistry(realTempDir, { 'a.json': form('w-9', '1.0.0', march) })
      await fs.writeFile(path.join(realTempDir, 'b.json'), JSON.stringify(form('w-9', '1.1.0', march)))
      await fs.writeFile(path.join(realTempDir, 'c.json'), JSON.stringify(form('w-9', '1.0.0', { key: '2018-10', label: 'Rev. October 2018', date: '2018-10' })))

      expect((await add(realTempDir, 'b.json')).exitCode).toBe(0)
      const result = await add(realTempDir, 'c.json')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('w-9 2018-10 v1.0.0')
      expect((await readConfig(realTempDir)).sources).toEqual(['a.json', 'b.json', 'c.json'])
    })

    it('refuses a second file for a release the catalog already has, and changes nothing', async () => {
      const realTempDir = await fs.realpath(tempDir)
      await writeRegistry(realTempDir, { 'a.json': form('my-form', '1.0.0') })
      await fs.writeFile(path.join(realTempDir, 'copy.json'), JSON.stringify(form('my-form', '1.0.0')))

      const result = await add(realTempDir, 'copy.json')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('a.json and copy.json are the same release')
      expect((await readConfig(realTempDir)).sources).toEqual(['a.json'])
    })

    it('refuses a file with an edition when the artifact has files with none', async () => {
      const realTempDir = await fs.realpath(tempDir)
      await writeRegistry(realTempDir, { 'a.json': form('my-form', '1.0.0') })
      await fs.writeFile(path.join(realTempDir, 'b.json'), JSON.stringify(form('my-form', '1.1.0', { key: '2024-03', label: 'Rev. March 2024' })))

      const result = await add(realTempDir, 'b.json')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('b.json has an edition and a.json has none')
      expect((await readConfig(realTempDir)).sources).toEqual(['a.json'])
    })

    it('refuses a version with build metadata', async () => {
      const realTempDir = await fs.realpath(tempDir)
      await writeRegistry(realTempDir, {})
      await fs.writeFile(path.join(realTempDir, 'a.json'), JSON.stringify(form('my-form', '1.0.0+build.5')))

      const result = await add(realTempDir, 'a.json')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('version "1.0.0+build.5" has build metadata')
      expect((await readConfig(realTempDir)).sources).toEqual([])
    })

    it('should fail when the config does not exist', async () => {
      await fs.writeFile(path.join(tempDir, 'my-form.json'), JSON.stringify(form('my-form', '1.0.0')))

      const result = await executeCliCommand(
        ['registry', 'catalog', 'add', 'my-form.json', '--config', path.join(tempDir, 'nope.json')],
        { cwd: tempDir }
      )

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Registry config not found')
    })

    it('should fail for artifact outside registry tree', async () => {
      // Create the config in a subdirectory
      const subDir = path.join(tempDir, 'sub')
      await fs.mkdir(subDir, { recursive: true })
      await writeRegistry(subDir, {})

      // Create artifact in parent directory
      await fs.writeFile(path.join(tempDir, 'outside.json'), JSON.stringify(form('outside', '1.0.0')))

      const result = await executeCliCommand(
        ['registry', 'catalog', 'add', path.join(tempDir, 'outside.json'), '--config', path.join(subDir, CONFIG)],
        { cwd: subDir }
      )

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/security|outside|above/i)
    })
  })

  describe('registry catalog remove', () => {
    const march = { key: '2024-03', label: 'Rev. March 2024', date: '2024-03' }
    const files = {
      'w-9-a.json': form('w-9', '1.0.0', march),
      'w-9-b.json': form('w-9', '1.1.0', march),
      'my-doc.json': form('my-doc', '1.0.0'),
    }
    const config = {
      defaults: { 'w-9': { currentEdition: '2024-03' }, 'my-doc': { latestVersion: '1.0.0' } },
      tags: { 'w-9': ['tax'] },
    }
    const remove = (target: string) =>
      executeCliCommand(['registry', 'catalog', 'remove', target, '--config', path.join(tempDir, CONFIG), '--yes'], { cwd: tempDir })

    it('removes every source file of an artifact by name, with its defaults and tags', async () => {
      await writeRegistry(tempDir, files, config)

      const result = await remove('w-9')

      expect(result.exitCode).toBe(0)
      const after = await readConfig(tempDir)
      expect(after.sources).toEqual(['my-doc.json'])
      expect(after.defaults).toEqual({ 'my-doc': { latestVersion: '1.0.0' } })
      expect(after.tags).toBeUndefined()
      expect((await compile(tempDir)).result.exitCode).toBe(0)
    })

    it('removes one source file by its path and keeps the defaults of an artifact that still has files', async () => {
      await writeRegistry(tempDir, files, config)

      const result = await remove('w-9-b.json')

      expect(result.exitCode).toBe(0)
      const after = await readConfig(tempDir)
      expect(after.sources).toEqual(['w-9-a.json', 'my-doc.json'])
      expect(after.defaults).toEqual(config.defaults)
      expect(after.tags).toEqual(config.tags)
    })

    it('should fail for nonexistent artifact name', async () => {
      await writeRegistry(tempDir, files, config)

      const result = await remove('nope')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Artifact not found: nope')
      expect((await readConfig(tempDir)).sources).toHaveLength(3)
    })
  })

  describe('registry compile', () => {
    const march = { key: '2024-03', label: 'Rev. March 2024', date: '2024-03' }
    const october = { key: '2018-10', label: 'Rev. October 2018', date: '2018-10', effectiveFrom: '2018-11-01' }
    const future = { key: '2999-01', label: 'Rev. January 2999', date: '2999-01' }

    it('should compile artifacts with --dry-run and write nothing', async () => {
      await writeRegistry(tempDir, { 'my-form.json': form('my-form', '1.0.0') })

      const { result, outDir, output } = await compile(tempDir, ['--dry-run'])

      expect(result.exitCode).toBe(0)
      expect(output).toContain('my-form v1.0.0: would compile')
      expect(result.stdout).toContain('dry run')
      await expect(fs.access(outDir)).rejects.toThrow()
    })

    it('writes an artifact with no editions at <name>/<version>/ and lists it with the checksum of the bytes written', async () => {
      await writeRegistry(tempDir, { 'src/my-form.json': form('my-form', '1.0.0') }, { tags: { 'my-form': ['lease'] } })

      const { result, outDir } = await compile(tempDir)

      expect(result.exitCode).toBe(0)
      const written = await fs.readFile(path.join(outDir, 'my-form/1.0.0/my-form.json'))
      expect((await readManifest(outDir)).items).toEqual([
        {
          name: 'my-form',
          kind: 'form',
          title: 'Form my-form',
          latestVersion: '1.0.0',
          versions: { '1.0.0': { path: 'my-form/1.0.0/my-form.json', sha256: sha256(written) } },
          tags: ['lease'],
        },
      ])
      const raw = JSON.parse(await fs.readFile(path.join(outDir, 'registry.json'), 'utf8'))
      expect(raw).not.toHaveProperty('artifactsPath')
      expect(raw).not.toHaveProperty('sources')
      expect(raw).not.toHaveProperty('tags')
    })

    it('groups source files with one name into one item: its editions and versions, at <name>/<edition>/<version>/', async () => {
      await writeRegistry(tempDir, {
        'a.json': form('w-9', '1.0.0', march),
        'b.json': form('w-9', '1.1.0', march),
        'c.json': form('w-9', '2.0.0-beta.1', march),
        'd.json': form('w-9', '1.0.0', october),
        'e.json': form('w-9', '1.0.0', future),
      })

      const { result, outDir } = await compile(tempDir)

      expect(result.exitCode).toBe(0)
      const manifest = await readManifest(outDir)
      expect(manifest.items).toHaveLength(1)
      const item = manifest.items[0]!
      if (item.editions === undefined) throw new Error('expected editions')
      // The newest edition that has started, not the one dated in the future
      expect(item.currentEdition).toBe('2024-03')
      expect(Object.keys(item.editions).sort()).toEqual(['2018-10', '2024-03', '2999-01'])
      // The highest version that is not a pre-release
      expect(item.editions['2024-03']).toMatchObject({ label: 'Rev. March 2024', date: '2024-03', latestVersion: '1.1.0' })
      expect(Object.keys(item.editions['2024-03']!.versions).sort()).toEqual(['1.0.0', '1.1.0', '2.0.0-beta.1'])
      expect(item.editions['2018-10']).toMatchObject({ label: 'Rev. October 2018', effectiveFrom: '2018-11-01', latestVersion: '1.0.0' })
      expect(item).not.toHaveProperty('latestVersion')
      expect(item).not.toHaveProperty('versions')

      for (const edition of Object.values(item.editions)) {
        for (const [version, entry] of Object.entries(edition.versions)) {
          const written = await fs.readFile(path.join(outDir, entry.path))
          expect(entry.sha256).toBe(sha256(written))
          expect(JSON.parse(written.toString()).version).toBe(version)
        }
      }
      expect(item.editions['2024-03']!.versions['1.1.0']!.path).toBe('w-9/2024-03/1.1.0/w-9.json')
    })

    it('uses the current edition and latest version the config states', async () => {
      await writeRegistry(
        tempDir,
        { 'a.json': form('w-9', '1.0.0', march), 'b.json': form('w-9', '2.0.0-beta.1', march), 'c.json': form('w-9', '1.0.0', future) },
        { defaults: { 'w-9': { currentEdition: '2999-01', editions: { '2024-03': { latestVersion: '2.0.0-beta.1' } } } } },
      )

      const { result, outDir } = await compile(tempDir)

      expect(result.exitCode).toBe(0)
      const item = (await readManifest(outDir)).items[0]!
      expect(item.currentEdition).toBe('2999-01')
      expect(item.editions?.['2024-03']?.latestVersion).toBe('2.0.0-beta.1')
    })

    it.each([
      [
        'one file with an edition and one with none for the same name',
        { 'a.json': form('w-9', '1.0.0', march), 'b.json': form('w-9', '1.1.0') },
        {},
        'w-9: a.json has an edition and b.json has none. An artifact has editions in every release or in none',
      ],
      [
        'a version with build metadata',
        { 'a.json': form('w-9', '1.0.0+build.5') },
        {},
        'a.json: version "1.0.0+build.5" has build metadata',
      ],
      [
        'two files for one release',
        { 'a.json': form('w-9', '1.0.0', march), 'b.json': form('w-9', '1.0.0', march) },
        {},
        'w-9 2024-03 v1.0.0: a.json and b.json are the same release',
      ],
      [
        'only pre-release versions and no stated default',
        { 'a.json': form('w-9', '1.0.0-rc.1') },
        {},
        'w-9: every version is a pre-release (1.0.0-rc.1)',
      ],
      [
        'editions that all start in the future and no stated default',
        { 'a.json': form('w-9', '1.0.0', future), 'b.json': form('w-9', '1.0.0', { key: '2998-01', label: 'Rev. January 2998', date: '2998-01' }) },
        {},
        'w-9: cannot choose the current edition, because every edition starts after today',
      ],
      [
        'a stated current edition that no source file has',
        { 'a.json': form('w-9', '1.0.0', march) },
        { defaults: { 'w-9': { currentEdition: '2020-01' } } },
        'defaults["w-9"].currentEdition names edition "2020-01", which no source file has (2024-03)',
      ],
      [
        'a stated latest version that no source file has',
        { 'a.json': form('w-9', '1.0.0') },
        { defaults: { 'w-9': { latestVersion: '3.0.0' } } },
        'defaults["w-9"].latestVersion names version "3.0.0", which no source file has (1.0.0)',
      ],
      [
        'a name that is not a lowercase slug',
        { 'a.json': form('W9Form', '1.0.0') },
        {},
        'registry.json: items[0].name: Expected an artifact name',
      ],
    ])('refuses %s, says why, and writes nothing', async (_what, files, config, message) => {
      await writeRegistry(tempDir, files, config)

      const { result, outDir, output } = await compile(tempDir)

      expect(result.exitCode).toBe(1)
      expect(output).toContain(message)
      expect(output).toContain('Nothing was written')
      await expect(fs.access(outDir)).rejects.toThrow()
    })

    it('should record checksums for a PDF layer and its declared font, and put both in the release folder', async () => {
      await writeRegistry(tempDir, {
        'font-form.json': {
          ...form('font-form', '1.0.0'),
          layers: {
            pdf: { kind: 'file', mimeType: 'application/pdf', path: 'form.pdf', font: { path: 'fonts/form.ttf' } },
          },
        },
      })
      await fs.writeFile(path.join(tempDir, 'form.pdf'), 'pdf bytes')
      await fs.mkdir(path.join(tempDir, 'fonts'))
      await fs.writeFile(path.join(tempDir, 'fonts', 'form.ttf'), 'font bytes')

      const { result, outDir } = await compile(tempDir)
      expect(result.exitCode).toBe(0)

      const releaseDir = path.join(outDir, 'font-form/1.0.0')
      const compiled = JSON.parse(await fs.readFile(path.join(releaseDir, 'font-form.json'), 'utf8'))
      expect(RegistryItemSchema.safeParse(compiled).success).toBe(true)
      const digest = (text: string) => `sha256:${sha256(text)}`
      expect(compiled.layers.pdf.checksum).toBe(digest('pdf bytes'))
      expect(compiled.layers.pdf.font).toEqual({ path: 'fonts/form.ttf', checksum: digest('font bytes') })
      expect(await fs.readFile(path.join(releaseDir, 'form.pdf'), 'utf8')).toBe('pdf bytes')
      expect(await fs.readFile(path.join(releaseDir, 'fonts/form.ttf'), 'utf8')).toBe('font bytes')
      expect((await readManifest(outDir)).items[0]!.layers).toEqual(['pdf'])
    })

    it('should report errors for missing artifact files', async () => {
      await writeRegistry(tempDir, { 'my-form.json': form('my-form', '1.0.0') }, { sources: ['my-form.json', 'missing-form.json'] })

      const { result, outDir, output } = await compile(tempDir)

      expect(result.exitCode).toBe(1)
      expect(output).toContain('missing-form.json: artifact file not found')
      await expect(fs.access(outDir)).rejects.toThrow()
    })

    it('refuses a config with an unknown key, and names it', async () => {
      await writeRegistry(tempDir, {}, { artifactsPath: '/r' })

      const { result, output } = await compile(tempDir)

      expect(result.exitCode).toBe(1)
      expect(output).toMatch(/registry config .* is not valid/)
      expect(output).toContain('artifactsPath')
    })
  })

  describe('registry view', () => {
    it('should show help for view subcommand', async () => {
      const result = await executeCliCommand(['registry', 'view', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('artifact')
    })

    it('should fail for invalid artifact reference', async () => {
      const result = await executeCliCommand(['registry', 'view', 'invalid-ref'])

      expect(result.exitCode).toBe(1)
    })
  })

  describe('registry info', () => {
    it('should show help for info subcommand', async () => {
      const result = await executeCliCommand(['registry', 'info', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('namespace')
    })
  })
})
