import { runCli as executeCliCommand } from '../setup/spawn-cli'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/schemas'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, '../fixtures')

/**
 * Execute a CLI command and return the result
 */

describe('CLI Data Commands', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asterdoc-data-test-'))
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('data --help', () => {
    it('should display help for data command', async () => {
      const result = await executeCliCommand(['data', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('fill')
      expect(result.stdout).toContain('template')
      expect(result.stdout).toContain('validate')
    })
  })

  describe('data template', () => {
    it('should display help for data template command', async () => {
      const result = await executeCliCommand(['data', 'template', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Generate')
    })

    it('should generate a data template from a form', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const result = await executeCliCommand(['data', 'template', formPath])

      expect(result.exitCode).toBe(0)
      // Template should contain field names from the form
      expect(result.stdout).toContain('name')
      expect(result.stdout).toContain('species')
      expect(result.stdout).toContain('weight')
    })

    it('should output template in JSON format', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const result = await executeCliCommand(['data', 'template', formPath, '--json'])

      expect(result.exitCode).toBe(0)
      // Should be valid JSON with fields property
      const parsed = JSON.parse(result.stdout)
      expect(parsed).toHaveProperty('fields')
      expect(parsed.fields).toHaveProperty('name')
      expect(parsed.fields).toHaveProperty('species')
    })

    it('should output template in YAML format', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const result = await executeCliCommand(['data', 'template', formPath, '--yaml'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('name:')
      expect(result.stdout).toContain('species:')
      expect(result.stdout).not.toContain('yaml-language-server')
    })

    it('uses an empty array for list fields', async () => {
      const formPath = path.join(tempDir, 'list-form.json')
      await fs.writeFile(formPath, JSON.stringify({
        $schema: ASTERDOC_SCHEMA_URL,
        kind: 'form', name: 'list-form', version: '1.0.0', title: 'List form',
        fields: {
          rows: { type: 'list', label: 'Rows', item: { type: 'text', label: 'Row' } },
        },
      }))

      const result = await executeCliCommand(['data', 'template', formPath, '--json'])
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).fields.rows).toEqual([])
    })
  })

  describe('data validate', () => {
    it('should display help for data validate command', async () => {
      const result = await executeCliCommand(['data', 'validate', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Validate')
    })

    it('should validate data against a form', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const dataPath = path.join(tempDir, 'data.json')

      // Create valid data matching the form fields (wrapped in fields object)
      await fs.writeFile(dataPath, JSON.stringify({
        fields: {
          name: 'Buddy',
          species: 'dog',
          weight: 25,
          hasVaccination: true,
        }
      }))

      const result = await executeCliCommand(['data', 'validate', formPath, dataPath])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('valid')
    })

    it('should validate data with coercible types', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const dataPath = path.join(tempDir, 'coercible-data.json')

      // Data that may be coerced to valid types (wrapped in fields object)
      await fs.writeFile(dataPath, JSON.stringify({
        fields: {
          name: 'Buddy',
          species: 'dog',
          weight: 25,
          hasVaccination: true,
        }
      }))

      const result = await executeCliCommand(['data', 'validate', formPath, dataPath])

      expect(result.exitCode).toBe(0)
    })

    it('accepts data that leaves a hidden field with a default unset, and refuses a value given for it', async () => {
      const formPath = path.join(tempDir, 'hidden-default.json')
      await fs.writeFile(formPath, JSON.stringify({
        $schema: ASTERDOC_SCHEMA_URL,
        kind: 'form',
        name: 'hidden-default',
        version: '1.0.0',
        title: 'Hidden default',
        fields: {
          shipping: { type: 'boolean', label: 'Shipping' },
          carrier: { type: 'text', label: 'Carrier', default: 'Post', visible: 'fields.shipping == true' },
        },
      }))
      const unset = path.join(tempDir, 'unset.json')
      const given = path.join(tempDir, 'given.json')
      await fs.writeFile(unset, JSON.stringify({ fields: { shipping: false } }))
      await fs.writeFile(given, JSON.stringify({ fields: { shipping: false, carrier: 'Courier' } }))

      const accepted = await executeCliCommand(['data', 'validate', formPath, unset, '--json'])
      expect(accepted.exitCode, accepted.stderr).toBe(0)
      expect(JSON.parse(accepted.stdout).success).toBe(true)

      const refused = await executeCliCommand(['data', 'validate', formPath, given])
      expect(refused.exitCode).toBe(1)
      expect(refused.stderr).toContain('fields.carrier: A value is given, but this field does not apply.')
    })

    it('should fail for non-existent data file', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')

      const result = await executeCliCommand(['data', 'validate', formPath, '/nonexistent/data.json'])

      expect(result.exitCode).toBe(1)
    })

    it('should output JSON result with --json', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const dataPath = path.join(tempDir, 'valid-data.json')

      await fs.writeFile(dataPath, JSON.stringify({
        fields: {
          name: 'Buddy',
          species: 'dog',
          weight: 25,
          hasVaccination: true,
        }
      }))

      const result = await executeCliCommand(['data', 'validate', formPath, dataPath, '--json'])

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.success).toBe(true)
    })

    it('should suppress output with --silent on valid data', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const dataPath = path.join(tempDir, 'silent-data.json')

      await fs.writeFile(dataPath, JSON.stringify({
        fields: {
          name: 'Buddy',
          species: 'dog',
          weight: 25,
          hasVaccination: true,
        }
      }))

      const result = await executeCliCommand(['data', 'validate', formPath, dataPath, '--silent'])

      expect(result.exitCode).toBe(0)
      // Silent should produce minimal/no output
      expect(result.stdout.trim()).toBe('')
    })

    it('should accept inline JSON data', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const inlineData = JSON.stringify({
        fields: {
          name: 'Rex',
          species: 'dog',
          weight: 30,
          hasVaccination: true,
        }
      })

      const result = await executeCliCommand(['data', 'validate', formPath, inlineData])

      expect(result.exitCode).toBe(0)
    })

    it('rejects unknown keys in a structured payload', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const result = await executeCliCommand([
        'data', 'validate', formPath,
        JSON.stringify({ fields: { name: 'Rex' }, partys: {} }),
      ])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Unknown top-level key "partys"')
    })
  })

  describe('data template (additional options)', () => {
    it('should write template to file with --out', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const outPath = path.join(tempDir, 'template.json')

      const result = await executeCliCommand(['data', 'template', formPath, '--out', outPath, '--json'])

      expect(result.exitCode).toBe(0)

      // Verify file was created
      const content = await fs.readFile(outPath, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed).toHaveProperty('fields')
    })

    it('should write YAML template to file with --out', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const outPath = path.join(tempDir, 'template.yaml')

      const result = await executeCliCommand(['data', 'template', formPath, '--out', outPath])

      expect(result.exitCode).toBe(0)

      const content = await fs.readFile(outPath, 'utf-8')
      expect(content).toContain('name:')
    })

    it('should suppress output with --silent when writing to file', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const outPath = path.join(tempDir, 'silent-template.json')

      const result = await executeCliCommand(['data', 'template', formPath, '--out', outPath, '--json', '--silent'])

      expect(result.exitCode).toBe(0)
      // File should still be created even in silent mode
      const content = await fs.readFile(outPath, 'utf-8')
      expect(content.length).toBeGreaterThan(0)
    })
  })

  describe('data fill', () => {
    it('should display help for data fill command', async () => {
      const result = await executeCliCommand(['data', 'fill', '--help'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('--out')
      expect(result.stdout).toContain('--data')
    })

    it('should fill form with data from file', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const dataPath = path.join(tempDir, 'fill-data.json')
      const outPath = path.join(tempDir, 'filled.json')

      await fs.writeFile(dataPath, JSON.stringify({
        fields: {
          name: 'Buddy',
          species: 'dog',
          weight: 25,
          hasVaccination: true,
        }
      }))

      const result = await executeCliCommand([
        'data', 'fill', formPath,
        '--out', outPath,
        '--data', dataPath,
        '--json',
      ])

      expect(result.exitCode).toBe(0)

      // Verify output file was created with data
      const content = await fs.readFile(outPath, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.fields.name).toBe('Buddy')
      expect(parsed.fields.species).toBe('dog')
    })

    it('should fill form with inline JSON data', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const outPath = path.join(tempDir, 'filled-inline.json')

      const inlineData = JSON.stringify({
        fields: {
          name: 'Rex',
          species: 'cat',
          weight: 8,
          hasVaccination: false,
        }
      })

      const result = await executeCliCommand([
        'data', 'fill', formPath,
        '--out', outPath,
        '--data', inlineData,
        '--json',
      ])

      expect(result.exitCode).toBe(0)

      const content = await fs.readFile(outPath, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.fields.name).toBe('Rex')
      expect(parsed.fields.species).toBe('cat')
    })

    it('should output YAML format with --yaml', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const outPath = path.join(tempDir, 'filled.yaml')

      const inlineData = JSON.stringify({
        fields: {
          name: 'Whiskers',
          species: 'cat',
          weight: 5,
          hasVaccination: true,
        }
      })

      const result = await executeCliCommand([
        'data', 'fill', formPath,
        '--out', outPath,
        '--data', inlineData,
        '--yaml',
      ])

      expect(result.exitCode).toBe(0)

      const content = await fs.readFile(outPath, 'utf-8')
      expect(content).toContain('name:')
      expect(content).toContain('Whiskers')
    })

    it('should fail for non-form artifact', async () => {
      const docPath = path.join(fixturesDir, 'pet-care-guide.yaml')
      const outPath = path.join(tempDir, 'fail.json')

      const result = await executeCliCommand([
        'data', 'fill', docPath,
        '--out', outPath,
        '--data', '{"fields":{}}',
        '--json',
      ])

      expect(result.exitCode).toBe(1)
    })

    it('should fail for nonexistent form file', async () => {
      const outPath = path.join(tempDir, 'fail.json')

      const result = await executeCliCommand([
        'data', 'fill', '/nonexistent/form.yaml',
        '--out', outPath,
        '--data', '{"fields":{}}',
      ])

      expect(result.exitCode).toBe(1)
    })
  })
  describe('data validate and data fill agree with the SDK', () => {
    const leaseForm = {
      $schema: ASTERDOC_SCHEMA_URL,
      kind: 'form',
      name: 'lease-probe',
      version: '1.0.0',
      title: 'Lease probe',
      fields: {
        hasPet: { type: 'boolean', label: 'Has pet' },
        petName: { type: 'text', label: 'Pet name', required: 'fields.hasPet == true' },
      },
      parties: {
        tenant: { label: 'Tenant', partyType: 'person', required: true },
        guarantor: { label: 'Guarantor', partyType: 'person', min: 0, max: 1 },
      },
    }
    const tenant = { id: 'tenant-0', name: 'Ada Lovelace' }

    /** The errors `form.fill(data).validate()` reports for the payload. */
    async function sdkErrors(payload: Record<string, unknown>): Promise<unknown[]> {
      const { form, FormValidationError } = await import('@asterdoc/core')
      const filled = (await form.load(leaseForm as never)).safeFill(payload as never)
      if (!filled.success) {
        if (!(filled.error instanceof FormValidationError)) throw filled.error
        return filled.error.errors
      }
      return filled.data.validate().errors
    }

    async function writeForm(): Promise<string> {
      const formPath = path.join(tempDir, 'lease.json')
      await fs.writeFile(formPath, JSON.stringify(leaseForm))
      return formPath
    }

    const invalid: Array<[string, Record<string, unknown>]> = [
      ['a missing expression-required field', { fields: { hasPet: true }, parties: { tenant } }],
      ['a missing required party', { fields: { hasPet: false } }],
      [
        'party data that breaks the role rules',
        {
          fields: { hasPet: false },
          parties: { tenant, guarantor: [{ id: 'g-0', name: 'Grace' }, { id: 'g-1', name: 'Alan' }] },
        },
      ],
      ['party data that is not a party', { fields: { hasPet: false }, parties: { tenant: { id: 'tenant-0' } } }],
      ['a misspelled top-level key', { fields: { hasPet: false }, partys: { tenant } }],
    ]

    it.each(invalid)('data validate reports the SDK errors for %s', async (_name, payload) => {
      const expected = await sdkErrors(payload)
      expect(expected.length).toBeGreaterThan(0)

      const result = await executeCliCommand(['data', 'validate', await writeForm(), JSON.stringify(payload), '--json'])

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(result.stdout)
      expect(output.success).toBe(false)
      expect(output.errors).toEqual(expected)
    })

    it.each(invalid)('data fill rejects %s with the SDK errors and writes nothing', async (_name, payload) => {
      const expected = (await sdkErrors(payload)) as Array<{ field: string; message: string }>
      const outPath = path.join(tempDir, 'filled.json')

      const result = await executeCliCommand(['data', 'fill', await writeForm(), '--out', outPath, '--data', JSON.stringify(payload)])

      expect(result.exitCode).toBe(1)
      for (const error of expected) expect(result.stderr).toContain(`${error.field}: ${error.message}`)
      await expect(fs.access(outPath)).rejects.toThrow()
    })

    it('data validate accepts valid data with parties and returns the filled payload', async () => {
      const payload = { fields: { hasPet: true, petName: 'Rex' }, parties: { tenant } }
      expect(await sdkErrors(payload)).toEqual([])

      const result = await executeCliCommand(['data', 'validate', await writeForm(), JSON.stringify(payload), '--json'])

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.success).toBe(true)
      expect(output.data.parties).toEqual({ tenant })
      expect(output.data.fields).toEqual(payload.fields)
    })

    it('data validate accepts flat field data when nothing is required', async () => {
      const formPath = path.join(fixturesDir, 'pet-addendum.yaml')
      const flat = { name: 'Rex', species: 'dog', weight: 30, hasVaccination: true }

      const result = await executeCliCommand(['data', 'validate', formPath, JSON.stringify(flat), '--json'])

      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).data.fields).toEqual(flat)
    })

    it('data validate and data fill fail a form rule the SDK fails, and pass it when it holds', async () => {
      const ruleForm = {
        ...leaseForm,
        rules: { petNamed: { expr: 'hasPet == false or petName == "Rex"', severity: 'error', message: 'The pet must be Rex' } },
      }
      const formPath = path.join(tempDir, 'rule.json')
      await fs.writeFile(formPath, JSON.stringify(ruleForm))
      const payload = { fields: { hasPet: true, petName: 'Fido' }, parties: { tenant } }
      const { form } = await import('@asterdoc/core')
      const sdk = (await form.load(ruleForm as never)).fill(payload as never).validate()
      expect(sdk.errors).toEqual([])
      expect(sdk.rules.errors.length).toBe(1)

      const validated = await executeCliCommand(['data', 'validate', formPath, JSON.stringify(payload), '--json'])
      expect(validated.exitCode).toBe(1)
      expect(JSON.parse(validated.stdout)).toMatchObject({ success: false, errors: [], ruleErrors: sdk.rules.errors })

      const outPath = path.join(tempDir, 'rule-filled.json')
      const filled = await executeCliCommand(['data', 'fill', formPath, '--out', outPath, '--data', JSON.stringify(payload)])
      expect(filled.exitCode).toBe(1)
      expect(filled.stderr).toContain('rules.petNamed: The pet must be Rex')

      const holds = { ...payload, fields: { hasPet: true, petName: 'Rex' } }
      const passed = await executeCliCommand(['data', 'validate', formPath, JSON.stringify(holds)])
      expect(passed.exitCode).toBe(0)
    })

    it('data fill writes parties to its output', async () => {
      const payload = { fields: { hasPet: false }, parties: { tenant } }
      const outPath = path.join(tempDir, 'filled.json')

      const result = await executeCliCommand(['data', 'fill', await writeForm(), '--out', outPath, '--data', JSON.stringify(payload)])

      expect(result.exitCode).toBe(0)
      const written = JSON.parse(await fs.readFile(outPath, 'utf-8'))
      expect(written).toEqual({ fields: { hasPet: false }, parties: { tenant } })
    })

    it('data fill writes the values given without defaults, and data validate --json shows the values with them', async () => {
      const formPath = path.join(tempDir, 'defaults.json')
      await fs.writeFile(formPath, JSON.stringify({
        $schema: ASTERDOC_SCHEMA_URL,
        kind: 'form',
        name: 'defaults',
        version: '1.0.0',
        title: 'Defaults',
        fields: {
          mode: { type: 'enum', label: 'Mode', enum: [{ value: 'short' }, { value: 'full' }] },
          detail: { type: 'text', label: 'Detail', default: 'Standard', visible: "fields.mode == 'full'" },
        },
      }))
      const outPath = path.join(tempDir, 'given.json')
      const payload = JSON.stringify({ fields: { mode: 'full' } })

      const filled = await executeCliCommand(['data', 'fill', formPath, '--out', outPath, '--data', payload])
      const validated = await executeCliCommand(['data', 'validate', formPath, payload, '--json'])

      expect(filled.exitCode, filled.stderr).toBe(0)
      expect(JSON.parse(await fs.readFile(outPath, 'utf-8'))).toEqual({ fields: { mode: 'full' } })
      expect(JSON.parse(validated.stdout)).toMatchObject({ success: true, data: { fields: { mode: 'full' } }, values: { fields: { mode: 'full', detail: 'Standard' } } })
      expect(JSON.parse(validated.stdout).data.fields).not.toHaveProperty('detail')
    })
  })

  describe('data extract', () => {
    const extractForm = {
      $schema: ASTERDOC_SCHEMA_URL,
      kind: 'form',
      name: 'pet-addendum',
      version: '1.0.0',
      title: 'Pet Addendum',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        species: { type: 'enum', label: 'Species', enum: [{ value: 'dog' }, { value: 'cat' }, { value: 'bird' }, { value: 'turtle' }] },
        weight: { type: 'number', label: 'Weight', required: true },
        hasVaccination: { type: 'boolean', label: 'Has vaccination' },
      },
      defaultLayer: 'pdf',
      layers: {
        pdf: {
          kind: 'file',
          mimeType: 'application/pdf',
          path: 'pet-addendum-bindings.pdf',
          bindings: { pet_name: 'name', petWeight: 'weight', SPECIES: 'species', is_vaccinated: 'hasVaccination' },
        },
      },
    }
    const values = { fields: { name: 'Fluffy', species: 'cat', weight: 3, hasVaccination: true } }

    async function filledPdf(): Promise<{ formPath: string; pdfPath: string }> {
      const formPath = path.join(tempDir, 'pet.json')
      const pdfPath = path.join(tempDir, 'filled.pdf')
      await fs.writeFile(formPath, JSON.stringify(extractForm))
      await fs.copyFile(path.join(fixturesDir, 'pet-addendum-bindings.pdf'), path.join(tempDir, 'pet-addendum-bindings.pdf'))
      const rendered = await executeCliCommand(['render', formPath, '--data', JSON.stringify(values), '--out', pdfPath])
      expect(rendered.exitCode).toBe(0)
      return { formPath, pdfPath }
    }

    it('extracts one filled PDF as the SDK does', async () => {
      const { formPath, pdfPath } = await filledPdf()
      const result = await executeCliCommand(['data', 'extract', formPath, pdfPath])

      expect(result.exitCode).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.data).toEqual(values)
      const { form } = await import('@asterdoc/core')
      const sdk = await (await form.load(extractForm as never, { resolver: (await import('@asterdoc/resolvers/fs')).createFsResolver({ root: path.dirname(formPath) }) })).extract(new Uint8Array(await fs.readFile(pdfPath)))
      expect(output).toEqual({ file: pdfPath, ...JSON.parse(JSON.stringify(sdk)) })
    })

    it('extracts every PDF in a directory and reports the ones that fail', async () => {
      const { formPath, pdfPath } = await filledPdf()
      const batch = path.join(tempDir, 'batch')
      await fs.mkdir(batch)
      await fs.copyFile(pdfPath, path.join(batch, 'a.pdf'))
      await fs.copyFile(path.join(fixturesDir, 'Pet Care Guide.pdf'), path.join(batch, 'b.pdf'))
      await fs.writeFile(path.join(batch, 'notes.txt'), 'ignored')
      const outPath = path.join(tempDir, 'extracted.json')

      const result = await executeCliCommand(['data', 'extract', formPath, batch, '--out', outPath])

      expect(result.exitCode).toBe(1)
      const output = JSON.parse(await fs.readFile(outPath, 'utf-8'))
      expect(output.results.map((entry: { file: string }) => entry.file)).toEqual(['a.pdf', 'b.pdf'])
      expect(output.results[0].data).toEqual(values)
      expect(output.results[1].error.code).toBe('no_form_fields')
    })

    it('fails with the extraction error code for a PDF without form fields', async () => {
      const { formPath } = await filledPdf()
      const result = await executeCliCommand(['data', 'extract', formPath, path.join(fixturesDir, 'Pet Care Guide.pdf')])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('no_form_fields')
      expect(result.stdout).toBe('')
    })

    async function renderAndExtract(definition: Record<string, unknown>, data: Record<string, unknown>, name: string) {
      const formPath = path.join(tempDir, `${name}.json`)
      const pdfPath = path.join(tempDir, `${name}.pdf`)
      await fs.writeFile(formPath, JSON.stringify(definition))
      await fs.copyFile(path.join(fixturesDir, 'pet-addendum-bindings.pdf'), path.join(tempDir, 'pet-addendum-bindings.pdf'))
      const rendered = await executeCliCommand(['render', formPath, '--data', JSON.stringify(data), '--out', pdfPath])
      expect(rendered.exitCode, rendered.stderr).toBe(0)
      const extracted = await executeCliCommand(['data', 'extract', formPath, pdfPath])
      expect(extracted.exitCode, extracted.stderr).toBe(0)
      const output = JSON.parse(extracted.stdout) as { data: { fields: Record<string, unknown> }; report: { entries: Array<{ path: string; status: string; reason?: string }> } }
      return { data: output.data, entry: (entryPath: string) => output.report.entries.find((entry) => entry.path === entryPath) }
    }

    const computedForm = {
      ...extractForm,
      defs: { heavy: { type: 'boolean', value: 'fields.weight > 5' } },
      layers: {
        pdf: {
          ...extractForm.layers.pdf,
          bindings: { pet_name: 'name', petWeight: 'weight', is_vaccinated: 'defs.heavy' },
        },
      },
    }

    it('reports a checkbox bound to a computed value as not_recoverable when checked and empty when not', async () => {
      const checked = await renderAndExtract(computedForm, { fields: { name: 'Rex', weight: 9 } }, 'heavy')
      const unchecked = await renderAndExtract(computedForm, { fields: { name: 'Tom', weight: 3 } }, 'light')

      expect(checked.entry('defs.heavy')).toMatchObject({ status: 'not_recoverable', reason: 'Computed values are derived from other data, not read back.' })
      expect(unchecked.entry('defs.heavy')).toMatchObject({ status: 'empty' })
      expect(checked.data).toEqual({ fields: { name: 'Rex', weight: 9 } })
    })

    const defaultedForm = {
      ...extractForm,
      fields: {
        species: { type: 'enum', label: 'Species', required: true, enum: [{ value: 'dog' }, { value: 'cat' }] },
        name: { type: 'text', label: 'Name', required: true, default: 'Kitty', visible: "fields.species == 'cat'" },
        weight: { type: 'number', label: 'Weight' },
      },
      layers: { pdf: { ...extractForm.layers.pdf, bindings: { pet_name: 'name', petWeight: 'weight' } } },
    }

    it('render --draft --check prints and compares the default of a field that applies', async () => {
      const formPath = path.join(tempDir, 'draft-defaults.json')
      const pdfPath = path.join(tempDir, 'draft-defaults.pdf')
      await fs.writeFile(formPath, JSON.stringify(defaultedForm))
      await fs.copyFile(path.join(fixturesDir, 'pet-addendum-bindings.pdf'), path.join(tempDir, 'pet-addendum-bindings.pdf'))

      const result = await executeCliCommand(['render', formPath, '--data', JSON.stringify({ fields: { species: 'cat' } }), '--out', pdfPath, '--draft', '--check', '--format', 'json'])

      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ success: true, check: { passed: true, equal: 1 } })
      const extracted = JSON.parse((await executeCliCommand(['data', 'extract', formPath, pdfPath])).stdout) as { data: { fields: Record<string, unknown> } }
      expect(extracted.data.fields).toMatchObject({ name: 'Kitty' })
    })

    it('prints the default of a required field that applies, and nothing for one that does not', async () => {
      const cat = await renderAndExtract(defaultedForm, { fields: { species: 'cat', weight: 3 } }, 'cat')
      const dog = await renderAndExtract(defaultedForm, { fields: { species: 'dog', weight: 3 } }, 'dog')

      expect(cat.entry('name')).toMatchObject({ status: 'recovered' })
      expect(cat.data.fields).toMatchObject({ name: 'Kitty' })
      expect(dog.entry('name')).toMatchObject({ status: 'empty' })
      expect(dog.data.fields).not.toHaveProperty('name')
    })
  })
})
