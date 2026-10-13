import { Command } from 'commander'
import kleur from 'kleur'
import ora from 'ora'
import prompts from 'prompts'

import type { RegistryEntry, ViewOptions } from '../types.js'
import { assertConfigurableNamespace, configManager, isReservedNamespace, normalizeNamespace, type ConfiguredRegistry } from '../utils/config.js'
import { lockFileManager } from '../utils/lock.js'
import { registryClient, RegistryFetchError } from '../utils/registry-client.js'
import { parseArtifactRef, resolveRegistry } from '../utils/registry.js'
import { findRepoRoot } from '../utils/project.js'
import { PROJECT_REQUIRED_MESSAGE } from '../utils/user-copy.js'
import { trackRegistryAdd } from '../utils/telemetry.js'
import { loadValidatedArtifact } from '../utils/artifact-file.js'
import { collectHeader } from '../utils/cli-helpers.js'
import { checkRegistryManifest, countReleases, formatInstalledRelease } from '../utils/registry-manifest.js'
import {
  REGISTRY_CONFIG_FILE,
  REGISTRY_MANIFEST_FILE,
  RegistryBuildError,
  buildRegistry,
  describeSourceRelease,
  leavesFolder,
  loadSourceRelease,
  loadSourceReleases,
  planRegistryItems,
  readRegistryConfig,
  writeRegistryConfig,
  type RegistryConfig,
} from '../utils/registry-build.js'

type ConfigTarget = 'global' | 'project'

const REGISTRY_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

/**
 * Convert a string to a valid registry slug
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Prompt user to choose between global and project config
 */
async function promptConfigTarget(action: string): Promise<ConfigTarget> {
  const { target } = await prompts({
    type: 'select',
    name: 'target',
    message: `Where would you like to ${action} this registry?`,
    choices: [
      { title: 'Project config (paradoc.json)', value: 'project' },
      { title: 'Global config (~/.paradoc/config.json)', value: 'global' },
    ],
    initial: 0,
  })
  if (target === undefined) throw new Error('User cancelled')
  return target as ConfigTarget
}

/**
 * Create the 'registry' command group
 * Manages registry configurations
 */
export function createRegistryCommand(): Command {
  const registry = new Command('registry')
  registry.description('Manage registry configurations')

  // registry add
  registry
    .command('add')
    .argument('<first>', 'Registry namespace (e.g., @acme) or URL')
    .argument('[second]', 'Registry base URL (required when first arg is a namespace)')
    .option('--header <header>', 'Add HTTP header (format: "Name: Value")', collectHeader, {})
    .option('--global', 'Save to global config (~/.paradoc/config.json)')
    .option('--project', 'Save to project config (paradoc.json)')
    .option('-y, --yes', 'Skip confirmation prompts (overwrites on conflict)')
    .description('Add or update a registry')
    .action(async (first: string, second: string | undefined, options: { header: Record<string, string>; global?: boolean; project?: boolean; yes?: boolean }) => {
      try {
        let namespace: string
        let url: string

        if (second) {
          // Two args: first = namespace, second = url
          namespace = normalizeNamespace(first)
          url = second
        } else {
          // One arg: must be a URL — fetch registry.json to get the name
          let parsedUrl: URL
          try {
            parsedUrl = new URL(first)
          } catch {
            console.error(kleur.red(`When using a single argument, it must be a valid URL.`))
            console.error(kleur.gray('Usage: paradoc registry add <url>'))
            console.error(kleur.gray('   or: paradoc registry add <namespace> <url>'))
            process.exit(1)
          }

          url = parsedUrl.origin + parsedUrl.pathname.replace(/\/$/, '')

          const spinner = ora(`Fetching registry from ${url}...`).start()
          let index
          try {
            const resolved: import('../types.js').ResolvedRegistry = {
              namespace: '',
              baseUrl: url,
              headers: Object.keys(options.header).length > 0 ? options.header : undefined,
            }
            index = await registryClient.fetchIndex(resolved, { skipCache: true })
          } catch (error) {
            spinner.fail('Failed to fetch registry')
            if (error instanceof RegistryFetchError) {
              console.error(kleur.red(`${error.statusCode}: ${error.message}`))
            } else {
              console.error(kleur.red(error instanceof Error ? error.message : String(error)))
            }
            process.exit(1)
          }
          spinner.succeed(`Found registry: ${kleur.bold(index.name)}`)

          const suggested = `@${index.name}`
          if (!options.yes) {
            const { confirmed } = await prompts({
              type: 'text',
              name: 'confirmed',
              message: 'Namespace:',
              initial: suggested,
              validate: (v: string) => {
                if (isReservedNamespace(v)) return `${normalizeNamespace(v)} is reserved; choose another namespace`
                return normalizeNamespace(v).length >= 2 || 'Namespace is required'
              },
            })
            if (!confirmed) {
              console.log(kleur.yellow('Cancelled.'))
              process.exit(1)
            }
            namespace = normalizeNamespace(confirmed)
          } else {
            namespace = suggested
          }
        }

        assertConfigurableNamespace(namespace)

        // Validate URL
        try {
          new URL(url)
        } catch {
          console.error(kleur.red(`Invalid URL: ${url}`))
          process.exit(1)
        }

        // Check if we're in a project
        const projectRoot = await findRepoRoot()
        if (projectRoot) {
          await configManager.loadProjectManifest(projectRoot)
        }

        // Check for namespace conflict
        const existing = await configManager.getRegistry(namespace)
        if (existing) {
          const existingUrl = typeof existing === 'string' ? existing : existing.url
          if (!options.yes) {
            const { action } = await prompts({
              type: 'select',
              name: 'action',
              message: `Namespace ${kleur.bold(namespace)} already exists (${existingUrl}). What would you like to do?`,
              choices: [
                { title: 'Overwrite with new URL', value: 'overwrite' },
                { title: 'Use a different name', value: 'rename' },
                { title: 'Cancel', value: 'cancel' },
              ],
              initial: 0,
            })
            if (action === 'cancel' || action === undefined) {
              console.log(kleur.yellow('Cancelled.'))
              process.exit(1)
            }
            if (action === 'rename') {
              const { newName } = await prompts({
                type: 'text',
                name: 'newName',
                message: 'Enter a new namespace:',
                initial: `${namespace}-2`,
                validate: (v: string) => isReservedNamespace(v) ? `${normalizeNamespace(v)} is reserved; choose another namespace` : normalizeNamespace(v).length >= 2 || 'Namespace is required',
              })
              if (!newName) {
                console.log(kleur.yellow('Cancelled.'))
                process.exit(1)
              }
              namespace = normalizeNamespace(newName)
            }
            // action === 'overwrite' falls through
          }
          // --yes mode: silently overwrite (matches previous behavior)
        }

        // Build registry entry
        let entry: RegistryEntry
        if (Object.keys(options.header).length > 0) {
          entry = {
            url,
            headers: options.header,
          }
        } else {
          entry = url
        }

        // Determine target config
        let target: ConfigTarget

        if (options.global && options.project) {
          console.error(kleur.red('Cannot specify both --global and --project'))
          process.exit(1)
        }

        if (options.global) {
          target = 'global'
        } else if (options.project) {
          if (!projectRoot) {
            console.error(kleur.red(`${PROJECT_REQUIRED_MESSAGE} Cannot use --project flag.`))
            console.error(kleur.gray('Use --global to save to global config, or run from a project directory.'))
            process.exit(1)
          }
          target = 'project'
        } else if (options.yes) {
          target = projectRoot ? 'project' : 'global'
        } else {
          // Interactive prompt
          if (projectRoot) {
            target = await promptConfigTarget('save')
          } else {
            // Not in a project, default to global
            console.log(kleur.gray('Not in a project, saving to global config.'))
            target = 'global'
          }
        }

        // Save to the chosen config
        if (target === 'project') {
          await configManager.setProjectRegistry(namespace, entry)
          console.log(kleur.green('✓') + ` Added registry ${kleur.bold(namespace)} to ${kleur.blue('project config')}`)
        } else {
          await configManager.setGlobalRegistry(namespace, entry)
          console.log(kleur.green('✓') + ` Added registry ${kleur.bold(namespace)} to ${kleur.gray('global config')}`)
        }

        console.log(kleur.gray('URL:'), url)
        if (Object.keys(options.header).length > 0) {
          console.log(kleur.gray('Headers:'), Object.keys(options.header).join(', '))
        }

        // Track registry add for telemetry (fire and forget)
        trackRegistryAdd(url, { hasHeaders: Object.keys(options.header).length > 0 })
      } catch (error) {
        console.error(kleur.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
      }
    })

  // registry remove
  registry
    .command('remove')
    .alias('rm')
    .argument('[namespace]', 'Registry namespace to remove (interactive selection if omitted)')
    .option('--global', 'Remove from global config (~/.paradoc/config.json)')
    .option('--project', 'Remove from project config (paradoc.json)')
    .description('Remove a registry')
    .action(async (namespace: string | undefined, options: { global?: boolean; project?: boolean }) => {
      try {
        if (options.global && options.project) {
          console.error(kleur.red('Cannot specify both --global and --project'))
          process.exit(1)
        }

        // Check if we're in a project
        const projectRoot = await findRepoRoot()
        if (projectRoot) {
          await configManager.loadProjectManifest(projectRoot)
        }

        // If namespace provided, use direct removal (original behavior)
        if (namespace) {
          const normalizedNamespace = normalizeNamespace(namespace)

          let target: ConfigTarget

          if (options.global) {
            target = 'global'
          } else if (options.project) {
            if (!projectRoot) {
              console.error(kleur.red(`${PROJECT_REQUIRED_MESSAGE} Cannot use --project flag.`))
              process.exit(1)
            }
            target = 'project'
          } else {
            if (projectRoot) {
              target = await promptConfigTarget('remove')
            } else {
              target = 'global'
            }
          }

          let removed: boolean
          if (target === 'project') {
            removed = await configManager.removeProjectRegistry(normalizedNamespace)
            if (removed) {
              console.log(kleur.green('✓') + ` Removed registry ${kleur.bold(normalizedNamespace)} from ${kleur.blue('project config')}`)
            } else {
              console.log(kleur.yellow(`Registry not found in project config: ${normalizedNamespace}`))
            }
          } else {
            removed = await configManager.removeGlobalRegistry(normalizedNamespace)
            if (removed) {
              console.log(kleur.green('✓') + ` Removed registry ${kleur.bold(normalizedNamespace)} from ${kleur.dim('global config')}`)
            } else {
              console.log(kleur.yellow(`Registry not found in global config: ${normalizedNamespace}`))
            }
          }
          return
        }

        // Interactive mode: list the registries of the chosen scope, or all in effect when none is chosen
        let scope: ConfiguredRegistry['source'] | undefined
        if (options.global) {
          scope = 'global'
        } else if (options.project) {
          if (!projectRoot) {
            console.error(kleur.red(`${PROJECT_REQUIRED_MESSAGE} Cannot use --project flag.`))
            process.exit(1)
          }
          scope = 'project'
        }
        const registries = await configManager.listRegistries(scope)

        if (registries.length === 0) {
          console.log(kleur.yellow(scope ? `No registries in ${scope} config.` : 'No registries configured.'))
          return
        }

        const { selected } = await prompts({
          type: 'multiselect',
          name: 'selected',
          message: 'Select registries to remove',
          choices: registries.map((reg) => ({
            title: `${reg.namespace} ${reg.source === 'project' ? kleur.blue('[project]') : kleur.dim('[global]')}`,
            description: reg.url,
            value: reg,
          })),
          instructions: false,
          hint: 'Space to select, Enter to confirm',
        })

        if (!selected || selected.length === 0) {
          console.log(kleur.yellow('No registries selected.'))
          return
        }

        for (const reg of selected as ConfiguredRegistry[]) {
          let removed: boolean
          if (reg.source === 'project') {
            removed = await configManager.removeProjectRegistry(reg.namespace)
            if (removed) {
              console.log(kleur.green('✓') + ` Removed ${kleur.bold(reg.namespace)} from ${kleur.blue('project config')}`)
            }
          } else {
            removed = await configManager.removeGlobalRegistry(reg.namespace)
            if (removed) {
              console.log(kleur.green('✓') + ` Removed ${kleur.bold(reg.namespace)} from ${kleur.dim('global config')}`)
            }
          }
        }
      } catch (error) {
        console.error(kleur.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
      }
    })

  // registry list
  registry
    .command('list')
    .alias('ls')
    .option('--json', 'Output as JSON')
    .description('List configured registries')
    .action(async (options: { json?: boolean }) => {
      try {
        // Load project config if in a project
        const projectRoot = await findRepoRoot()
        if (projectRoot) {
          await configManager.loadProjectManifest(projectRoot)
        }

        const registries = await configManager.listRegistries()

        if (options.json) {
          console.log(JSON.stringify(registries, null, 2))
        } else {
          if (registries.length === 0) {
            console.log(kleur.gray('No registries configured.'))
            console.log(kleur.gray("Run 'paradoc registry add @namespace https://...' to add one."))
            return
          }

          console.log()
          console.log(kleur.bold(`Configured registries (${registries.length}):`))
          console.log()

          for (const reg of registries) {
            const source = reg.source === 'project' ? kleur.blue('[project]') : kleur.gray('[global]')
            console.log(`${kleur.cyan(reg.namespace)} ${source}`)
            console.log(`  ${reg.url}`)
          }
          console.log()
        }
      } catch (error) {
        console.error(kleur.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
      }
    })

  // registry make
  registry
    .command('make')
    .argument('[directory]', 'Directory to create registry in', '.')
    .option('-n, --name <name>', 'Registry name')
    .option('--description <description>', 'Registry description')
    .option('--homepage <url>', 'Registry homepage URL')
    .option('--no-registry-telemetry', 'Disable usage telemetry for this registry')
    .option('--no-directory', 'Do not list this registry in the Paradoc Hub')
    .option('-y, --yes', 'Skip confirmation prompts')
    .description(`Create a new ${REGISTRY_CONFIG_FILE}: the source file that registry compile builds a registry from`)
    .action(async (directory: string, options: {
      name?: string
      description?: string
      homepage?: string
      registryTelemetry?: boolean
      directory?: boolean
      yes?: boolean
    }) => {
      try {
        const { LocalFileSystem } = await import('../utils/local-fs.js')
        const storage = new LocalFileSystem()
        const targetDir = storage.getAbsolutePath(directory)

        // Check if the config already exists
        const registryPath = storage.joinPath(targetDir, REGISTRY_CONFIG_FILE)
        if (await storage.exists(registryPath)) {
          if (!options.yes) {
            const { overwrite } = await prompts({
              type: 'confirm',
              name: 'overwrite',
              message: `${REGISTRY_CONFIG_FILE} already exists. Overwrite?`,
              initial: false,
            })
            if (!overwrite) {
              console.log(kleur.yellow('Cancelled.'))
              process.exit(0)
            }
          } else {
            console.log(kleur.yellow(`${REGISTRY_CONFIG_FILE} already exists, overwriting...`))
          }
        }

        // Get registry name
        let registryName = options.name
        if (!registryName && !options.yes) {
          const initial = slugify(storage.basename(targetDir)) || ''
          const { name } = await prompts({
            type: 'text',
            name: 'name',
            message: 'Registry name (lowercase, a-z, 0-9, hyphens):',
            initial,
            validate: (v: string) => REGISTRY_NAME_PATTERN.test(v) || 'Must be a lowercase slug (a-z, 0-9, hyphens, no leading/trailing hyphens)',
          })
          if (!name) {
            console.log(kleur.yellow('Cancelled.'))
            process.exit(0)
          }
          registryName = name
        }
        if (!registryName) {
          registryName = storage.basename(targetDir)
        }

        // Validate slug pattern (for --name flag or --yes fallback)
        if (!REGISTRY_NAME_PATTERN.test(registryName)) {
          const suggested = slugify(registryName)
          if (!suggested) {
            console.error(kleur.red(`Invalid registry name: "${registryName}". Must be a lowercase slug (a-z, 0-9, hyphens).`))
            process.exit(1)
          }
          if (options.yes) {
            console.log(kleur.yellow(`Auto-corrected registry name: "${registryName}" → "${suggested}"`))
            registryName = suggested
          } else {
            // Interactive mode but came from --name flag
            const { useSuggested } = await prompts({
              type: 'confirm',
              name: 'useSuggested',
              message: `"${registryName}" is not a valid slug. Use "${suggested}" instead?`,
              initial: true,
            })
            if (!useSuggested) {
              const { custom } = await prompts({
                type: 'text',
                name: 'custom',
                message: 'Registry name (lowercase, a-z, 0-9, hyphens):',
                validate: (v: string) => REGISTRY_NAME_PATTERN.test(v) || 'Must be a lowercase slug (a-z, 0-9, hyphens, no leading/trailing hyphens)',
              })
              if (!custom) {
                console.log(kleur.yellow('Cancelled.'))
                process.exit(0)
              }
              registryName = custom
            } else {
              registryName = suggested
            }
          }
        }

        // Get description
        let description = options.description
        if (!description && !options.yes) {
          const { desc } = await prompts({
            type: 'text',
            name: 'desc',
            message: 'Description (optional, press Enter to skip):',
          })
          description = desc || undefined
        }

        // Get homepage
        let homepage = options.homepage
        if (!homepage && !options.yes) {
          const { hp } = await prompts({
            type: 'text',
            name: 'hp',
            message: 'Homepage URL (optional, press Enter to skip):',
            validate: (v: string) => {
              if (!v) return true
              try { new URL(v); return true } catch { return 'Must be a valid URL' }
            },
          })
          homepage = hp || undefined
        }

        // Build the config. The telemetry and directory flags are always
        // written, so the publisher sees what the registry states.
        const registry: RegistryConfig = {
          name: registryName as string,
          ...(homepage && { homepage }),
          ...(description && { description }),
          enableTelemetry: options.registryTelemetry !== false,
          enableDirectory: options.directory !== false,
          sources: [],
        }

        await writeRegistryConfig(storage, registryPath, registry)

        console.log(kleur.green('✓') + ` Created ${kleur.cyan(REGISTRY_CONFIG_FILE)}`)
        console.log()
        console.log(kleur.gray('Name:'), registryName)
        if (homepage) {
          console.log(kleur.gray('Homepage:'), homepage)
        }
        if (description) {
          console.log(kleur.gray('Description:'), description)
        }
        console.log()
        console.log(kleur.gray('Next steps:'))
        console.log(kleur.gray('  1. Add artifacts with: paradoc registry catalog add <artifact>'))
        console.log(kleur.gray('  2. Compile registry with: paradoc registry compile'))
      } catch (error) {
        console.error(kleur.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
      }
    })

  // registry info
  registry
    .command('info')
    .argument('<namespace>', 'Registry namespace')
    .option('--json', 'Output as JSON')
    .description('Show registry information')
    .action(async (namespace: string, options: { json?: boolean }) => {
      const spinner = ora()

      try {
        const normalizedNamespace = normalizeNamespace(namespace)

        // Load project config if in a project
        const projectRoot = await findRepoRoot()
        if (projectRoot) {
          await configManager.loadProjectManifest(projectRoot)
        }

        // Resolve registry
        spinner.start(`Fetching registry info for ${normalizedNamespace}...`)
        const resolved = await resolveRegistry(normalizedNamespace)
        const cache = await configManager.getEffectiveCacheSettings(normalizedNamespace)
        await registryClient.initCache({ directory: cache.directory })

        // Fetch registry index
        let index
        try {
          index = await registryClient.fetchIndex(resolved, { cacheTtl: cache.ttl })
        } catch (error) {
          spinner.fail(`Failed to fetch registry index`)
          if (error instanceof RegistryFetchError) {
            console.error(kleur.red(`${error.statusCode}: ${error.message}`))
          } else {
            console.error(kleur.red(error instanceof Error ? error.message : String(error)))
          }
          process.exit(1)
        }
        spinner.stop()

        if (options.json) {
          console.log(JSON.stringify({
            namespace: normalizedNamespace,
            url: resolved.baseUrl,
            name: index.name,
            description: index.description,
            homepage: index.homepage,
            artifactCount: index.items.length,
            editionCount: countReleases(index.items).editions,
            releaseCount: countReleases(index.items).releases,
          }, null, 2))
        } else {
          console.log()
          console.log(kleur.bold(index.name || normalizedNamespace))
          console.log()

          if (index.description) {
            console.log(index.description)
            console.log()
          }

          console.log(kleur.gray('URL:'), resolved.baseUrl)
          if (index.homepage) {
            console.log(kleur.gray('Homepage:'), index.homepage)
          }
          console.log(kleur.gray('Artifacts:'), index.items.length)
          const counts = countReleases(index.items)
          console.log(kleur.gray('Editions:'), counts.editions)
          console.log(kleur.gray('Releases:'), counts.releases)
          console.log()

          // Show artifact kinds breakdown
          const kindCounts = new Map<string, number>()
          for (const item of index.items) {
            const count = kindCounts.get(item.kind) || 0
            kindCounts.set(item.kind, count + 1)
          }
          if (kindCounts.size > 0) {
            console.log(kleur.gray('By kind:'))
            for (const [kind, count] of kindCounts) {
              console.log(`  ${kind}: ${count}`)
            }
          }
        }
      } catch (error) {
        spinner.fail('Failed')
        console.error(kleur.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
      }
    })

  // registry catalog - subcommand group for managing catalog items
  const catalog = registry.command('catalog')
  catalog.description('Manage registry catalog items')

  // registry catalog add
  catalog
    .command('add')
    .argument('<artifact>', 'Path to artifact file (JSON/YAML): one release of one artifact')
    .option('-c, --config <path>', `Path to ${REGISTRY_CONFIG_FILE}`, `./${REGISTRY_CONFIG_FILE}`)
    .description('Add an artifact source file to the registry catalog. Files with the same name are the editions and versions of one artifact.')
    .action(async (artifactPath: string, options: { config: string }) => {
      try {
        const { LocalFileSystem } = await import('../utils/local-fs.js')
        const storage = new LocalFileSystem()

        const configPath = storage.getAbsolutePath(options.config)
        if (!(await storage.exists(configPath))) {
          console.error(kleur.red(`Registry config not found: ${configPath}`))
          console.error(kleur.gray('Run "paradoc registry make" to create one.'))
          process.exit(1)
        }
        const config = await readRegistryConfig(storage, configPath)
        const configDir = storage.dirname(configPath)

        const fullArtifactPath = storage.getAbsolutePath(artifactPath)
        if (!(await storage.exists(fullArtifactPath))) {
          console.error(kleur.red(`Artifact not found: ${fullArtifactPath}`))
          process.exit(1)
        }

        // Security: the artifact must be in the config's folder or below it
        const source = storage.relative(configDir, fullArtifactPath).split('\\').join('/')
        if (leavesFolder(source)) {
          console.error(kleur.red(`Security error: Artifact must be at the same level or below ${REGISTRY_CONFIG_FILE}`))
          console.error(kleur.gray(`Config: ${configPath}`))
          console.error(kleur.gray(`Artifact: ${fullArtifactPath}`))
          process.exit(1)
        }

        let release
        try {
          release = await loadSourceRelease(storage, configDir, source)
        } catch (error) {
          console.error(kleur.red(`Cannot add ${source}: ${error instanceof Error ? error.message : String(error)}`))
          process.exit(1)
        }

        if (config.sources.includes(source)) {
          console.log(kleur.yellow(`${source} is already in the catalog (${describeSourceRelease(release)}).`))
          return
        }

        // The new file must fit with the files already listed: no second
        // file for the same release, and editions in every release or none.
        // A default that only the publisher can state is a matter for compile.
        const others = await loadSourceReleases(storage, configDir, config.sources)
        const conflicts = planRegistryItems(
          [...others.releases.filter((other) => other.name === release.name), release],
          config.defaults?.[release.name] ? { [release.name]: config.defaults[release.name]! } : {},
        ).errors
        if (conflicts.length > 0) {
          console.error(kleur.red(`Cannot add ${source}:`))
          for (const conflict of conflicts) console.error(kleur.red(`  • ${conflict}`))
          process.exit(1)
        }

        const sources = [...config.sources, source].sort((a, b) => a.localeCompare(b))
        await writeRegistryConfig(storage, configPath, { ...config, sources })

        console.log(kleur.green('✓') + ` Added ${kleur.cyan(describeSourceRelease(release))} (${release.kind})`)
        console.log(kleur.gray(`Catalog now has ${sources.length} source file(s)`))
      } catch (error) {
        console.error(kleur.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
      }
    })

  // registry catalog remove
  catalog
    .command('remove')
    .alias('rm')
    .argument('<target>', 'Artifact name (removes every edition and version of it) or the path of one source file')
    .option('-c, --config <path>', `Path to ${REGISTRY_CONFIG_FILE}`, `./${REGISTRY_CONFIG_FILE}`)
    .option('-y, --yes', 'Skip confirmation prompts')
    .description('Remove an artifact, or one source file of it, from the registry catalog')
    .action(async (target: string, options: { config: string; yes?: boolean }) => {
      try {
        const { LocalFileSystem } = await import('../utils/local-fs.js')
        const storage = new LocalFileSystem()

        const configPath = storage.getAbsolutePath(options.config)
        if (!(await storage.exists(configPath))) {
          console.error(kleur.red(`Registry config not found: ${configPath}`))
          process.exit(1)
        }
        const config = await readRegistryConfig(storage, configPath)
        const configDir = storage.dirname(configPath)
        const loaded = await loadSourceReleases(storage, configDir, config.sources)

        // A listed source path names one file; anything else is an artifact name.
        const asPath = storage.relative(configDir, storage.getAbsolutePath(target)).split('\\').join('/')
        const listedPath = [target, asPath].find((candidate) => config.sources.includes(candidate))
        const removed = listedPath !== undefined
          ? [listedPath]
          : loaded.releases.filter((release) => release.name === target).map((release) => release.source)

        if (removed.length === 0) {
          console.error(kleur.red(`Artifact not found: ${target}`))
          console.error(kleur.gray('Available artifacts:'))
          for (const release of loaded.releases) {
            console.error(kleur.gray(`  - ${describeSourceRelease(release)} (${release.source})`))
          }
          process.exit(1)
        }

        if (!options.yes) {
          const { confirm } = await prompts({
            type: 'confirm',
            name: 'confirm',
            message: `Remove ${removed.join(', ')} from the catalog?`,
            initial: false,
          })
          if (!confirm) {
            console.log(kleur.yellow('Cancelled.'))
            process.exit(0)
          }
        }

        const sources = config.sources.filter((source) => !removed.includes(source))

        // A default or tags for an artifact with no source file left would stop the next compile.
        const namesLeft = new Set(loaded.releases.filter((release) => sources.includes(release.source)).map((release) => release.name))
        const namesRemoved = loaded.releases.filter((release) => removed.includes(release.source)).map((release) => release.name)
        const keep = <T,>(byName: Record<string, T> | undefined): Record<string, T> => Object.fromEntries(
          Object.entries(byName ?? {}).filter(([name]) => !namesRemoved.includes(name) || namesLeft.has(name)),
        )
        const defaults = keep(config.defaults)
        const tags = keep(config.tags)
        const { defaults: _defaults, tags: _tags, ...rest } = config
        await writeRegistryConfig(storage, configPath, {
          ...rest,
          sources,
          ...(Object.keys(defaults).length > 0 && { defaults }),
          ...(Object.keys(tags).length > 0 && { tags }),
        })

        console.log(kleur.green('✓') + ` Removed ${kleur.cyan(removed.join(', '))} from the catalog`)
        console.log(kleur.gray(`Catalog now has ${sources.length} source file(s)`))
      } catch (error) {
        console.error(kleur.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
      }
    })

  // registry stats
  registry
    .command('stats')
    .option('-r, --registry <path>', `Path to a compiled ${REGISTRY_MANIFEST_FILE}`, `./${REGISTRY_MANIFEST_FILE}`)
    .option('--json', 'Output as JSON')
    .description(`Check a local ${REGISTRY_MANIFEST_FILE} against the manifest schema and show its statistics`)
    .allowExcessArguments(false)
    .action(async (options: { registry: string; json?: boolean }) => {
      try {
        const { LocalFileSystem } = await import('../utils/local-fs.js')
        const storage = new LocalFileSystem()

        const registryPath = storage.getAbsolutePath(options.registry)
        if (!(await storage.exists(registryPath))) {
          console.error(kleur.red(`Registry not found: ${registryPath}`))
          process.exit(1)
        }

        let data: unknown
        try {
          data = JSON.parse(await storage.readFile(registryPath))
        } catch (error) {
          console.error(kleur.red(`Invalid JSON in ${registryPath}: ${error instanceof Error ? error.message : String(error)}`))
          process.exit(1)
        }

        const checked = checkRegistryManifest(data)
        if (!checked.ok) {
          console.error(kleur.red(`${registryPath} is not a valid registry manifest:`))
          for (const issue of checked.issues) {
            console.error(kleur.red(`  • ${issue}`))
          }
          process.exit(1)
        }
        const registryData = checked.manifest

        const kindCounts = new Map<string, number>()
        for (const item of registryData.items) {
          const count = kindCounts.get(item.kind) || 0
          kindCounts.set(item.kind, count + 1)
        }
        const counts = countReleases(registryData.items)

        if (options.json) {
          console.log(JSON.stringify({
            name: registryData.name,
            totalArtifacts: registryData.items.length,
            totalEditions: counts.editions,
            totalReleases: counts.releases,
            byKind: Object.fromEntries(kindCounts),
            telemetryEnabled: registryData.enableTelemetry !== false,
            directoryEnabled: registryData.enableDirectory !== false,
          }, null, 2))
        } else {
          console.log()
          console.log(kleur.bold(registryData.name))
          console.log()
          console.log(kleur.gray('Total artifacts:'), registryData.items.length)
          console.log(kleur.gray('Total editions:'), counts.editions)
          console.log(kleur.gray('Total releases:'), counts.releases)
          console.log()

          if (kindCounts.size > 0) {
            console.log(kleur.gray('By kind:'))
            for (const [kind, count] of kindCounts) {
              console.log(`  ${kind}: ${count}`)
            }
            console.log()
          }

          console.log(kleur.gray('Telemetry:'), registryData.enableTelemetry !== false ? 'enabled' : 'disabled')
          console.log(kleur.gray('Directory listing:'), registryData.enableDirectory !== false ? 'enabled' : 'disabled')
        }
      } catch (error) {
        console.error(kleur.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
      }
    })

  // registry compile
  registry
    .command('compile')
    .option('-c, --config <path>', `Path to ${REGISTRY_CONFIG_FILE}`, `./${REGISTRY_CONFIG_FILE}`)
    .option('-o, --output <path>', `Output directory for ${REGISTRY_MANIFEST_FILE} and the release folders (default: the folder of the config)`)
    .option('--dry-run', 'Show what would be compiled without writing files')
    .description(
      `Compile a registry: validate each source file, compute checksums, and write ${REGISTRY_MANIFEST_FILE} with every release at <name>/<edition>/<version>/ (or <name>/<version>/ for an artifact with no editions)`,
    )
    .action(async (options: { config: string; output?: string; dryRun?: boolean }) => {
      const spinner = ora()

      try {
        const { LocalFileSystem } = await import('../utils/local-fs.js')
        const storage = new LocalFileSystem()

        const configPath = storage.getAbsolutePath(options.config)
        if (!(await storage.exists(configPath))) {
          console.error(kleur.red(`Registry config not found: ${configPath}`))
          console.error(kleur.gray('Run "paradoc registry make" to create one.'))
          process.exit(1)
        }

        const configDir = storage.dirname(configPath)
        const config = await readRegistryConfig(storage, configPath)
        const outputDir = options.output ? storage.getAbsolutePath(options.output) : configDir

        console.log(kleur.bold(`Compiling registry: ${config.name}`))
        console.log(kleur.gray(`Output: ${outputDir}`))
        console.log()

        // The whole registry is built in memory first: a build with an error writes nothing.
        let build
        try {
          build = await buildRegistry(storage, { configDir, outputDir, config })
        } catch (error) {
          if (!(error instanceof RegistryBuildError)) throw error
          for (const message of error.errors) {
            spinner.fail(message)
          }
          console.log()
          console.log(kleur.yellow(`Nothing was written (${error.errors.length} error(s))`))
          process.exitCode = 1
          return
        }

        if (!options.dryRun) {
          for (const file of build.files) {
            const destination = storage.joinPath(outputDir, file.path)
            await storage.mkdir(storage.dirname(destination), true)
            await storage.writeFile(destination, file.content)
          }
        }

        for (const release of build.compiled) {
          spinner.succeed(`${describeSourceRelease(release)}: ${options.dryRun ? 'would compile' : 'compiled'}`)
        }

        // Say which release each artifact installs by default: it is the publisher's statement.
        for (const item of build.manifest.items) {
          const latest = item.editions === undefined ? item.latestVersion : item.editions[item.currentEdition]?.latestVersion
          const edition = item.editions === undefined ? undefined : item.currentEdition
          console.log(kleur.gray(`  ${item.name} default: ${formatInstalledRelease({ edition, version: latest ?? '' })}`))
        }

        console.log()
        console.log(kleur.green(`Compiled ${build.compiled.length} release(s) of ${build.manifest.items.length} artifact(s) successfully`))

        if (options.dryRun) {
          console.log(kleur.gray('(dry run - no files written)'))
        }
      } catch (error) {
        spinner.fail('Compilation failed')
        console.error(kleur.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
      }
    })

  // registry view
  registry
    .command('view')
    .argument('<artifact>', 'Artifact reference (@namespace/name)')
    .option('--json', 'Output as JSON')
    .description('View details of an installed artifact, with its installed edition and version')
    .action(async (artifact: string, options: ViewOptions) => {
      try {
        const { LocalFileSystem } = await import('../utils/local-fs.js')

        // Parse artifact reference
        const artifactRef = parseArtifactRef(artifact)
        if (!artifactRef) {
          console.error(kleur.red(`Invalid artifact reference: ${artifact}`))
          console.error(kleur.gray('Expected format: @namespace/artifact-name'))
          process.exit(1)
        }

        // Find project root
        const projectRoot = await findRepoRoot()
        if (!projectRoot) {
          console.error(kleur.red(PROJECT_REQUIRED_MESSAGE))
          process.exit(1)
        }

        // Load project config and lock file
        await configManager.loadProjectManifest(projectRoot)
        await lockFileManager.init(projectRoot)

        // Check if installed
        if (!lockFileManager.isInstalled(artifactRef.full)) {
          console.error(kleur.red(`Artifact not installed: ${artifact}`))
          console.error(kleur.gray("Run 'paradoc add " + artifact + "' to install it."))
          process.exit(1)
        }

        // Get lock file info
        const lockedInfo = lockFileManager.getArtifact(artifactRef.full)
        if (!lockedInfo) {
          console.error(kleur.red(`Could not read lock info for: ${artifact}`))
          process.exit(1)
        }

        // Read the artifact file
        const storage = new LocalFileSystem(projectRoot)
        const artifactPath = storage.joinPath(lockedInfo.path)
        let artifactContent: Record<string, unknown>
        try {
          const content = await storage.readFile(artifactPath, 'utf-8')
          artifactContent = loadValidatedArtifact(content) as unknown as Record<string, unknown>
        } catch {
          console.error(kleur.red(`Could not read artifact file: ${lockedInfo.path}`))
          process.exit(1)
        }

        // Output format
        if (options.json) {
          const output = {
            ref: artifactRef.full,
            installed: lockedInfo,
            artifact: artifactContent,
          }
          console.log(JSON.stringify(output, null, 2))
        } else {
          // Human-readable output
          console.log()
          console.log(kleur.bold(artifact))
          console.log()

          // Basic info
          if (lockedInfo.edition !== undefined) {
            console.log(kleur.gray('Edition:'), lockedInfo.edition)
          }
          console.log(kleur.gray('Version:'), lockedInfo.version)
          console.log(kleur.gray('Kind:'), artifactContent.kind || 'unknown')
          if (artifactContent.title) {
            console.log(kleur.gray('Title:'), artifactContent.title)
          }
          if (artifactContent.description) {
            console.log(kleur.gray('Description:'), artifactContent.description)
          }
          console.log()

          // Installation info
          console.log(kleur.gray('Installed:'), new Date(lockedInfo.installedAt).toLocaleString())
          console.log(kleur.gray('Output:'), lockedInfo.output)
          console.log(kleur.gray('Path:'), lockedInfo.path)
          console.log(kleur.gray('Source:'), lockedInfo.resolved)
          console.log()

          // Layers
          const layerEntries = Object.entries(lockedInfo.layers)
          if (layerEntries.length > 0) {
            console.log(kleur.gray('Layers:'))
            for (const [layerKey, layer] of layerEntries) {
              console.log(`  ${kleur.cyan(layerKey)}: ${layer.path}`)
            }
            console.log()
          }

          // Show artifact structure summary
          const artifactLayers = artifactContent.layers as Record<string, unknown> | undefined
          if (artifactLayers) {
            const availableLayerKeys = Object.keys(artifactLayers)
            const installedLayerKeys = Object.keys(lockedInfo.layers)
            const notInstalled = availableLayerKeys.filter((k) => !installedLayerKeys.includes(k))
            if (notInstalled.length > 0) {
              console.log(kleur.gray('Available layers (not installed):'), notInstalled.join(', '))
            }
          }
        }
      } catch (error) {
        console.error(kleur.red(error instanceof Error ? error.message : String(error)))
        process.exit(1)
      }
    })

  return registry
}
