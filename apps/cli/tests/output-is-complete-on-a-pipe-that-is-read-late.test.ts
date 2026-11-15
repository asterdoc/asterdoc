import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/schemas'

const builtCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js')
const PIPE_CAPACITY = 65_536
const LAYER_COUNT = 400
const MISSING_FILE_COUNT = 900

interface Captured {
  stdout: string
  stderr: string
  exitCode: number | null
}

function readLateAndSlowly(stream: Readable, chunks: Buffer[], startAfterMs: number): void {
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
    stream.pause()
    setTimeout(() => stream.resume(), 5)
  })
  stream.pause()
  setTimeout(() => stream.resume(), startAfterMs)
}

function runWithLateReader(args: string[], cwd: string, startAfterMs = 750): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [builtCli, ...args], {
      cwd,
      env: { ...process.env, ASTERDOC_NO_UPDATE_CHECK: '1', ASTERDOC_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    readLateAndSlowly(child.stdout, stdout, startAfterMs)
    readLateAndSlowly(child.stderr, stderr, startAfterMs)
    child.on('error', reject)
    child.on('close', (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
      })
    })
  })
}

function formWithUnverifiedLayers(extraLayers: Record<string, unknown> = {}): Record<string, unknown> {
  const layers = Object.fromEntries(
    Array.from({ length: LAYER_COUNT }, (_, index) => [
      `copy${index}`,
      { kind: 'file', mimeType: 'text/markdown', path: './layer.md' },
    ]),
  )
  return {
    $schema: ASTERDOC_SCHEMA_URL,
    name: 'many-layers',
    version: '1.0.0',
    title: 'Many layers',
    kind: 'form',
    fields: { name: { type: 'text', label: 'Name' } },
    defaultLayer: 'copy0',
    layers: { ...layers, ...extraLayers },
  }
}

describe('output on a pipe that is read late', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'asterdoc-late-reader-'))
    await fs.writeFile(path.join(dir, 'layer.md'), '# Layer\n')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('a passing validate --json writes its whole result and exits 0', async () => {
    await fs.writeFile(path.join(dir, 'form.json'), JSON.stringify(formWithUnverifiedLayers()))

    const result = await runWithLateReader(['validate', 'form.json', '--json'], dir)

    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(PIPE_CAPACITY)
    const payload = JSON.parse(result.stdout) as { ok: boolean; warnings: unknown[]; layers: unknown[] }
    expect(payload.ok).toBe(true)
    expect(payload.warnings).toHaveLength(LAYER_COUNT)
    expect(payload.layers).toHaveLength(LAYER_COUNT)
    expect(result.exitCode).toBe(0)
  }, 30_000)

  it('a failing validate --json writes its whole result and exits 1', async () => {
    const artifact = formWithUnverifiedLayers({
      absent: { kind: 'file', mimeType: 'text/markdown', path: './absent.md' },
    })
    await fs.writeFile(path.join(dir, 'form.json'), JSON.stringify(artifact))

    const result = await runWithLateReader(['validate', 'form.json', '--json'], dir)

    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(PIPE_CAPACITY)
    const payload = JSON.parse(result.stdout) as { ok: boolean; errors: { message: string }[]; warnings: unknown[] }
    expect(payload.ok).toBe(false)
    expect(payload.errors.map((error) => error.message)).toEqual(['Layer file not found: ./absent.md'])
    expect(payload.warnings).toHaveLength(LAYER_COUNT)
    expect(result.exitCode).toBe(1)
  }, 30_000)

  it('a failing validate writes every error line to stderr and exits 1', async () => {
    const missing = Array.from({ length: MISSING_FILE_COUNT }, (_, index) => `missing-${index}.json`)

    const result = await runWithLateReader(['validate', ...missing], dir)

    expect(Buffer.byteLength(result.stderr)).toBeGreaterThan(PIPE_CAPACITY)
    const reported = result.stderr.match(/File not found: missing-\d+\.json/g) ?? []
    expect(reported).toHaveLength(MISSING_FILE_COUNT)
    expect(reported.at(-1)).toBe(`File not found: missing-${MISSING_FILE_COUNT - 1}.json`)
    expect(result.stdout).toContain(`${MISSING_FILE_COUNT} of ${MISSING_FILE_COUNT} artifacts failed`)
    expect(result.exitCode).toBe(1)
  }, 30_000)
})
