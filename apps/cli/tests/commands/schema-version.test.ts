import { runCli } from '../setup/spawn-cli'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION } from '@asterdoc/schemas'

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
