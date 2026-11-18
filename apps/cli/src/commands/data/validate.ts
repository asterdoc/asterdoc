import { Command } from 'commander'
import kleur from 'kleur'
import { isForm, type Form } from '@asterdoc/core'

import { readTextInput, resolveArtifactTarget } from '../../utils/io.js'
import { parseDataInput, toFormPayload } from '../../utils/data-input.js'
import { formatRenderProblems, printPayloadErrors, validateFormPayload } from '../../utils/validate-data.js'
import { loadFormFile } from '../../utils/load-form.js'
import { loadValidatedArtifact } from '../../utils/artifact-file.js'

interface ValidateDataOptions {
  json?: boolean
  silent?: boolean
  renderCheck?: string
}

/**
 * Create the 'validate' command for validating instance data against a form
 */
export function createValidateCommand(): Command {
  const validate = new Command('validate')

  validate
    .argument('<form-file>', 'Form artifact file (JSON/YAML)')
    .argument('<data>', 'Instance data: file path, "-" for stdin, or inline JSON')
    .description('Validate instance data against a form artifact')
    .option('--json', 'Output machine-readable JSON result')
    .option('--silent', 'Suppress console output (exit code only)')
    .option('--render-check <layer>', 'Also check that valid data renders on this layer: a PDF layer refuses a value too wide for its field, longer than a comb, or with a character its font cannot draw. The report is the one a render gives')
    .action(async (formTarget: string, dataTarget: string, options: ValidateDataOptions) => {
      try {
        // Form file is required (no stdin for form)
        if (!formTarget || formTarget === '-') {
          throw new Error('Form file path required. Use stdin only for data input.')
        }

        // Read form file
        const resolvedFormTarget = await resolveArtifactTarget(formTarget)
        const { raw: formRaw, baseDir } = await readTextInput(resolvedFormTarget)
        const { artifact } = loadValidatedArtifact(formRaw)

        // Check artifact kind is 'form'
        if (!isForm(artifact)) {
          const kind = artifact.kind
          if (!options.silent) {
            console.error(kleur.red(`Error: Expected form artifact, but received kind "${kind}".`))
          }
          process.exitCode = 1
          return
        }

        const form = artifact as Form

        // Parse data from file, stdin, or inline JSON
        const { data: rawData, source: dataSource } = await parseDataInput(dataTarget)

        const instance = await loadFormFile(form, baseDir)
        const payload = toFormPayload(rawData)
        const result = validateFormPayload(instance, payload)
        const renderProblems = result.success && options.renderCheck !== undefined
          ? instance.fill(payload as never).renderProblems(options.renderCheck)
          : []
        const success = result.success && renderProblems.length === 0

        // Build data source description for output
        const dataSourceDesc = dataSource === 'stdin' ? 'stdin' : dataSource === 'inline' ? 'inline JSON' : dataTarget

        // Output result
        if (options.json) {
          const output = {
            success,
            form: formTarget,
            dataSource: dataSourceDesc,
            ...(result.success
              ? { data: result.data, values: result.values, ...(options.renderCheck !== undefined && { layer: options.renderCheck, renderProblems }) }
              : { errors: result.errors, ...(result.ruleErrors.length > 0 && { ruleErrors: result.ruleErrors }) }),
          }
          console.log(JSON.stringify(output, null, 2))
        } else if (!options.silent) {
          if (success) {
            console.log(kleur.green(options.renderCheck === undefined ? '✓ Instance data is valid' : `✓ Instance data is valid and renders on layer "${options.renderCheck}"`))
            console.log(`  Form: ${formTarget}`)
            console.log(`  Data: ${dataSourceDesc}`)
          } else if (result.success) {
            console.error(kleur.red(`The data is valid, but layer "${options.renderCheck}" cannot render it:`))
            for (const line of formatRenderProblems(renderProblems)) console.error(`  - ${line}`)
          } else {
            console.error(kleur.red('Validation failed:'))
            printPayloadErrors(result.errors, result.ruleErrors)
          }
        }

        process.exitCode = success ? 0 : 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!options.silent) {
          console.error(kleur.red(`Error: ${message}`))
        }
        process.exitCode = 1
      }
    })

  return validate
}
