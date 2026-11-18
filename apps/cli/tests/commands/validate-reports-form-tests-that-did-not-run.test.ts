import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '@asterdoc/core'
import { runCli } from '../setup/spawn-cli'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

const form = {
  $schema: `https://schema.asterdoc.com/${SCHEMA_VERSION}.json`,
  kind: 'form',
  name: 'pet',
  version: '1.0.0',
  title: 'Pet',
  fields: { name: { type: 'text', label: 'Name', required: true } },
  layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: 'pet.pdf' } },
  defaultLayer: 'pdf',
  tests: [{ name: 'a named pet is valid', input: { fields: { name: 'Milo' } }, expect: { valid: true } }],
}

async function designFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'asterdoc-validate-tests-'))
  await copyFile(path.join(fixtures, 'pet-addendum-bindings.pdf'), path.join(folder, 'pet.pdf'))
  await writeFile(path.join(folder, 'pet.json'), JSON.stringify(form))
  return folder
}

describe('asterdoc validate on a form with its own tests', () => {
  it('runs the tests when it can read the form\'s files', async () => {
    const folder = await designFolder()
    const result = await runCli(['validate', path.join(folder, 'pet.json')], { cwd: folder })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('did not run')
  }, 60_000)

  it('fails, naming why, when the form cannot load and its tests do not run', async () => {
    const folder = await designFolder()
    const elsewhere = await mkdtemp(path.join(tmpdir(), 'asterdoc-validate-elsewhere-'))
    const result = await runCli(['validate', '-'], { cwd: elsewhere, input: await readFile(path.join(folder, 'pet.json'), 'utf8') })

    expect(result.exitCode).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("The form's test did not run: the form did not load.")
  }, 60_000)
})
