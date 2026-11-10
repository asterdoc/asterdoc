import { runCli } from '../setup/spawn-cli'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION, SCHEMA_VERSIONS, schemaVersionUrl, type SchemaVersion } from '@asterdoc/schemas'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const notice = (schema?: string) =>
  `${schema ? `$schema: ${schema}\n` : ''}kind: document\nname: notice\nlayers:\n  text:\n    kind: inline\n    mimeType: text/plain\n    text: Notice\n`

function run(args: string[], cwd: string) {
  return runCli(args, { cwd, env: { ASTERDOC_TELEMETRY_DISABLED: '1', NO_COLOR: '1' } })
}

describe('CLI loading applies the schema version rules', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'asterdoc-schema-version-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('validates and renders a current artifact', async () => {
    await writeFile(path.join(dir, 'notice.yaml'), notice(ASTERDOC_SCHEMA_URL))
    expect((await run(['validate', 'notice.yaml'], dir)).exitCode).toBe(0)
    const rendered = await run(['render', 'notice.yaml'], dir)
    expect(rendered.exitCode).toBe(0)
    expect(rendered.stdout).toContain('Notice')
  })

  it('validates and renders an earlier artifact upgraded in memory, leaving the file as it is', async () => {
    const earlier = notice(schemaVersionUrl(SCHEMA_VERSIONS.at(-2) as SchemaVersion))
    await writeFile(path.join(dir, 'notice.yaml'), earlier)
    expect((await run(['validate', 'notice.yaml'], dir)).exitCode).toBe(0)
    const rendered = await run(['render', 'notice.yaml'], dir)
    expect(rendered.exitCode).toBe(0)
    expect(rendered.stdout).toContain('Notice')
    expect(await readFile(path.join(dir, 'notice.yaml'), 'utf8')).toBe(earlier)
  })

  it('keeps an earlier $schema through attach, fix, detach and version', async () => {
    const earlier = schemaVersionUrl(SCHEMA_VERSIONS.at(-2) as SchemaVersion)
    const file = path.join(dir, 'notice.json')
    const read = async () => JSON.parse(await readFile(file, 'utf8')) as Record<string, any>
    await writeFile(file, `${JSON.stringify({ $schema: earlier, kind: 'document', name: 'notice', version: '1.0.0', layers: { text: { kind: 'inline', mimeType: 'text/plain', text: 'Notice' } } }, null, 2)}\n`)
    await writeFile(path.join(dir, 'terms.txt'), 'Terms')

    expect((await run(['attach', 'notice.json', 'terms.txt', '-y', '-n', 'terms'], dir)).exitCode).toBe(0)
    expect((await read()).$schema).toBe(earlier)
    expect((await read()).layers.terms).toBeDefined()

    await writeFile(path.join(dir, 'terms.txt'), 'Terms, changed')
    const checksum = (await read()).layers.terms.checksum
    expect((await run(['fix', 'notice.json', '-y'], dir)).exitCode).toBe(0)
    expect((await read()).$schema).toBe(earlier)
    expect((await read()).layers.terms.checksum).not.toBe(checksum)

    expect((await run(['detach', 'notice.json', 'terms', '-y'], dir)).exitCode).toBe(0)
    expect((await read()).$schema).toBe(earlier)
    expect((await read()).layers.terms).toBeUndefined()

    expect((await run(['init', '--yes', '--name', 'Notice'], dir)).exitCode).toBe(0)
    expect((await run(['version', 'notice.json', 'patch'], dir)).exitCode).toBe(0)
    expect(await read()).toMatchObject({ $schema: earlier, version: '1.0.1' })
  })

  it('migrates a bundle whose inline part is later than the bundle', async () => {
    const earlier = schemaVersionUrl(SCHEMA_VERSIONS.at(-2) as SchemaVersion)
    const file = path.join(dir, 'packet.json')
    const part = { $schema: ASTERDOC_SCHEMA_URL, kind: 'document', name: 'notice' }
    await writeFile(file, `${JSON.stringify({ $schema: earlier, kind: 'bundle', name: 'packet', contents: [{ type: 'inline', key: 'notice', artifact: part }] }, null, 2)}\n`)
    expect((await run(['validate', 'packet.json'], dir)).exitCode).toBe(0)
    expect((await run(['migrate', 'packet.json'], dir)).exitCode).toBe(0)
    const migrated = JSON.parse(await readFile(file, 'utf8')) as Record<string, any>
    expect(migrated.$schema).toBe(ASTERDOC_SCHEMA_URL)
    expect(migrated.contents[0].artifact).toEqual(part)
  })

  it('refuses a newer $schema and asks for an update', async () => {
    await writeFile(path.join(dir, 'notice.yaml'), notice('https://schema.asterdoc.com/2999-01-01.json'))
    for (const command of [['validate', 'notice.yaml'], ['render', 'notice.yaml']]) {
      const result = await run(command, dir)
      expect(result.exitCode).toBe(1)
      expect(result.stdout + result.stderr).toContain('newer than this SDK knows; update @asterdoc/core')
    }
  })

  it.each([
    ['an unpublished', 'https://schema.asterdoc.com/2020-01-01.json', 'names schema version 2020-01-01, which does not exist'],
    ['a missing', undefined, 'no $schema'],
    ['an undated', 'https://schema.asterdoc.com/schema.json', 'names no schema version'],
  ])('refuses %s $schema and points to asterdoc migrate', async (_label, schema, named) => {
    await writeFile(path.join(dir, 'notice.yaml'), notice(schema))
    for (const command of [['validate', 'notice.yaml'], ['render', 'notice.yaml']]) {
      const result = await run(command, dir)
      const output = result.stdout + result.stderr
      expect(result.exitCode).toBe(1)
      expect(output).toContain(named)
      expect(output).toContain(SCHEMA_VERSION)
      expect(output).toContain('asterdoc migrate')
    }
  })

  it('loads an artifact without $schema once migrate names its version', async () => {
    await writeFile(path.join(dir, 'notice.yaml'), notice())
    expect((await run(['validate', 'notice.yaml'], dir)).exitCode).toBe(1)
    expect((await run(['migrate', 'notice.yaml', '--from', SCHEMA_VERSION], dir)).exitCode).toBe(0)
    expect((await run(['validate', 'notice.yaml'], dir)).exitCode).toBe(0)
  })
})
