import { runCli as executeCliCommand } from '../setup/spawn-cli'
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createFsResolver } from '@asterdoc/resolvers/fs'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/schemas'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, '../fixtures')
// The package's turbo.json makes `test` depend on `build`, so the built
// binary exists whenever this suite runs through the task graph. Fail loudly
// when it is missing rather than rebuild here: a rebuild inside the hook
// races the hook timeout under load.
const builtCliPath = path.resolve(__dirname, '../../dist/index.js')
beforeAll(() => {
  if (!existsSync(builtCliPath)) {
    throw new Error(
      `Built binary not found at ${builtCliPath}. Run 'pnpm build' first, or run this suite through ` +
        "'pnpm turbo run test --filter=@asterdoc/cli'.",
    )
  }
})

describe('CLI render command', () => {
  const fixture = path.join(fixturesDir, 'pet-addendum.yaml')

  it('should show help', async () => {
    const result = await executeCliCommand(['render', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--out')
    expect(result.stdout).toContain('--layer')
    expect(result.stdout).toContain('--format')
    expect(result.stdout).toContain('--data')
    expect(result.stdout).toContain('--dry-run')
    expect(result.stdout).not.toContain('--renderer')
  })

  it('should render an inline layer to stdout', async () => {
    const result = await executeCliCommand(['render', fixture])

    expect(result.exitCode).toBe(0)
    // The pet-addendum has an inline markdown layer
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  it('should support dry-run', async () => {
    const result = await executeCliCommand(['render', fixture, '--dry-run'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Dry run')
    expect(result.stdout).toContain('pet-addendum')
  })

  it('should support dry-run with --format json', async () => {
    const result = await executeCliCommand(['render', fixture, '--dry-run', '--format', 'json'])

    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.mode).toBe('dry-run')
    expect(json.artifact.name).toBe('pet-addendum')
  })

  it('should fail for non-existent file', async () => {
    const result = await executeCliCommand(['render', '/tmp/nonexistent.yaml'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Error')
  })

  describe('render with data', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asterdoc-render-test-'))
    })

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    })

    it('should render with inline JSON data', async () => {
      const data = JSON.stringify({
        fields: {
          name: 'Rex',
          species: 'dog',
          weight: 30,
          hasVaccination: true,
        }
      })

      const result = await executeCliCommand(['render', fixture, '--data', data])

      expect(result.exitCode).toBe(0)
      // The rendered output should contain the substituted values
      expect(result.stdout).toContain('Rex')
    })

    it('should render with data from file', async () => {
      const dataPath = path.join(tempDir, 'data.json')
      await fs.writeFile(dataPath, JSON.stringify({
        fields: {
          name: 'Luna',
          species: 'cat',
          weight: 5,
          hasVaccination: false,
        }
      }))

      const result = await executeCliCommand(['render', fixture, '--data', dataPath])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Luna')
    })

    it.each([
      ['PDF', 'pet-addendum-pdf.yaml', 'output.pdf', '%PDF'],
      ['DOCX', 'pet-addendum-docx.yaml', 'output.docx', 'PK'],
    ])('should select the %s renderer from the layer MIME type', async (_format, fixtureName, outputName, signature) => {
      const outPath = path.join(tempDir, outputName)
      const data = JSON.stringify({
        fields: {
          name: 'Milo',
          species: 'cat',
          weight: 5,
          hasVaccination: true,
        },
      })

      const result = await executeCliCommand([
        'render',
        path.join(fixturesDir, fixtureName),
        '--data',
        data,
        '--out',
        outPath,
      ])

      expect(result.exitCode).toBe(0)
      const content = await fs.readFile(outPath)
      expect(content.subarray(0, signature.length).toString()).toBe(signature)
    })

    it('should fill a PDF through --bindings binding objects, each with its own format', async () => {
      const outPath = path.join(tempDir, 'bound.pdf')
      const data = JSON.stringify({ fields: { name: 'Milo', species: 'cat', weight: 5.5, hasVaccination: true } })
      const bindings = JSON.stringify({ pet_name: 'fields.name', petWeight: { path: 'fields.weight', format: { locale: 'de-DE' } } })

      const result = await executeCliCommand([
        'render', path.join(fixturesDir, 'pet-addendum-pdf-bindings.yaml'), '--data', data, '--bindings', bindings, '--out', outPath,
      ])

      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      const { inspectAcroFormFields } = await import('@asterdoc/render/pdf')
      const fields = await inspectAcroFormFields(new Uint8Array(await fs.readFile(outPath)))
      expect(Object.fromEntries(fields.map((field) => [field.name, field.value]))).toMatchObject({ pet_name: 'Milo', petWeight: '5,5' })
    })

    it.each([
      ['prints the value of the def', true, 'Milo'],
      ['leaves the box empty when the def is empty', false, ''],
    ])('should fill a PDF box that is bound to a def: %s', async (_case, hasVaccination, printed) => {
      const outPath = path.join(tempDir, 'def-bound.pdf')
      const data = JSON.stringify({ fields: { name: 'Milo', hasVaccination } })

      const result = await executeCliCommand(['render', path.join(fixturesDir, 'pet-addendum-pdf-defs.yaml'), '--data', data, '--out', outPath])

      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      const { inspectAcroFormFields } = await import('@asterdoc/render/pdf')
      const fields = await inspectAcroFormFields(new Uint8Array(await fs.readFile(outPath)))
      expect(fields.find((field) => field.name === 'pet_name')?.value).toBe(printed)
    })

    it('should refuse a --bindings binding object the schema refuses', async () => {
      const data = JSON.stringify({ fields: { name: 'Milo', species: 'cat', weight: 5, hasVaccination: true } })
      const bindings = JSON.stringify({ petWeight: { path: 'fields.weight', format: { locale: 'not a locale' } } })

      const result = await executeCliCommand(['render', path.join(fixturesDir, 'pet-addendum-pdf-bindings.yaml'), '--data', data, '--bindings', bindings, '--out', path.join(tempDir, 'refused.pdf')])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('binding "petWeight", is not a valid binding object')
    })

    it('should print a phone style from the layer format with the bundled phone provider', async () => {
      const artifactPath = path.join(tempDir, 'phone.json')
      await fs.writeFile(artifactPath, JSON.stringify({
        $schema: ASTERDOC_SCHEMA_URL,
        kind: 'form',
        name: 'phone',
        version: '1.0.0',
        title: 'Phone',
        fields: { phone: { type: 'phone', label: 'Phone' }, agreed: { type: 'boolean', label: 'Agreed' } },
        layers: {
          default: {
            kind: 'inline',
            mimeType: 'text/plain',
            text: 'Call {{fields.phone}} ({{fields.agreed}})',
            format: { phone: { style: 'national' }, boolean: { trueLabel: 'agreed' } },
          },
        },
      }))
      const data = JSON.stringify({ fields: { phone: { number: '+12125551234' }, agreed: true } })

      const result = await executeCliCommand(['render', artifactPath, '--data', data])

      expect(result).toMatchObject({ exitCode: 0, stdout: 'Call (212) 555-1234 (agreed)' })
    })

    it('should refuse --bindings for a layer that is not a PDF', async () => {
      const data = JSON.stringify({ fields: { name: 'Milo', species: 'cat', weight: 5, hasVaccination: true } })

      const result = await executeCliCommand(['render', fixture, '--data', data, '--bindings', '{"pet":"fields.name"}'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Layer "default" is not a PDF layer, so the bindings render option does not apply')
    })

    it('should refuse --bindings for a non-PDF layer even without --data', async () => {
      const result = await executeCliCommand(['render', fixture, '--bindings', '{"pet":"fields.name"}'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Layer "default" is not a PDF layer, so the bindings render option does not apply')
    })

    it('should write output to file with --out', async () => {
      const outPath = path.join(tempDir, 'output.md')

      const result = await executeCliCommand(['render', fixture, '--out', outPath])

      expect(result.exitCode).toBe(0)

      const content = await fs.readFile(outPath, 'utf-8')
      expect(content).toContain('Pet Addendum')
    })

    it('should specify layer with --layer', async () => {
      // pet-addendum.yaml has a 'default' layer
      const result = await executeCliCommand(['render', fixture, '--layer', 'default'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout.length).toBeGreaterThan(0)
    })

    it('should fail for nonexistent layer', async () => {
      const result = await executeCliCommand(['render', fixture, '--layer', 'nonexistent'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/not found|error/i)
    })

    it('reports the same core error for a React layer with and without data', async () => {
      const artifactPath = path.join(tempDir, 'react-form.json')
      await fs.writeFile(artifactPath, JSON.stringify({
        $schema: ASTERDOC_SCHEMA_URL,
        kind: 'form',
        name: 'react-form',
        version: '1.0.0',
        title: 'React Form',
        description: 'Exercises React layer errors.',
        fields: {},
        layers: {
          composition: { kind: 'file', mimeType: 'text/tsx', path: 'composition.tsx' },
        },
        defaultLayer: 'composition',
      }))

      const withoutData = await executeCliCommand(['render', artifactPath])
      const withData = await executeCliCommand([
        'render', artifactPath, '--data', JSON.stringify({ fields: {} }),
      ])
      const message = 'Layer "composition" has MIME type text/tsx and no renderer is registered for it'

      expect(withoutData).toMatchObject({ exitCode: 1 })
      expect(withData).toMatchObject({ exitCode: 1 })
      expect(withoutData.stderr).toContain(message)
      expect(withData.stderr).toContain(message)
    })
  })

  describe('file-layer resolution', () => {
    let sandbox: string
    let artifactDir: string
    let outsideDir: string

    beforeEach(async () => {
      sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'asterdoc-cli-resolver-'))
      artifactDir = path.join(sandbox, 'artifacts', 'nested')
      outsideDir = path.join(sandbox, 'outside')
      await Promise.all([
        fs.mkdir(path.join(artifactDir, 'templates'), { recursive: true }),
        fs.mkdir(outsideDir, { recursive: true }),
      ])
      await Promise.all([
        fs.writeFile(path.join(artifactDir, 'templates', 'layer.md'), 'inside layer'),
        fs.writeFile(path.join(artifactDir, '..valid.md'), 'dot-prefixed layer'),
        fs.writeFile(path.join(outsideDir, 'sentinel.md'), 'outside sentinel'),
      ])
    })

    afterEach(async () => {
      await fs.rm(sandbox, { recursive: true, force: true })
    })

    async function writeArtifact(layerPath: string): Promise<string> {
      const artifactPath = path.join(artifactDir, 'artifact.json')
      await fs.writeFile(artifactPath, JSON.stringify({
        $schema: ASTERDOC_SCHEMA_URL,
        kind: 'document',
        name: 'resolver-test',
        version: '1.0.0',
        title: 'Resolver Test',
        description: 'Exercises CLI file-layer resolution.',
        defaultLayer: 'default',
        layers: {
          default: { kind: 'file', mimeType: 'text/markdown', path: layerPath },
        },
      }))
      return artifactPath
    }

    it.each(['templates/layer.md', '/templates/layer.md'])(
      'resolves %s inside the artifact directory from another cwd',
      async (layerPath) => {
        const artifactPath = await writeArtifact(layerPath)
        const result = await executeCliCommand(['render', artifactPath], { cwd: outsideDir })
        const resolverBytes = await createFsResolver({ root: artifactDir }).read(layerPath)
        expect(result).toMatchObject({ exitCode: 0, stdout: 'inside layer' })
        expect(result.stdout).toBe(new TextDecoder().decode(resolverBytes))
      },
    )

    it('resolves artifact-relative layers through the built package executable', async () => {
      const artifactPath = await writeArtifact('templates/layer.md')
      const result = await executeCliCommand(['render', artifactPath], {
        built: true,
        cwd: outsideDir,
      })
      expect(result).toMatchObject({ exitCode: 0, stdout: 'inside layer' })
    })

    it('uses cwd as the resolver root for stdin artifacts', async () => {
      await fs.writeFile(path.join(outsideDir, 'stdin.md'), 'stdin layer')
      const artifactPath = await writeArtifact('/stdin.md')
      const raw = await fs.readFile(artifactPath, 'utf8')
      const result = await executeCliCommand(['render', '-'], { cwd: outsideDir, stdin: raw })
      expect(result).toMatchObject({ exitCode: 0, stdout: 'stdin layer' })
    })

    it('renders valid dot-prefixed paths', async () => {
      const artifactPath = await writeArtifact('..valid.md')
      const result = await executeCliCommand(['render', artifactPath])
      expect(result).toMatchObject({ exitCode: 0, stdout: 'dot-prefixed layer' })
    })

    it.each([
      '../outside/sentinel.md',
      '/tmp/outside/sentinel.md',
      'C:/outside/sentinel.md',
      'outside\\sentinel.md',
    ])('rejects escape path %s without emitting outside bytes', async (layerPath) => {
      const artifactPath = await writeArtifact(layerPath)
      const result = await executeCliCommand(['render', artifactPath])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).not.toContain('outside sentinel')
      expect(result.stderr).toContain('Error:')
    })

    it('rejects outward file and directory symlinks', async () => {
      await fs.symlink(path.join(outsideDir, 'sentinel.md'), path.join(artifactDir, 'outside-file'))
      await fs.symlink(outsideDir, path.join(artifactDir, 'outside-dir'))

      for (const layerPath of ['outside-file', 'outside-dir/sentinel.md']) {
        const artifactPath = await writeArtifact(layerPath)
        const result = await executeCliCommand(['render', artifactPath])
        expect(result.exitCode).toBe(1)
        expect(result.stdout).not.toContain('outside sentinel')
        expect(result.stderr).toContain('outside the configured root')
      }
    })

    it('renders the artifact-relative path produced by attach from another cwd', async () => {
      const artifactPath = await writeArtifact('templates/layer.md')
      const attachedPath = path.join(artifactDir, 'attached.md')
      await fs.writeFile(attachedPath, 'attached layer')
      const attached = await executeCliCommand([
        'attach', artifactPath, attachedPath, '--yes', '--name', 'attached',
      ], { cwd: outsideDir })
      expect(attached.exitCode).toBe(0)

      const rendered = await executeCliCommand([
        'render', artifactPath, '--layer', 'attached',
      ], { cwd: outsideDir })
      expect(rendered).toMatchObject({ exitCode: 0, stdout: 'attached layer' })
    })
  })

  describe('render --draft', () => {
    let tempDir: string
    let formFile: string
    let outFile: string

    const intake = {
      $schema: ASTERDOC_SCHEMA_URL,
      kind: 'form',
      name: 'intake',
      version: '1.0.0',
      title: 'Intake',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        weight: { type: 'number', label: 'Weight', required: true, min: 1 },
        hasPet: { type: 'boolean', label: 'Has a pet' },
        petName: { type: 'text', label: 'Pet name', visible: 'fields.hasPet == true' },
      },
      rules: {
        realName: { expr: 'fields.name != "Nobody"', severity: 'error', message: 'Give a real name' },
      },
      layers: { text: { kind: 'inline', mimeType: 'text/plain', text: 'Name: {{fields.name}}. Weight: {{fields.weight}}.' } },
      defaultLayer: 'text',
    }

    const render = async (fields: Record<string, unknown>, ...flags: string[]) => {
      const dataFile = path.join(tempDir, 'data.json')
      await fs.writeFile(dataFile, JSON.stringify({ fields }))
      return executeCliCommand(['render', formFile, '--data', dataFile, '--out', outFile, ...flags])
    }

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asterdoc-render-draft-'))
      formFile = path.join(tempDir, 'intake.json')
      outFile = path.join(tempDir, 'out.txt')
      await fs.writeFile(formFile, JSON.stringify(intake))
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('refuses data with an open required field, writes no file, and names --draft', async () => {
      const result = await render({ name: 'Rex' })
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('fields.weight: Missing required field: fields.weight')
      expect(result.stderr).toContain('To render the data as it is, with each of these left empty, add --draft.')
      expect(existsSync(outFile)).toBe(false)
    })

    it('with --draft, renders the data with the open field empty and lists what is open', async () => {
      const result = await render({ name: 'Rex' }, '--draft')
      expect(result.exitCode, result.stderr).toBe(0)
      expect(await fs.readFile(outFile, 'utf8')).toBe('Name: Rex. Weight: .')
      expect(result.stderr).toContain('Draft: the data is not complete. This is still open:')
      expect(result.stderr).toContain('  - fields.weight: Missing required field: fields.weight')
    })

    it('with --draft, lists a rule that is not met beside the open fields', async () => {
      const result = await render({ name: 'Nobody' }, '--draft')
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.stderr).toContain('Draft: the data is not complete. These are still open:')
      expect(result.stderr).toContain('  - rules.realName: Give a real name')
    })

    it('with --draft, still refuses a value the form does not accept and a value for a field that does not apply', async () => {
      const invalid = await render({ name: 'Rex', weight: 0 }, '--draft')
      expect(invalid.exitCode).toBe(1)
      expect(invalid.stderr).toContain('fields.weight')
      const hidden = await render({ name: 'Rex', weight: 30, petName: 'Milo' }, '--draft')
      expect(hidden.exitCode).toBe(1)
      expect(hidden.stderr).toContain('fields.petName: A value is given, but this field does not apply.')
      expect(existsSync(outFile)).toBe(false)
    })

    it('does not name --draft for data that a draft render refuses too', async () => {
      const result = await render({ name: 'Rex', weight: 30, petName: 'Milo' })
      expect(result.exitCode).toBe(1)
      expect(result.stderr).not.toContain('--draft')
    })

    it('with --draft and complete data, renders with no draft note', async () => {
      const result = await render({ name: 'Rex', weight: 30 }, '--draft')
      expect(result.exitCode, result.stderr).toBe(0)
      expect(await fs.readFile(outFile, 'utf8')).toBe('Name: Rex. Weight: 30.')
      expect(result.stderr).not.toContain('Draft')
    })

    describe('for a form with a role that needs one party', () => {
      const owner = { name: 'Dana Ortiz' }
      const renderWithParties = async (data: Record<string, unknown>, ...flags: string[]) => {
        const dataFile = path.join(tempDir, 'data.json')
        await fs.writeFile(dataFile, JSON.stringify(data))
        return executeCliCommand(['render', formFile, '--data', dataFile, '--out', outFile, ...flags])
      }

      beforeEach(async () => {
        await fs.writeFile(formFile, JSON.stringify({ ...intake, parties: { owner: { label: 'Owner', partyType: 'person', min: 1, max: 1 } } }))
      })

      it('names a missing party, a missing field and a rule that is not met in one refusal', async () => {
        const result = await renderWithParties({ fields: { name: 'Nobody' } })
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('fields.weight: Missing required field: fields.weight')
        expect(result.stderr).toContain('parties.owner: Role "owner" requires at least 1 party(ies)')
        expect(result.stderr).toContain('rules.realName: Give a real name')
        expect(result.stderr).toContain('add --draft')
      })

      it('with --draft, renders and lists all three as open', async () => {
        const result = await renderWithParties({ fields: { name: 'Nobody' } }, '--draft')
        expect(result.exitCode, result.stderr).toBe(0)
        expect(result.stderr).toContain('  - fields.weight: Missing required field: fields.weight')
        expect(result.stderr).toContain('  - parties.owner: Role "owner" requires at least 1 party(ies)')
        expect(result.stderr).toContain('  - rules.realName: Give a real name')
        expect(await fs.readFile(outFile, 'utf8')).toBe('Name: Nobody. Weight: .')
      })

      it('with --draft, still refuses more parties than the role allows', async () => {
        const result = await renderWithParties({ fields: { name: 'Rex', weight: 30 }, parties: { owner: [owner, { name: 'Sam Ortiz' }] } }, '--draft')
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('parties.owner')
        expect(existsSync(outFile)).toBe(false)
      })
    })

    it('with --format json, gives the open items in the summary', async () => {
      const result = await render({ name: 'Rex' }, '--draft', '--format', 'json')
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ success: true, draft: { open: ['fields.weight: Missing required field: fields.weight'] } })
    })
  })

  describe('render --check', () => {
    let tempDir: string
    let outFile: string

    const pet = (bindings: Record<string, unknown>) => ({
      $schema: ASTERDOC_SCHEMA_URL,
      kind: 'form',
      name: 'pet',
      version: '1.0.0',
      title: 'Pet',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        weight: { type: 'number', label: 'Weight' },
        species: { type: 'enum', label: 'Species', enum: [{ value: 'dog' }, { value: 'cat' }] },
      },
      layers: {
        pdf: { kind: 'file', mimeType: 'application/pdf', path: './pet.pdf', bindings },
        text: { kind: 'inline', mimeType: 'text/plain', text: 'Name: {{fields.name}}' },
      },
      defaultLayer: 'pdf',
    })
    const data = JSON.stringify({ fields: { name: 'Milo Rex', weight: 5.5, species: 'cat' } })

    const render = async (bindings: Record<string, unknown>, ...flags: string[]) => {
      const formFile = path.join(tempDir, 'pet.json')
      await fs.writeFile(formFile, JSON.stringify(pet(bindings)))
      return executeCliCommand(['render', formFile, ...flags])
    }

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asterdoc-render-check-'))
      outFile = path.join(tempDir, 'filled.pdf')
      await fs.copyFile(path.join(fixturesDir, 'pet-addendum-bindings.pdf'), path.join(tempDir, 'pet.pdf'))
    })

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('reads the PDF back and says in one line that every value equals the data', async () => {
      const result = await render({ pet_name: 'fields.name', petWeight: 'fields.weight' }, '--data', data, '--out', outFile, '--check')
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.stdout).toContain(`Read back from ${outFile}: 2 values equal the data.\n`)
      expect(result.stdout).not.toContain('Not compared')
    })

    it('says nothing of a read-back without --check', async () => {
      const result = await render({ pet_name: 'fields.name', petWeight: 'fields.weight' }, '--data', data, '--out', outFile)
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.stdout).not.toContain('Read back')
    })

    it('exits 0 for values that print in a form that does not read back, and shows what the box holds', async () => {
      const result = await render({ pet_name: { template: '{{fields.name}} {{fields.species}}' }, petWeight: 'fields.weight' }, '--data', data, '--out', outFile, '--check')
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.stdout).toContain('1 value equals the data.')
      expect(result.stdout).toContain('  Not compared (2): each one prints in a form that does not read back as one value. This is not a fault.\n    - name: the PDF holds "Milo Rex cat"\n    - species: the PDF holds "Milo Rex cat"\n')
    })

    it('exits 1 and names the path when a box cannot be read back as the value, with the file still written', async () => {
      const result = await render({ pet_name: 'fields.name', petWeight: { path: 'fields.name', format: { case: 'upper' } } }, '--data', data, '--out', outFile, '--check')
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('0 values equal the data, 1 cannot be read.')
      expect(result.stdout).toContain('    - name: The PDF fields that carry this path hold different values.')
      expect(existsSync(outFile)).toBe(true)
    })

    it('gives the result in the summary with --format json', async () => {
      const result = await render({ pet_name: 'fields.name', petWeight: 'fields.weight' }, '--data', data, '--out', outFile, '--check', '--format', 'json')
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ success: true, check: { passed: true, equal: 2, differ: [], notPrinted: [], unreadable: [], notCompared: [] } })
    })

    it.each([
      ['no --out', ['--data', data]],
      ['no --data', ['--out', 'filled.pdf']],
      ['a layer that is not a PDF', ['--data', data, '--out', 'filled.txt', '--layer', 'text']],
    ])('refuses --check with %s and writes no file', async (_case, flags) => {
      const result = await render({ pet_name: 'fields.name' }, ...flags, '--check')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('--check reads a filled PDF back: it needs a form artifact, a PDF layer, --data and --out.')
      expect(existsSync(outFile)).toBe(false)
    })
  })
})
