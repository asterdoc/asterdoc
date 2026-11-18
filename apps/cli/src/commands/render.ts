import { Command } from 'commander'
import kleur from 'kleur'
import {
  renderLayer,
  resolveLayerKey,
  isForm,
  RenderRefusedError,
  type Artifact,
  type Layer,
  type Form,
} from '@asterdoc/core'
import { LocalFileSystem } from '../utils/local-fs.js'
import { createFsResolver } from '@asterdoc/resolvers/fs'

import { readTextInput, resolveArtifactTarget } from '../utils/io.js'
import { parseDataInput, toFormPayload } from '../utils/data-input.js'
import { loadValidatedArtifact } from '../utils/artifact-file.js'
import { createLayerRenderer } from '@asterdoc/render'
import { formatPayloadErrors, formatRenderProblems, validateDraftPayload, validateFormPayload, type FilledPayload } from '../utils/validate-data.js'
import { loadFormFile } from '../utils/load-form.js'
import { readBack, readBackLines, readBackPasses, type ReadBack } from '../utils/read-back.js'

type OutputFormat = 'json' | 'pretty'

interface RenderOptions {
  data?: string
  out?: string
  format?: OutputFormat
  dryRun?: boolean
  layer?: string
  draft?: boolean
  check?: boolean
}

const CHECK_NEEDS = '--check reads a filled PDF back: it needs a form artifact, a PDF layer, --data and --out.'

const DRAFT_HINT = 'To render the data as it is, with each of these left empty, add --draft.'

export function createRenderCommand(): Command {
  const render = new Command('render')

  render
    .argument('<artifact>', 'Artifact file (JSON/YAML) or "-" for stdin')
    .description('Render an artifact layer')
    .option('--data <pathOrJson>', 'Data payload: file path, "-" for stdin, or inline JSON (for field substitution)')
    .option('--out <file>', 'Write output to file (defaults to stdout)')
    .option('--format <style>', 'Summary format: pretty|json', 'pretty')
    .option('--layer <key>', 'Layer key to use (defaults to defaultLayer, else the first declared layer)')
    .option('--dry-run', 'Validate and resolve layer without rendering')
    .option('--draft', 'Render data that is not complete: a required field with no value prints empty, and the command lists each one')
    .option('--check', 'After a PDF render with --data and --out: read the PDF back and compare each value with the data')
    .action(async (artifactTarget: string, options: RenderOptions) => {
      try {
        const format = normalizeFormatOption(options.format ?? 'pretty')
        const resolvedTarget = await resolveArtifactTarget(artifactTarget)
        const { raw, sourcePath, baseDir } = await readTextInput(resolvedTarget, '<artifact>')
        const { artifact } = loadValidatedArtifact(raw)

        // Check if artifact has layers
        if (!('layers' in artifact) || !artifact.layers || Object.keys(artifact.layers).length === 0) {
          throw new Error('Artifact has no layers defined.')
        }

        const layers = artifact.layers as Record<string, Layer>
        const defaultLayer = 'defaultLayer' in artifact ? (artifact.defaultLayer as string | undefined) : undefined

        // Resolve which layer to use
        const layerKey = resolveLayerKey(layers, undefined, defaultLayer, { layer: options.layer })
        const layer = layers[layerKey]!

        if (options.check && !(isForm(artifact) && options.data && options.out && layer.mimeType.toLowerCase() === 'application/pdf')) {
          throw new Error(CHECK_NEEDS)
        }

        if (options.dryRun) {
          printDryRunSummary({
            artifact,
            layerKey,
            layer,
            sourcePath,
            format,
          })
          return
        }

        const resolver = createFsResolver({ root: baseDir })

        // Determine the content to output
        let content: string | Uint8Array
        let draftOpen: string[] = []
        let checked: ReadBack | undefined

        if (options.data && isForm(artifact)) {
          // Parse data from file, stdin, or inline JSON
          const parsedData = options.data ? await parseDataInput(options.data) : undefined
          const formInstance = await loadFormFile(artifact as Form, baseDir)
          let normalizedData: FilledPayload | undefined
          if (parsedData) {
            const payload = toFormPayload(parsedData.data)
            if (options.draft) {
              const draft = validateDraftPayload(formInstance, payload)
              if (!draft.success) throw new Error(formatPayloadErrors(draft.errors, draft.ruleErrors).join('\n'))
              normalizedData = draft.data
              draftOpen = draft.open
            } else {
              const validationResult = validateFormPayload(formInstance, payload)
              if (!validationResult.success) {
                const lines = formatPayloadErrors(validationResult.errors, validationResult.ruleErrors)
                const draftRenders = validateDraftPayload(formInstance, payload).success
                throw new Error([...lines, ...(draftRenders ? [DRAFT_HINT] : [])].join('\n'))
              }
              normalizedData = validationResult.data
            }
          }

          content = await formInstance.render({
            ...(layer.mimeType !== 'text/tsx' && layer.mimeType !== 'text/jsx'
              ? { renderer: createLayerRenderer() }
              : {}),
            ...(normalizedData && { data: normalizedData }),
            layer: layerKey,
          })

          if (options.check && normalizedData && typeof content !== 'string') {
            checked = readBack(await formInstance.extract(content, { layer: layerKey }), normalizedData)
          }

          // Log data source if not writing to file (when outputting to stdout)
          if (options.data && parsedData && !options.out && format === 'pretty') {
            const sourceDesc = parsedData.source === 'stdin' ? 'stdin' : parsedData.source === 'inline' ? 'inline JSON' : options.data
            console.error(kleur.gray(`Data from: ${sourceDesc}`))
          }
        } else if (options.data && !isForm(artifact)) {
          // Non-form artifact with data provided
          console.error(kleur.yellow(`Warning: --data option is only supported for form artifacts. Ignoring data.`))
          content = await renderLayer(layers, layerKey, { resolver })
        } else {
          // No data provided - output raw layer content
          content = await renderLayer(layers, layerKey, { resolver })
        }

        const outputStorage = new LocalFileSystem()

        if (options.out) {
          if (typeof content === 'string') {
            await outputStorage.writeFile(options.out, content)
          } else {
            await outputStorage.writeFile(options.out, Buffer.from(content))
          }

          if (format === 'pretty') {
            console.log(kleur.green(`✓ Layer rendered to ${options.out}`))
            console.log(`  Artifact: ${artifact.name}`)
            console.log(`  Layer: ${layerKey}`)
            console.log(`  Type: ${layer.mimeType}`)
          } else {
            console.log(JSON.stringify({
              success: true,
              output: options.out,
              artifact: artifact.name,
              layer: layerKey,
              mimeType: layer.mimeType,
              ...(options.draft && { draft: { open: draftOpen } }),
              ...(checked && { check: { passed: readBackPasses(checked), ...checked } }),
            }, null, 2))
          }
          if (checked && format === 'pretty') for (const line of readBackLines(options.out, checked)) console.log(line)
        } else {
          // Output to stdout
          if (typeof content === 'string') {
            process.stdout.write(content)
          } else {
            process.stdout.write(Buffer.from(content))
          }
        }
        if (draftOpen.length > 0 && !(options.out && format === 'json')) {
          console.error(kleur.yellow(`Draft: the data is not complete. ${draftOpen.length === 1 ? 'This is' : 'These are'} still open:`))
          for (const line of draftOpen) console.error(`  - ${line}`)
        }
        if (checked && !readBackPasses(checked)) process.exitCode = 1
      } catch (error) {
        process.exitCode = 1
        if (error instanceof RenderRefusedError) {
          if (options.format === 'json') {
            console.log(JSON.stringify({ success: false, layer: error.layer, renderProblems: error.problems }, null, 2))
          } else {
            console.error(kleur.red(`Error: the data is valid, but layer "${error.layer}" cannot render it:`))
            for (const line of formatRenderProblems(error.problems)) console.error(`  - ${line}`)
          }
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        console.error(kleur.red(`Error: ${message}`))
      }
    })

  return render
}

function normalizeFormatOption(value: string): OutputFormat {
  const normalized = value.toLowerCase() as OutputFormat
  if (normalized !== 'json' && normalized !== 'pretty') {
    throw new Error(`Unknown format "${value}". Use "pretty" or "json".`)
  }
  return normalized
}

interface DryRunSummaryInput {
  artifact: Artifact
  layerKey: string
  layer: Layer
  sourcePath?: string
  format: OutputFormat
}

function printDryRunSummary(input: DryRunSummaryInput): void {
  const summary = {
    mode: 'dry-run',
    artifact: {
      name: input.artifact.name,
      kind: input.artifact.kind,
      version: input.artifact.version,
    },
    layer: {
      key: input.layerKey,
      kind: input.layer.kind,
      mimeType: input.layer.mimeType,
    },
    source: input.sourcePath ?? 'stdin',
  }

  if (input.format === 'json') {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(kleur.cyan('Dry run summary:'))
    console.log(`  Artifact:   ${summary.artifact.name} (${summary.artifact.kind})`)
    console.log(`  Version:    ${summary.artifact.version ?? 'N/A'}`)
    console.log(`  Layer:      ${summary.layer.key}`)
    console.log(`  Layer kind: ${summary.layer.kind}`)
    console.log(`  MIME type:  ${summary.layer.mimeType}`)
    console.log(`  Source:     ${summary.source}`)
  }
}
