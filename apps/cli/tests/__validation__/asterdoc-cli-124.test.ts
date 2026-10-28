import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/schemas'
import { runCli } from '../setup/spawn-cli.js'

describe('asterdoc-cli-124: check data keeps annexes', () => {
  it('passes annexes from --data to the composition', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const root = await mkdtemp(path.join(here, 'tmp-124-'))
    const annexes = { photo: { name: 'p.png', mimeType: 'image/png' } }
    try {
      await writeFile(path.join(root, 'form.json'), JSON.stringify({
        $schema: ASTERDOC_SCHEMA_URL, kind: 'form', name: 'form-124', version: '1.0.0', title: 'Form',
        fields: { name: { type: 'text', label: 'Name' } },
        annexes: { photo: { title: 'Photo' } },
        layers: { composition: { kind: 'file', mimeType: 'text/tsx', path: 'comp.tsx' } },
      }))
      await writeFile(path.join(root, 'comp.tsx'), `import { Document, Field } from '@asterdoc/components'
export default function Composition({ artifact, data }: any) {
  const fieldPath = data?.annexes?.photo ? 'name' : 'annexesWereDropped'
  return <Document artifact={artifact} data={data}><Field path={fieldPath} /></Document>
}`)
      const data = JSON.stringify({ fields: { name: 'Ada' }, annexes })
      const result = await runCli(['check', 'form.json', '--data', data], { cwd: root })
      expect(result.stdout + result.stderr).not.toContain('annexesWereDropped')
      expect(result.exitCode).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
