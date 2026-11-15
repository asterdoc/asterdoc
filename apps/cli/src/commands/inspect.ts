import { Command } from 'commander'
import kleur from 'kleur'
import { LocalFileSystem } from '../utils/local-fs.js'
import { formatTable } from '../utils/table.js'
import { inspectAcroFormFields, type PdfFieldInfo } from '@asterdoc/render/pdf'

import { readBinaryInput } from '../utils/io.js'

interface InspectOptions {
  format?: 'table' | 'json'
  filter?: string
  summary?: boolean
  includeButtons?: boolean
  includeSignatures?: boolean
  out?: string
}

export function createInspectCommand(): Command {
  const inspect = new Command('inspect')

  inspect
    .argument('<pdf>', 'PDF template file (path or "-" for stdin)')
    .description('Inspect PDF form fields to aid in bindings configuration')
    .option('--format <format>', 'Output format: table|json', 'table')
    .option('--filter <pattern>', 'Filter field names by glob (e.g. "party_*")')
    .option('--summary', 'Show totals only (no field listing)')
    .option('--include-buttons', 'Include button fields in the output')
    .option('--include-signatures', 'Include signature fields in the output')
    .option('--out <file>', 'Write inspection result to JSON file')
    .action(async (pdfTarget: string, options: InspectOptions) => {
      try {
        const storage = new LocalFileSystem()

        const format = normalizeFormatOption(options.format ?? 'table')
        const { data, sourcePath } = await readBinaryInput(pdfTarget)

        const fields = await inspectAcroFormFields(data, {
          includeButton: Boolean(options.includeButtons),
          includeSignature: Boolean(options.includeSignatures),
        })

        const filtered = applyFilter(fields, options.filter)

        if (options.out) {
          const outputPath = options.out
          await storage.writeFile(outputPath, JSON.stringify(filtered, null, 2))
        }

        if (options.summary) {
          printSummary(filtered, sourcePath)
          return
        }

        if (format === 'json') {
          console.log(JSON.stringify(filtered, null, 2))
        } else {
          printTable(filtered, sourcePath)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(kleur.red(`Error: ${message}`))
        process.exitCode = 1
      }
    })

  return inspect
}

function normalizeFormatOption(value: string): InspectOptions['format'] {
  const normalized = value.toLowerCase()
  if (normalized !== 'table' && normalized !== 'json') {
    throw new Error(`Unknown format "${value}". Use "table" or "json".`)
  }
  return normalized as InspectOptions['format']
}

function applyFilter(fields: PdfFieldInfo[], pattern?: string): PdfFieldInfo[] {
  if (!pattern) return fields

  const regex = globToRegex(pattern)
  return fields.filter((field) => regex.test(field.name))
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[-[\]/{}()+.\\^$|]/g, '\\$&')
  const regexPattern = `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`
  return new RegExp(regexPattern, 'i')
}

function printTable(fields: PdfFieldInfo[], sourcePath?: string): void {
  if (fields.length === 0) {
    console.log(kleur.yellow('No matching fields found.'))
    return
  }

  const rows = fields.map((field) => [
    field.name,
    field.type,
    field.required ? 'yes' : 'no',
    field.multiline === undefined ? '' : field.multiline ? 'yes' : 'no',
    formatFieldValue(field.value),
  ])

  console.log(kleur.cyan(`Fields from ${sourcePath ?? 'stdin'}:`))
  console.log(formatTable(['Name', 'Type', 'Required', 'Multi-line', 'Value'], rows))
  for (const line of optionLines(fields)) console.log(line)
}

function optionLines(fields: PdfFieldInfo[]): string[] {
  const withOptions = fields.filter((field) => field.options !== undefined && field.options.length > 0)
  if (withOptions.length === 0) return []
  const first = new Map<string, string>()
  const lines = ['', kleur.cyan('Options (the value the PDF stores = the text it shows):')]
  for (const field of withOptions) {
    const options = field.options!
    const key = JSON.stringify(options)
    const same = first.get(key)
    if (same !== undefined) {
      lines.push(`  ${field.name}: the same as ${same}`)
      continue
    }
    first.set(key, field.name)
    lines.push(`  ${field.name}:`)
    for (const { value, label } of options) lines.push(`    ${JSON.stringify(value)}${label === value ? '' : ` = ${label}`}`)
  }
  return lines
}

function printSummary(fields: PdfFieldInfo[], sourcePath?: string): void {
  const totals = fields.reduce<Record<string, number>>((acc, field) => {
    acc[field.type] = (acc[field.type] ?? 0) + 1
    return acc
  }, {})

  const summary = {
    source: sourcePath ?? 'stdin',
    total: fields.length,
    breakdown: totals,
  }

  console.log(JSON.stringify(summary, null, 2))
}

function formatFieldValue(value: PdfFieldInfo['value']): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}
