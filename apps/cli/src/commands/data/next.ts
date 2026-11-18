import { Command } from 'commander'
import kleur from 'kleur'
import { FormValidationError, isForm, type FillBatch, type FillBatchTarget, type Form, type FormInstance } from '@asterdoc/core'
import { resolveLayerBindings } from '@asterdoc/render'
import { pdfBindingPages } from '@asterdoc/render/pdf'
import { createFsResolver } from '@asterdoc/resolvers/fs'

import { readTextInput, resolveArtifactTarget } from '../../utils/io.js'
import { loadFormFile } from '../../utils/load-form.js'
import { parseDataInput, toFormPayload } from '../../utils/data-input.js'
import { loadValidatedArtifact } from '../../utils/artifact-file.js'
import { batchProblems } from '../../utils/validate-data.js'

interface NextOptions {
  data?: string
  json?: boolean
  layer?: string
  full?: boolean
}

interface PageSource {
  layer: string
  path: string
  byPath: Map<string, number[]>
}

function pageLayerKey(form: Form, requested: string | undefined): string | undefined {
  const layers = form.layers ?? {}
  const pdfKeys = Object.keys(layers).filter((key) => layers[key]!.kind === 'file' && layers[key]!.mimeType.toLowerCase() === 'application/pdf')
  if (requested !== undefined) {
    if (!pdfKeys.includes(requested)) throw new Error(`Layer "${requested}" is not a PDF layer of this form. PDF layers: ${pdfKeys.join(', ') || '(none)'}.`)
    return requested
  }
  if (pdfKeys.length === 1) return pdfKeys[0]
  return form.defaultLayer !== undefined && pdfKeys.includes(form.defaultLayer) ? form.defaultLayer : undefined
}

async function pageSource(form: Form, baseDir: string, requested: string | undefined): Promise<PageSource | undefined> {
  const key = pageLayerKey(form, requested)
  if (key === undefined) return undefined
  const layers = form.layers ?? {}
  const layer = layers[key]!
  const bindings = resolveLayerBindings(layers, layer)
  if (layer.kind !== 'file' || !bindings) return undefined
  let template: Uint8Array
  try {
    template = await createFsResolver({ root: baseDir }).read(layer.path)
  } catch (error) {
    if (requested === undefined) return undefined
    throw new Error(`Layer "${key}" could not be read from "${layer.path}": ${error instanceof Error ? error.message : String(error)}`)
  }
  return { layer: key, path: layer.path, byPath: await pdfBindingPages({ template, bindings }) }
}

function targetPages(target: FillBatchTarget, source: PageSource | undefined): number[] | undefined {
  if (!source) return undefined
  const root = target.kind === 'party' ? `parties.${target.key}` : target.kind === 'annex' ? `annexes.${target.key}` : target.key
  const pages = new Set<number>()
  for (const [path, found] of source.byPath) {
    if (path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`)) for (const page of found) pages.add(page)
  }
  return pages.size === 0 ? undefined : [...pages].sort((a, b) => a - b)
}

function pageText(pages: number[] | undefined): string {
  if (!pages) return ''
  return pages.length === 1 ? `, page ${pages[0]}` : `, pages ${pages.join(', ')}`
}

interface Problem {
  path: string
  message: string
}

type NextResult = { problems: Problem[]; rules: Problem[]; batch: FillBatch | null }

function nextBatch(instance: FormInstance<Form>, payload: Record<string, unknown>): NextResult {
  const filled = instance.safeFill(payload as never)
  if (!filled.success) {
    const problems =
      filled.error instanceof FormValidationError
        ? filled.error.errors.map((error) => ({ path: error.field || 'root', message: error.message }))
        : [{ path: 'root', message: filled.error.message }]
    return { problems, rules: [], batch: null }
  }
  const batch = filled.data.getFillBatch()
  const problems = batchProblems(batch).map((issue) => ({ path: issue.path || 'root', message: issue.message }))
  const rules = batch.rules.errors.map((rule) => ({ path: `rules.${rule.ruleId}`, message: rule.message }))
  return { problems, rules, batch }
}

const OPTIONS_LINE_LIMIT = 400
const OPTIONS_REPEAT_LIMIT = 100

type OptionSets = Map<string, string>

function optionText(option: NonNullable<FillBatchTarget['options']>[number]): string {
  const value = JSON.stringify(option.value)
  return option.label === undefined || option.label.toLowerCase() === String(option.value).toLowerCase() ? value : `${value} = ${option.label}`
}

function optionLines(target: FillBatchTarget, printed: OptionSets): string[] {
  if (target.options === undefined) return []
  const options = target.options.map(optionText)
  const line = options.join('; ')
  if (line.length > OPTIONS_REPEAT_LIMIT) {
    const first = printed.get(line)
    if (first !== undefined) return [`      options: the same as ${first}`]
    printed.set(line, target.key)
  }
  return line.length <= OPTIONS_LINE_LIMIT ? [`      options: ${line}`] : ['      options:', ...options.map((option) => `        ${option}`)]
}

function constraintText(target: FillBatchTarget): string | undefined {
  if (target.constraints === undefined) return undefined
  return Object.entries(target.constraints)
    .map(([key, value]) => `${key} ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
    .join(', ')
}

function headLine(target: FillBatchTarget, pages: number[] | undefined, about: string[]): string {
  const kind = target.kind === 'field' ? target.type ?? 'field' : `${target.kind}${target.type ? `, ${target.type}` : ''}`
  const head = `  ${target.required ? '[required] ' : ''}${target.key} (${kind}${pageText(pages)})`
  const text = about.filter((part) => part !== '').join(' — ')
  return text === '' ? head : `${head}: ${text}`
}

const ROW_INDENT = '      '

function rowLines(target: FillBatchTarget, printed: OptionSets): string[] {
  if (target.kind === 'party' || target.item === undefined) return []
  if (target.rows === undefined) return [`      rows: ${target.item}`]
  return [
    '      rows: one object for each row, with these fields:',
    ...target.rows.flatMap((field) => targetLines(field, undefined, printed).map((line) => `${ROW_INDENT}${line}`)),
  ]
}

function targetLines(target: FillBatchTarget, pages: number[] | undefined, printed: OptionSets): string[] {
  const details: Array<[string, string | undefined]> = [
    ['shape', target.shape],
    ['prints', target.prints === undefined ? undefined : `${target.prints.join(', ')} (the form prints these: give each one${target.type === 'any' ? ' that the kind of the party has' : ''})`],
    ['format', target.format],
    ['limits', constraintText(target)],
    ['list', target.kind === 'party' && target.item !== undefined ? `this role takes a list: write an array with one ${target.item} object for each party` : undefined],
    ['input', target.input],
  ]
  return [
    headLine(target, pages, [target.label ?? '', target.description ?? '']),
    ...optionLines(target, printed),
    ...details.flatMap(([label, text]) => (text === undefined ? [] : [`      ${label}: ${text}`])),
    ...rowLines(target, printed),
  ]
}

function count(total: number, one: string, many: string): string {
  return `${total} ${total === 1 ? one : many}`
}

function statusLine(result: NextResult, batch: FillBatch): string {
  if (batch.complete) {
    if (batch.open.length === 0) return kleur.green('Complete: no target is open and every rule passes.')
    return `Ready to render, with ${count(batch.open.length, 'optional target', 'optional targets')} still open: fill each one you have a fact for first.`
  }
  const reasons = [
    ...(batch.summary.requiredRemaining > 0 ? [count(batch.summary.requiredRemaining, 'required target is open', 'required targets are open')] : []),
    ...(result.rules.length > 0 ? [count(result.rules.length, 'rule is not met', 'rules are not met')] : []),
    ...(result.problems.length > 0 ? [count(result.problems.length, 'problem is in the data', 'problems are in the data')] : []),
  ]
  return `Not ready to render: ${reasons.join(', ')}.`
}

interface PrintInput {
  formName: string
  formTarget: string
  dataTarget: string | undefined
  full: boolean
  result: NextResult
  source: PageSource | undefined
}

function printText({ formName, formTarget, dataTarget, full, result, source }: PrintInput): void {
  const dataArg = dataTarget ?? '<data.json>'
  if (result.problems.length > 0) {
    console.log(kleur.red(`Problems in the data (fix these first):`))
    for (const problem of result.problems) console.log(`  - ${problem.path}: ${problem.message}`)
    console.log('')
  }
  const batch = result.batch
  if (batch === null) {
    console.log(`Fix the data, then run: asterdoc data next ${formTarget} --data ${dataArg}`)
    return
  }
  const { requiredDone, requiredTotal } = batch.summary
  console.log(`Form ${formName}: ${requiredDone} of ${requiredTotal} required targets done.`)
  console.log(statusLine(result, batch))
  if (batch.open.length > 0) {
    const seen = dataTarget === undefined || full ? [] : batch.open.filter((target) => !target.required && target.conditional !== true)
    const detailed = batch.open.filter((target) => !seen.includes(target))
    console.log('')
    console.log(`Open now (${batch.open.length}): fill every one you have a fact for, in one batch.`)
    console.log('A target marked [required] must have a value. Every other target is optional.')
    if (source) console.log(`A page is where the value prints in ${source.path}.`)
    const printed: OptionSets = new Map()
    for (const target of detailed) for (const line of targetLines(target, targetPages(target, source), printed)) console.log(line)
    if (seen.length > 0) {
      console.log(`In short form (${seen.length}): the optional targets that no answer opened. The listing without --data has each one in full, and so does --full.`)
      for (const target of seen) console.log(headLine(target, targetPages(target, source), [target.label ?? '']))
    }
  }
  if (result.rules.length > 0) {
    console.log('')
    console.log('Rules not met yet (they say what else the form needs):')
    for (const rule of result.rules) console.log(`  - ${rule.path}: ${rule.message}`)
  }
  if (batch.rules.warnings.length > 0) {
    console.log('')
    console.log(kleur.yellow('Warnings (the form accepts these values, but each is probably wrong: check it against the facts):'))
    for (const rule of batch.rules.warnings) console.log(`  - rules.${rule.ruleId}: ${rule.message}`)
  }
  if (batch.waiting.on.length > 0) {
    console.log('')
    console.log(`Waiting: ${batch.waiting.count} more can open after answers to: ${batch.waiting.on.join(', ')}.`)
  }
  console.log('')
  const renderCommand = `asterdoc render ${formTarget} --data ${dataArg} --out filled.pdf`
  if (batch.complete) {
    if (batch.rules.warnings.length > 0) console.log('Correct each value under Warnings, or keep it and name it in your report.')
    console.log(`Render: ${renderCommand}`)
    return
  }
  console.log(`Next: add the values to ${dataArg} and run: asterdoc data next ${formTarget} --data ${dataArg}`)
  if (dataTarget !== undefined && result.problems.length === 0) {
    console.log(`With no fact for what is still open, render a draft and name each open item in your report: ${renderCommand} --draft`)
  }
}

/**
 * Create the 'next' command: the targets a form has open now, described for a
 * filler that supplies them in one batch.
 */
export function createNextCommand(): Command {
  const next = new Command('next')

  next
    .argument('<form-file>', 'Form artifact file (JSON/YAML)')
    .description('Show the fields open now, with how to fill each, for a batch fill')
    .option('--data <data>', 'Data filled so far: file path, "-" for stdin, or inline JSON')
    .option('--json', 'Output machine-readable JSON')
    .option('--layer <key>', 'PDF layer whose page numbers to show (defaults to the form\'s only PDF layer, or its default layer)')
    .option('--full', 'With --data: describe every open target in full, not the optional ones in short form')
    .action(async (formTarget: string, options: NextOptions) => {
      try {
        if (!formTarget || formTarget === '-') throw new Error('Form file path required. Use stdin only for --data.')
        const resolvedFormTarget = await resolveArtifactTarget(formTarget)
        const { raw, baseDir } = await readTextInput(resolvedFormTarget)
        const { artifact } = loadValidatedArtifact(raw)
        if (!isForm(artifact)) throw new Error(`Expected form artifact, but received kind "${artifact.kind}".`)
        const form = artifact as Form
        const payload = options.data === undefined ? {} : toFormPayload((await parseDataInput(options.data)).data)
        const result = nextBatch(await loadFormFile(form, baseDir), payload)
        const source = await pageSource(form, baseDir, options.layer)

        if (options.json) {
          const output = {
            form: form.name,
            complete: result.batch?.complete ?? false,
            problems: result.problems,
            rules: result.rules,
            ...(result.batch && {
              summary: result.batch.summary,
              open: result.batch.open.map((target) => {
                const pages = targetPages(target, source)
                return pages ? { ...target, pages } : target
              }),
              waiting: result.batch.waiting,
              warnings: result.batch.rules.warnings,
            }),
            ...(source && { pagesFrom: { layer: source.layer, path: source.path } }),
          }
          console.log(JSON.stringify(output, null, 2))
        } else {
          printText({ formName: form.name, formTarget, dataTarget: options.data, full: options.full === true, result, source })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(kleur.red(`Error: ${message}`))
        process.exitCode = 1
      }
    })

  return next
}
