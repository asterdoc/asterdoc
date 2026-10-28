import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runCli } from '../setup/spawn-cli.js'
import { formatLayerCount, PROJECT_REQUIRED_MESSAGE } from '../../src/utils/user-copy.js'
import { createAboutCommand } from '../../src/commands/about.js'

describe('asterdoc-cli-227: CLI user copy', () => {
  it('names both files required for an Asterdoc project', () => {
    expect(PROJECT_REQUIRED_MESSAGE).toContain('asterdoc.json')
    expect(PROJECT_REQUIRED_MESSAGE).toContain('.asterdoc directory')
    expect(PROJECT_REQUIRED_MESSAGE).toContain('Not in an Asterdoc project')
    expect(PROJECT_REQUIRED_MESSAGE).not.toContain('a Asterdoc')
  })

  it('does not claim .asterdoc is missing when only asterdoc.json is absent', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'asterdoc-cli-227-'))
    try {
      mkdirSync(path.join(cwd, '.asterdoc'))
      writeFileSync(path.join(cwd, 'a.yaml'), 'kind: form\n')
      const result = await runCli(['version', 'a.yaml', 'patch'], { cwd })
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(PROJECT_REQUIRED_MESSAGE)
      expect(result.stderr).not.toContain('no .asterdoc directory found')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('identifies the about command as Asterdoc CLI', () => {
    expect(createAboutCommand().description()).toBe('Display information about Asterdoc CLI')
  })

  it('uses singular layer copy', () => {
    expect(formatLayerCount(1)).toBe('1 layer')
    expect(formatLayerCount(2)).toBe('2 layers')
  })
})
