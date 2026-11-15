import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createMemoryResolver } from '@asterdoc/resolvers/memory'
import { validateLayers } from '@/index'
import { acroFormPdf } from './fixtures/text-fields-pdf'

const cyrillicFont = new Uint8Array(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'artifacts', 'form', 'fixtures', 'cyrillic-boxes.ttf')))

const resolver = createMemoryResolver({
  contents: {
    'form.pdf': acroFormPdf([
      { name: 'nativeName', width: 300, height: 14 },
      { name: 'nativeNameAgain', width: 300, height: 14 },
      { name: 'cityLine', width: 300, height: 14 },
    ]),
    'fonts/cyrillic.ttf': cyrillicFont,
  },
})

interface TestCase {
  name: string
  input: { fields: Record<string, unknown> }
  expect: { valid: boolean }
}

const latin: TestCase = { name: 'a name in Latin letters', input: { fields: { nameInNativeAlphabet: 'Jean Dupont', city: 'Orléans' } }, expect: { valid: true } }
const cyrillic: TestCase = { name: 'a name in Cyrillic', input: { fields: { nameInNativeAlphabet: 'Жук', city: 'Paris' } }, expect: { valid: true } }

function artifact(tests: TestCase[], layer: Record<string, unknown> = {}) {
  return {
    kind: 'form',
    name: 'native-name',
    version: '1.0.0',
    title: 'Native name',
    fields: {
      nameInNativeAlphabet: { type: 'text', label: 'Name in native alphabet', maxLength: 30 },
      city: { type: 'text', label: 'City', maxLength: 20, required: true },
    },
    layers: {
      pdf: {
        kind: 'file',
        mimeType: 'application/pdf',
        path: 'form.pdf',
        bindings: {
          nativeName: 'nameInNativeAlphabet',
          nativeNameAgain: 'fields.nameInNativeAlphabet',
          cityLine: { template: 'City: {{fields.city}}' },
        },
        ...layer,
      },
    },
    tests,
  }
}

describe('validateLayers on the values of a form\'s tests', () => {
  it('reports a value no font of the PDF layer can draw, naming the layer, the test, the PDF field and the path', async () => {
    const result = await validateLayers(artifact([latin, cyrillic]), { resolver })
    expect(result.issues).toEqual([{
      message: expect.stringMatching(/^Layer "pdf", test "a name in Cyrillic": a render of the values of this test fails\. Cannot fill PDF field "nativeName" with fields\.nameInNativeAlphabet: no available font can draw "Ж" \(U\+0416\)\. Declare a font that has this character on the PDF layer/),
      path: ['layers', 'pdf', 'bindings', 'nativeName'],
      severity: 'error',
    }])
  })

  it('reports nothing when every test value is Latin-1', async () => {
    const result = await validateLayers(artifact([latin]), { resolver })
    expect(result.issues).toBeUndefined()
    expect(result.warnings).toBeUndefined()
  })

  it('reports nothing when the layer declares a font that has the characters', async () => {
    const result = await validateLayers(artifact([latin, cyrillic], { font: { path: 'fonts/cyrillic.ttf' } }), { resolver })
    expect(result.issues).toBeUndefined()
  })

  it('reports each path of each test once, however many PDF fields print it', async () => {
    const both: TestCase = { name: 'a name and a city in Cyrillic', input: { fields: { nameInNativeAlphabet: 'Жук', city: 'Москва' } }, expect: { valid: true } }
    const result = await validateLayers(artifact([cyrillic, both]), { resolver })
    expect(result.issues?.map((issue) => issue.message.replace(/: a render.*? with (.*?): .*$/, ' | $1'))).toEqual([
      'Layer "pdf", test "a name in Cyrillic" | fields.nameInNativeAlphabet',
      'Layer "pdf", test "a name and a city in Cyrillic" | fields.nameInNativeAlphabet',
      'Layer "pdf", test "a name and a city in Cyrillic" | fields.city',
    ])
  })

  it('reports a script that needs shaping, with no advice to add a font', async () => {
    const arabic: TestCase = { name: 'a name in Arabic', input: { fields: { nameInNativeAlphabet: 'محمد', city: 'Paris' } }, expect: { valid: true } }
    const result = await validateLayers(artifact([arabic], { font: { path: 'fonts/cyrillic.ttf' } }), { resolver })
    expect(result.issues).toHaveLength(1)
    const message = result.issues![0]!.message
    expect(message).toContain('test "a name in Arabic"')
    expect(message).toContain('with fields.nameInNativeAlphabet: the value contains Arabic script')
    expect(message).not.toContain('Declare a font')
  })

  it('checks a test that expects an invalid draft, since a draft still prints its values', async () => {
    const incomplete: TestCase = { name: 'a name with no city', input: { fields: { nameInNativeAlphabet: 'Жук' } }, expect: { valid: false } }
    const result = await validateLayers(artifact([incomplete]), { resolver })
    expect(result.issues?.map((issue) => issue.path)).toEqual([['layers', 'pdf', 'bindings', 'nativeName']])
  })

  it('passes over a test whose input the form refuses, since nothing of it is rendered', async () => {
    const refused: TestCase = { name: 'a value for a field the form does not have', input: { fields: { nameInNativeAlphabet: 'Жук', notAField: 'Жук' } }, expect: { valid: false } }
    const result = await validateLayers(artifact([refused]), { resolver })
    expect(result.issues).toBeUndefined()
  })
})
