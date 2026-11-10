import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runCli } from '../setup/spawn-cli.js'

const root = mkdtempSync(path.join(tmpdir(), 'asterdoc-cli-tests-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const write = (name: string, tests: unknown[]): string => {
  const file = path.join(root, name)
  writeFileSync(file, JSON.stringify({
    $schema: 'https://schema.asterdoc.com/2026-11-10.json',
    kind: 'form',
    name: 'payee',
    title: 'Payee',
    version: '1.0.0',
    fields: {
      account: { type: 'text', sensitive: true },
      startDate: { type: 'date' },
      bank: { type: 'text' },
    },
    rules: {
      accountLength: { expr: 'length(account) == 12', message: 'Account numbers have 12 digits' },
      notPast: { expr: 'fields.startDate >= today()', message: 'Start date is in the past' },
    },
    tests,
  }))
  return file
}

const passing = { name: 'future start', input: { fields: { startDate: '2026-12-01', bank: 'First' } }, context: { asOf: '2026-11-10T00:00:00Z' }, expect: { valid: false, failures: ['accountLength'] } }

describe('asterdoc validate runs form test cases', () => {
  it('passes when every test case matches', async () => {
    const result = await runCli(['validate', write('passing.json', [passing]), '--json'], { cwd: root })
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.tests).toEqual([{ name: 'future start', ok: true }])
    expect(payload.warnings).toEqual([])
  })

  it('fails and names the difference when a test case does not match', async () => {
    const failing = { ...passing, name: 'late start', context: { asOf: '2027-01-01T00:00:00Z' } }
    const result = await runCli(['validate', write('failing.json', [passing, failing]), '--json'], { cwd: root })
    expect(result.exitCode).toBe(1)
    const payload = JSON.parse(result.stdout)
    expect(payload.tests).toEqual([{ name: 'future start', ok: true }, { name: 'late start', ok: false }])
    expect(payload.errors).toEqual([{
      message: 'Test "late start" failed: expected failures accountLength, got accountLength, notPast',
      path: ['tests', '1'],
    }])
  })

  it('names the failed rules when a test case expects a valid draft', async () => {
    const expectsValid = { ...passing, name: 'expects valid', expect: { valid: true } }
    const result = await runCli(['validate', write('expects-valid.json', [expectsValid]), '--json'], { cwd: root })
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout).errors).toEqual([{
      message: 'Test "expects valid" failed: expected valid true, got false (failed rules: accountLength)',
      path: ['tests', '0'],
    }])
  })

  it('reports a logic error over a sensitive value without the value', async () => {
    const file = path.join(root, 'logic-error.json')
    writeFileSync(file, JSON.stringify({
      $schema: 'https://schema.asterdoc.com/2026-11-10.json',
      kind: 'form',
      name: 'patterned',
      title: 'Patterned',
      version: '1.0.0',
      fields: { pattern: { type: 'text', sensitive: true } },
      defs: { shaped: { type: 'boolean', value: 'matches("abc", fields.pattern)' } },
      tests: [{ name: 'bad pattern', input: { fields: { pattern: '(SYNTHETIC' } }, expect: { valid: true } }],
    }))
    const result = await runCli(['validate', file, '--json'], { cwd: root })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('Failed to evaluate computed value \\"shaped\\"')
    expect(result.stdout).not.toContain('(SYNTHETIC')
  })

  it('warns when a test case sets a sensitive field', async () => {
    const sensitive = { name: 'with account', input: { fields: { account: '000000000000', startDate: '2026-12-01' } }, context: { asOf: '2026-11-10T00:00:00Z' }, expect: { valid: true, failures: [] } }
    const result = await runCli(['validate', write('sensitive.json', [sensitive]), '--json'], { cwd: root })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).warnings).toEqual([{
      message: 'Test "with account" sets the sensitive field fields.account. Tests ship inside the artifact: use synthetic values only.',
      path: ['tests', '0', 'input', 'fields.account'],
    }])
  })

  it.each(['--schema-only', '--checksum-only'])('skips test cases with %s', async (flag) => {
    const failing = { ...passing, expect: { valid: true } }
    const file = write(`skipped${flag}.json`, [failing])
    expect((await runCli(['validate', file, '--json'], { cwd: root })).exitCode).toBe(1)
    const result = await runCli(['validate', file, flag, '--json'], { cwd: root })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).tests).toBeUndefined()
  })
})
