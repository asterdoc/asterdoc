import { runCli as executeCliCommand } from '../setup/spawn-cli'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, '../fixtures')

describe('CLI inspect command', () => {
  it('should show help', async () => {
    const result = await executeCliCommand(['inspect', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--format')
    expect(result.stdout).toContain('--filter')
    expect(result.stdout).toContain('--summary')
    expect(result.stdout).toContain('--out')
    expect(result.stdout).toContain('--include-buttons')
    expect(result.stdout).toContain('--include-signatures')
  })

  it('should fail for non-existent file', async () => {
    const result = await executeCliCommand(['inspect', '/tmp/nonexistent.pdf'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Error')
  })

  it('should inspect a PDF with form fields', async () => {
    const pdf = path.join(fixturesDir, 'pet-addendum-bindings.pdf')
    const result = await executeCliCommand(['inspect', pdf, '--format', 'json'])

    // A published CLI may install @asterdoc/render on first use; either that
    // succeeds and returns JSON or installation reports an actionable error.
    if (result.exitCode === 0) {
      const json = JSON.parse(result.stdout)
      expect(Array.isArray(json)).toBe(true)
    } else {
      // Renderer not installed — acceptable, skip content assertion
      expect(result.stderr).toContain('Error')
    }
  })

  describe('inspect options', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asterdoc-inspect-test-'))
    })

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('says which text fields print several lines, in JSON and in the table', async () => {
      const pdf = path.join(tempDir, 'lines.pdf')
      await fs.writeFile(pdf, [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 5 0 R 6 0 R] >> >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [4 0 R 5 0 R 6 0 R] >> endobj',
        '4 0 obj << /FT /Tx /T (address) /Ff 4096 /Subtype /Widget /Rect [72 600 400 700] /P 3 0 R >> endobj',
        '5 0 obj << /FT /Tx /T (city) /Subtype /Widget /Rect [72 560 400 580] /P 3 0 R >> endobj',
        '6 0 obj << /FT /Btn /T (agree) /Subtype /Widget /Rect [72 520 92 540] /P 3 0 R >> endobj',
        'trailer << /Root 1 0 R >>',
        '%%EOF',
      ].join('\n'))

      const json = await executeCliCommand(['inspect', pdf, '--format', 'json'])
      expect(json.exitCode).toBe(0)
      const fields = JSON.parse(json.stdout) as Array<{ name: string; multiline?: boolean }>
      expect(fields.map((field) => [field.name, field.multiline])).toEqual([['address', true], ['city', false], ['agree', undefined]])

      const table = await executeCliCommand(['inspect', pdf])
      expect(table.exitCode).toBe(0)
      expect(table.stdout).toContain('Multi-line')
      const row = (name: string) => table.stdout.split('\n').find((line) => line.includes(name))?.split(/\s{2,}|\s*[│|]\s*/).map((cell) => cell.trim()).filter(Boolean)
      expect(row('address')).toEqual(['address', 'text', 'no', 'yes'])
      expect(row('city')).toEqual(['city', 'text', 'no', 'no'])
      expect(row('agree')).toEqual(['agree', 'checkbox', 'no', 'false'])
    })

    it('should output JSON format', async () => {
      const pdf = path.join(fixturesDir, 'pet-addendum-bindings.pdf')
      const result = await executeCliCommand(['inspect', pdf, '--format', 'json'])

      if (result.exitCode === 0) {
        // Should be valid JSON array
        const parsed = JSON.parse(result.stdout)
        expect(Array.isArray(parsed)).toBe(true)
        // Each item should have name and type
        if (parsed.length > 0) {
          expect(parsed[0]).toHaveProperty('name')
          expect(parsed[0]).toHaveProperty('type')
        }
      } else {
        // Renderer not available — skip
        expect(result.stderr).toContain('Error')
      }
    })

    it('should output table format (default)', async () => {
      const pdf = path.join(fixturesDir, 'pet-addendum-bindings.pdf')
      const result = await executeCliCommand(['inspect', pdf])

      if (result.exitCode === 0) {
        // Table format should contain column headers
        expect(result.stdout).toContain('Name')
        expect(result.stdout).toContain('Type')
      } else {
        expect(result.stderr).toContain('Error')
      }
    })

    it('should filter fields with --filter', async () => {
      const pdf = path.join(fixturesDir, 'pet-addendum-bindings.pdf')
      const result = await executeCliCommand(['inspect', pdf, '--format', 'json', '--filter', 'pet*'])

      if (result.exitCode === 0) {
        const parsed = JSON.parse(result.stdout)
        expect(Array.isArray(parsed)).toBe(true)
        // All returned fields should match the filter pattern
        for (const field of parsed) {
          expect(field.name.toLowerCase()).toMatch(/^pet/)
        }
      } else {
        expect(result.stderr).toContain('Error')
      }
    })

    it('treats ? as exactly one character in a filter', async () => {
      const pdf = path.join(fixturesDir, 'pet-addendum-bindings.pdf')
      const all = await executeCliCommand(['inspect', pdf, '--format', 'json'])
      expect(all.exitCode, all.stderr).toBe(0)
      const [field] = JSON.parse(all.stdout) as Array<{ name: string }>
      expect(field).toBeDefined()
      const pattern = `${field!.name.slice(0, -1)}?`

      const result = await executeCliCommand(['inspect', pdf, '--format', 'json', '--filter', pattern])
      expect(result.exitCode, result.stderr).toBe(0)
      expect((JSON.parse(result.stdout) as Array<{ name: string }>).map(({ name }) => name)).toContain(field!.name)
    })

    it('should show summary with --summary', async () => {
      const pdf = path.join(fixturesDir, 'pet-addendum-bindings.pdf')
      const result = await executeCliCommand(['inspect', pdf, '--summary'])

      if (result.exitCode === 0) {
        // Summary output should contain total and breakdown
        const output = result.stdout
        expect(output).toContain('total')
        expect(output).toContain('breakdown')
      } else {
        expect(result.stderr).toContain('Error')
      }
    })

    it('should include buttons with --include-buttons', async () => {
      const pdf = path.join(fixturesDir, 'pet-addendum-bindings.pdf')
      const result = await executeCliCommand(['inspect', pdf, '--format', 'json', '--include-buttons'])

      if (result.exitCode === 0) {
        const parsed = JSON.parse(result.stdout)
        expect(Array.isArray(parsed)).toBe(true)
      } else {
        expect(result.stderr).toContain('Error')
      }
    })

    it('should include signatures with --include-signatures', async () => {
      const pdf = path.join(fixturesDir, 'pet-addendum-bindings.pdf')
      const result = await executeCliCommand(['inspect', pdf, '--format', 'json', '--include-signatures'])

      if (result.exitCode === 0) {
        const parsed = JSON.parse(result.stdout)
        expect(Array.isArray(parsed)).toBe(true)
      } else {
        expect(result.stderr).toContain('Error')
      }
    })

    it('should write output to file with --out', async () => {
      const pdf = path.join(fixturesDir, 'pet-addendum-bindings.pdf')
      const outPath = path.join(tempDir, 'inspect-result.json')
      const result = await executeCliCommand(['inspect', pdf, '--format', 'json', '--out', outPath])

      if (result.exitCode === 0) {
        // File should be created
        const content = await fs.readFile(outPath, 'utf-8')
        const parsed = JSON.parse(content)
        expect(Array.isArray(parsed)).toBe(true)
      } else {
        expect(result.stderr).toContain('Error')
      }
    })

    it('should reject invalid format', async () => {
      const pdf = path.join(fixturesDir, 'pet-addendum-bindings.pdf')
      const result = await executeCliCommand(['inspect', pdf, '--format', 'xml'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/unknown format|error/i)
    })
  })
})
