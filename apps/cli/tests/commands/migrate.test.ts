import { runCli } from '../setup/spawn-cli'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASTERDOC_SCHEMA_URL, SCHEMA_VERSION } from '@asterdoc/schemas'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const UNDATED = 'https://schema.asterdoc.com/schema.json'

const notice = (schema: string | undefined) =>
  JSON.stringify(
    {
      ...(schema ? { $schema: schema } : {}),
      kind: 'document',
      name: 'notice',
      layers: { text: { kind: 'inline', mimeType: 'text/plain', text: 'Notice' } },
    },
    null,
    2,
  ) + '\n'

const noticeYaml = `# Notice
$schema: ${UNDATED}
kind: document
name: notice
layers:
  text:
    kind: inline
    mimeType: text/plain
    text: Notice
`

function run(args: string[], cwd: string) {
  return runCli(args, { cwd, env: { ASTERDOC_TELEMETRY_DISABLED: '1', NO_COLOR: '1' } })
}

describe('asterdoc migrate', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'asterdoc-migrate-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reports a file on the current version as current and leaves it as it is', async () => {
    const file = path.join(dir, 'notice.json')
    await writeFile(file, notice(ASTERDOC_SCHEMA_URL))

    const result = await run(['migrate', 'notice.json'], dir)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('current   notice.json')
    expect(result.stdout).toContain('0 migrated, 1 current, 0 failed')
    expect(await readFile(file, 'utf-8')).toBe(notice(ASTERDOC_SCHEMA_URL))
  })

  it('adds $schema to a file without one only when --from names its version', async () => {
    const file = path.join(dir, 'notice.json')
    await writeFile(file, notice(undefined))

    const refused = await run(['migrate', 'notice.json'], dir)
    expect(refused.exitCode).toBe(1)
    expect(refused.stdout).toContain('has no $schema')
    expect(await readFile(file, 'utf-8')).toBe(notice(undefined))

    const result = await run(['migrate', 'notice.json', '--from', SCHEMA_VERSION], dir)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`migrated  notice.json  ${SCHEMA_VERSION} → ${SCHEMA_VERSION}`)
    expect(JSON.parse(await readFile(file, 'utf-8')).$schema).toBe(ASTERDOC_SCHEMA_URL)
  })

  it('migrates a directory, keeps YAML as YAML, and reports every file', async () => {
    await mkdir(path.join(dir, 'forms'))
    await writeFile(path.join(dir, 'forms', 'notice.yaml'), noticeYaml)
    await writeFile(path.join(dir, 'current.json'), notice(ASTERDOC_SCHEMA_URL))
    await writeFile(path.join(dir, 'broken.json'), '{ "kind": ')
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'not-an-artifact' }))

    const result = await run(['migrate', '.', '--from', SCHEMA_VERSION], dir)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('migrated  forms/notice.yaml')
    expect(result.stdout).toContain('current   current.json')
    expect(result.stdout).toMatch(/failed {4}broken\.json: The file is not valid JSON/)
    expect(result.stdout).not.toContain('package.json')
    expect(result.stdout).toContain('1 migrated, 1 current, 1 failed')
    expect(await readFile(path.join(dir, 'forms', 'notice.yaml'), 'utf-8')).toBe(noticeYaml.replace(UNDATED, ASTERDOC_SCHEMA_URL))
  })

  it('prints a diff on --dry-run and writes nothing', async () => {
    const file = path.join(dir, 'notice.yaml')
    await writeFile(file, noticeYaml)

    const result = await run(['migrate', 'notice.yaml', '--from', SCHEMA_VERSION, '--dry-run'], dir)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`-$schema: ${UNDATED}`)
    expect(result.stdout).toContain(`+$schema: ${ASTERDOC_SCHEMA_URL}`)
    expect(result.stdout).toContain('Dry run: no files were written.')
    expect(await readFile(file, 'utf-8')).toBe(noticeYaml)
  })

  it('refuses a $schema that names an unpublished version and leaves the file as it is', async () => {
    const file = path.join(dir, 'notice.json')
    const source = notice('https://schema.asterdoc.com/2020-01-01.json')
    await writeFile(file, source)

    const result = await run(['migrate', 'notice.json'], dir)

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('names schema version 2020-01-01, which does not exist')
    expect(await readFile(file, 'utf-8')).toBe(source)
  })

  it('names in --help every file that needs --from', async () => {
    const result = await run(['migrate', '--help'], dir)
    expect(result.exitCode).toBe(0)
    const from = result.stdout.slice(result.stdout.indexOf('--from'), result.stdout.indexOf('-h, --help'))
    expect(from.replace(/\s+/g, ' ').trim()).toMatchInlineSnapshot(
      `"--from <version> Schema version of a file whose $schema is missing, undated (schema.json), an unpublished version, or not an Asterdoc address"`,
    )
  })

  it('rejects an unknown --from version', async () => {
    await writeFile(path.join(dir, 'notice.json'), notice(undefined))
    const result = await run(['migrate', 'notice.json', '--from', '2020-01-01'], dir)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown schema version: 2020-01-01')
  })
})
