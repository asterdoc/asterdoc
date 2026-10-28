import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCli } from '../../cli/tests/setup/spawn-cli'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliRoot = path.resolve(packageRoot, '../cli')
const packageVersion = (JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version

describe('asterdoc shim', () => {
  it('runs the built CLI and reports its version', async () => {
    await expect(runCli(['--version'], { target: 'shim' })).resolves.toMatchObject({
      stdout: `${packageVersion}\n`,
      exitCode: 0,
    })
  })

  it('imports the dist entry published by @asterdoc/cli', () => {
    const manifest = JSON.parse(readFileSync(path.join(cliRoot, 'package.json'), 'utf8')) as { bin?: { asterdoc?: string } }
    expect(manifest.bin?.asterdoc).toBe('./dist/index.js')
    expect(readFileSync(path.join(packageRoot, 'bin.js'), 'utf8')).toContain("@asterdoc/cli/dist/index.js")
    expect(existsSync(path.join(cliRoot, 'dist/index.js'))).toBe(true)
  })

  it('identifies the shim package before loading the CLI', () => {
    const source = readFileSync(path.join(packageRoot, 'bin.js'), 'utf8')
    expect(source.indexOf("ASTERDOC_CLI_PACKAGE = 'asterdoc'")).toBeLessThan(
      source.indexOf("import('@asterdoc/cli/dist/index.js')"),
    )
  })
})
