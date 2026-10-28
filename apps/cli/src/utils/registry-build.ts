/**
 * Registry Build Utility
 *
 * Builds a registry.json manifest and its release folders from a publisher's
 * source files. The publisher's input is registry.config.json: the registry's
 * own facts, the list of artifact source files, each artifact's search tags,
 * and, where the defaults below are not what the publisher means, the default
 * edition and version.
 *
 * Each source file is one release. Source files that share a `name` are one
 * manifest item, grouped as its editions and versions.
 */

import { z } from 'zod'
import { REGISTRY_VERSION_PATTERN, SCHEMA_BASE, compareArtifactVersions, type RegistryIndex, type RegistryItemSummary } from '@asterdoc/schemas'
import type { Artifact } from '@asterdoc/core'
import type { LocalFileSystem } from './local-fs.js'
import { fileReferencesOf, loadValidatedArtifact } from './artifact-file.js'
import { computeHashFromContent } from './hash.js'
import { checkRegistryManifest, formatIssuePath, formatRelease } from './registry-manifest.js'

/** The publisher's source file for a registry. */
export const REGISTRY_CONFIG_FILE = 'registry.config.json'

/** The manifest a registry serves. */
export const REGISTRY_MANIFEST_FILE = 'registry.json'

const REGISTRY_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

/**
 * The default release of one artifact, stated by the publisher. It has the
 * form of a manifest item: `currentEdition` and each edition's
 * `latestVersion` for an artifact that has editions, `latestVersion` alone
 * for one that has none.
 */
const RegistryDefaultSchema = z.strictObject({
  currentEdition: z.string().min(1).optional(),
  latestVersion: z.string().min(1).optional(),
  editions: z.record(z.string(), z.strictObject({ latestVersion: z.string().min(1) })).optional(),
})

export const RegistryConfigSchema = z.strictObject({
  name: z.string().min(1).max(100).regex(REGISTRY_NAME_PATTERN, 'Expected a lowercase slug (a-z, 0-9, hyphens)'),
  homepage: z.url().optional(),
  description: z.string().max(2000).optional(),
  enableTelemetry: z.boolean().optional(),
  enableDirectory: z.boolean().optional(),
  sources: z.array(z.string().min(1)),
  defaults: z.record(z.string(), RegistryDefaultSchema).optional(),
  /** Search tags by artifact name. An artifact file carries none, so the publisher states them here. */
  tags: z.record(z.string(), z.array(z.string().min(1).max(50))).optional(),
})

export type RegistryConfig = z.infer<typeof RegistryConfigSchema>
export type RegistryDefault = z.infer<typeof RegistryDefaultSchema>

/** Read and check registry.config.json; every issue is named with its path. */
export async function readRegistryConfig(storage: LocalFileSystem, configPath: string): Promise<RegistryConfig> {
  let data: unknown
  try {
    data = JSON.parse(await storage.readFile(configPath))
  } catch (error) {
    throw new Error(`Invalid JSON in ${configPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const result = RegistryConfigSchema.safeParse(data)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  • ${formatIssuePath(issue.path)}: ${issue.message}`)
    throw new Error(`The registry config at ${configPath} is not valid:\n${issues.join('\n')}`)
  }
  return result.data
}

export async function writeRegistryConfig(storage: LocalFileSystem, configPath: string, config: RegistryConfig): Promise<void> {
  await storage.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

/** The edition facts an artifact states about itself. */
export interface SourceEdition {
  key: string
  label: string
  date?: string
  effectiveFrom?: string
}

/** One source file: one release of one artifact. */
export interface SourceRelease {
  /** The path as registry.config.json lists it. */
  source: string
  /** The absolute path of the source file. */
  sourcePath: string
  artifact: Artifact
  name: string
  kind: RegistryItemSummary['kind']
  version: string
  edition: SourceEdition | null
}

/** Whether a path, relative to a folder, leaves that folder. */
export function leavesFolder(relativePath: string): boolean {
  return relativePath === '..' || relativePath.startsWith('../') || relativePath.startsWith('..\\')
}

/** `w-9 2024-03 v1.0.0`, for messages. */
export function describeSourceRelease(release: Pick<SourceRelease, 'name' | 'version' | 'edition'>): string {
  return `${release.name} ${formatRelease(release)}`
}

/**
 * Read one source file as a release. A version with build metadata is
 * refused: two versions that differ only in build metadata have the same
 * precedence, so a manifest could not say which is the later one.
 */
export async function loadSourceRelease(storage: LocalFileSystem, configDir: string, source: string): Promise<SourceRelease> {
  const sourcePath = storage.joinPath(configDir, source)
  if (leavesFolder(storage.relative(configDir, sourcePath))) {
    throw new Error(`the source file must be in the folder of ${REGISTRY_CONFIG_FILE} or below it`)
  }
  if (!(await storage.exists(sourcePath))) {
    throw new Error('artifact file not found')
  }

  const artifact = loadValidatedArtifact(await storage.readFile(sourcePath))
  const record = artifact as unknown as { name: string; version: string; edition?: SourceEdition }
  if (!REGISTRY_VERSION_PATTERN.test(record.version)) {
    throw new Error(
      `version "${record.version}" has build metadata (+...); a registry lists a release under a version with no build metadata, such as ${record.version.split('+')[0]}`,
    )
  }

  return {
    source,
    sourcePath,
    artifact,
    name: record.name,
    kind: artifact.kind,
    version: record.version,
    edition: record.edition === undefined
      ? null
      : {
          key: record.edition.key,
          label: record.edition.label,
          ...(record.edition.date !== undefined && { date: record.edition.date }),
          ...(record.edition.effectiveFrom !== undefined && { effectiveFrom: record.edition.effectiveFrom }),
        },
  }
}

/** Read every source file; one that cannot be read is an error that names it. */
export async function loadSourceReleases(
  storage: LocalFileSystem,
  configDir: string,
  sources: readonly string[],
): Promise<{ releases: SourceRelease[]; errors: string[] }> {
  const releases: SourceRelease[] = []
  const errors: string[] = []
  for (const source of sources) {
    try {
      releases.push(await loadSourceRelease(storage, configDir, source))
    } catch (error) {
      errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { releases, errors }
}

/** The versions of one edition, or of an artifact that has no editions. */
export interface PlannedGroup {
  edition: SourceEdition | null
  latestVersion: string
  releases: SourceRelease[]
}

/** One manifest item before its files are written. */
export interface PlannedItem {
  name: string
  kind: RegistryItemSummary['kind']
  /** Present only for an artifact that has editions. */
  currentEdition?: string
  groups: PlannedGroup[]
  /** The release an install gets by default; the item's title, description, tags and layers come from it. */
  defaultRelease: SourceRelease
}

const isPrerelease = (version: string) => version.includes('-')

const today = (now: Date) => now.toISOString().slice(0, 10)

/** The date an edition starts to apply: `effectiveFrom`, or else the issuer's `date`. */
const editionStart = (edition: SourceEdition) => edition.effectiveFrom ?? edition.date

/** Whether one of two dates of different precision contains the other, so they have no order. */
const sameOrContains = (a: string, b: string) => a.startsWith(b) || b.startsWith(a)

/**
 * Why a default has no value. `undecided` is true when the source files are
 * right and only the publisher's statement is missing.
 */
interface ChoiceError {
  error: string
  undecided?: true
}

/**
 * The default `latestVersion`: the override when the publisher states one,
 * else the highest version that is not a pre-release.
 */
function chooseLatestVersion(versions: string[], override: string | undefined, owner: string, fix: string): { version: string } | ChoiceError {
  if (override !== undefined) {
    return versions.includes(override)
      ? { version: override }
      : { error: `${owner}: ${fix} names version "${override}", which no source file has (${versions.join(', ')})` }
  }
  const stable = versions.filter((version) => !isPrerelease(version)).sort(compareArtifactVersions)
  const highest = stable.at(-1)
  if (highest === undefined) {
    return {
      undecided: true,
      error: `${owner}: every version is a pre-release (${versions.join(', ')}), and a pre-release is the default only when the publisher says so. Set ${fix} in ${REGISTRY_CONFIG_FILE}`,
    }
  }
  return { version: highest }
}

/**
 * The default `currentEdition`: the override when the publisher states one;
 * the only edition when there is one; else the edition that started last and
 * not after today. It is an error when the dates cannot decide.
 */
function chooseCurrentEdition(name: string, editions: SourceEdition[], override: string | undefined, now: Date): { key: string } | ChoiceError {
  const keys = editions.map((edition) => edition.key)
  const fix = `defaults["${name}"].currentEdition`
  if (override !== undefined) {
    return keys.includes(override)
      ? { key: override }
      : { error: `${name}: ${fix} names edition "${override}", which no source file has (${keys.join(', ')})` }
  }
  const only = editions.length === 1 ? editions[0] : undefined
  if (only !== undefined) return { key: only.key }

  const state = `Set ${fix} in ${REGISTRY_CONFIG_FILE}`
  const undated = editions.filter((edition) => editionStart(edition) === undefined)
  if (undated.length > 0) {
    return {
      undecided: true,
      error: `${name}: cannot choose the current edition, because edition ${undated.map((edition) => edition.key).join(', ')} has no effectiveFrom or date. ${state}`,
    }
  }

  const day = today(now)
  const started = editions
    .map((edition) => ({ key: edition.key, start: editionStart(edition) as string }))
    .filter(({ start }) => start <= day.slice(0, start.length))
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0))
  const [latest, next] = started
  if (latest === undefined) {
    return { undecided: true, error: `${name}: cannot choose the current edition, because every edition starts after today (${day}). ${state}` }
  }
  if (next !== undefined && sameOrContains(latest.start, next.start)) {
    return {
      undecided: true,
      error: `${name}: cannot choose the current edition, because editions ${latest.key} (${latest.start}) and ${next.key} (${next.start}) have dates that do not say which is later. ${state}`,
    }
  }
  return { key: latest.key }
}

/**
 * Group source releases into manifest items and choose each default.
 * Nothing is written. Every problem is one error that says how to fix it.
 * `undecided` holds the errors that only a statement in `defaults` settles;
 * the source files themselves are right.
 */
export function planRegistryItems(
  releases: readonly SourceRelease[],
  defaults: Record<string, RegistryDefault> = {},
  now: Date = new Date(),
): { items: PlannedItem[]; errors: string[]; undecided: string[] } {
  const errors: string[] = []
  const undecided: string[] = []
  const byName = new Map<string, SourceRelease[]>()
  for (const release of releases) {
    byName.set(release.name, [...(byName.get(release.name) ?? []), release])
  }

  for (const name of Object.keys(defaults)) {
    if (!byName.has(name)) errors.push(`defaults["${name}"]: no source file has the name "${name}"`)
  }

  const items: PlannedItem[] = []
  for (const [name, group] of [...byName].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const itemErrors: string[] = []
    const itemUndecided: string[] = []
    const stated = defaults[name] ?? {}
    const withEdition = group.filter((release) => release.edition !== null)
    const withoutEdition = group.filter((release) => release.edition === null)

    if (withEdition.length > 0 && withoutEdition.length > 0) {
      errors.push(
        `${name}: ${withEdition.map((release) => release.source).join(', ')} ${withEdition.length === 1 ? 'has' : 'have'} an edition and ${withoutEdition.map((release) => release.source).join(', ')} ${withoutEdition.length === 1 ? 'has' : 'have'} none. An artifact has editions in every release or in none: give every source file of "${name}" an edition, or remove the edition from all of them`,
      )
      continue
    }

    const kinds = [...new Set(group.map((release) => release.kind))]
    if (kinds.length > 1) {
      itemErrors.push(`${name}: its source files have different kinds (${group.map((release) => `${release.source}: ${release.kind}`).join(', ')}); every release of an artifact has one kind`)
    }

    const seen = new Map<string, SourceRelease>()
    for (const release of group) {
      const key = `${release.edition?.key ?? ''}@${release.version}`
      const first = seen.get(key)
      if (first) {
        itemErrors.push(`${describeSourceRelease(release)}: ${first.source} and ${release.source} are the same release; change the version of one, or remove one`)
      } else {
        seen.set(key, release)
      }
    }

    const groups: PlannedGroup[] = []
    let currentEdition: string | undefined
    if (withEdition.length === 0) {
      for (const key of ['currentEdition', 'editions'] as const) {
        if (stated[key] !== undefined) itemErrors.push(`defaults["${name}"].${key}: ${name} has no editions; state latestVersion only`)
      }
      const chosen = chooseLatestVersion(group.map((release) => release.version), stated.latestVersion, name, `defaults["${name}"].latestVersion`)
      if ('error' in chosen) (chosen.undecided ? itemUndecided : itemErrors).push(chosen.error)
      else groups.push({ edition: null, latestVersion: chosen.version, releases: group })
    } else {
      if (stated.latestVersion !== undefined) {
        itemErrors.push(`defaults["${name}"].latestVersion: ${name} has editions; state the version inside the edition, as defaults["${name}"].editions["<edition>"].latestVersion`)
      }
      const editionKeys = [...new Set(withEdition.map((release) => (release.edition as SourceEdition).key))].sort()
      for (const key of Object.keys(stated.editions ?? {})) {
        if (!editionKeys.includes(key)) {
          itemErrors.push(`defaults["${name}"].editions["${key}"]: no source file of ${name} has edition "${key}" (${editionKeys.join(', ')})`)
        }
      }
      for (const key of editionKeys) {
        const editionReleases = withEdition.filter((release) => release.edition?.key === key)
        const chosen = chooseLatestVersion(
          editionReleases.map((release) => release.version),
          stated.editions?.[key]?.latestVersion,
          `${name} ${key}`,
          `defaults["${name}"].editions["${key}"].latestVersion`,
        )
        if ('error' in chosen) {
          (chosen.undecided ? itemUndecided : itemErrors).push(chosen.error)
          continue
        }
        // The edition's facts are the ones its latest version states.
        const latest = editionReleases.find((release) => release.version === chosen.version) as SourceRelease
        groups.push({ edition: latest.edition, latestVersion: chosen.version, releases: editionReleases })
      }
      if (groups.length === editionKeys.length) {
        const chosen = chooseCurrentEdition(name, groups.map((entry) => entry.edition as SourceEdition), stated.currentEdition, now)
        if ('error' in chosen) (chosen.undecided ? itemUndecided : itemErrors).push(chosen.error)
        else currentEdition = chosen.key
      }
    }

    if (itemErrors.length > 0 || itemUndecided.length > 0) {
      errors.push(...itemErrors)
      undecided.push(...itemUndecided)
      continue
    }

    const defaultGroup = groups.find((entry) => (entry.edition?.key ?? undefined) === currentEdition) as PlannedGroup
    const defaultRelease = defaultGroup.releases.find((release) => release.version === defaultGroup.latestVersion) as SourceRelease
    items.push({
      name,
      kind: defaultRelease.kind,
      ...(currentEdition !== undefined && { currentEdition }),
      groups,
      defaultRelease,
    })
  }

  return { items, errors, undecided }
}

/** The release path a manifest lists: `<name>/<edition>/<version>/<name>.json`, without the edition when there is none. */
export function releasePath(release: Pick<SourceRelease, 'name' | 'version' | 'edition'>): string {
  const folder = release.edition === null
    ? `${release.name}/${release.version}`
    : `${release.name}/${release.edition.key}/${release.version}`
  return `${folder}/${release.name}.json`
}

/** A file a build writes. */
export interface BuildFile {
  /** Path relative to the output folder, with forward slashes. */
  path: string
  content: string | Buffer
}

export interface RegistryBuild {
  manifest: RegistryIndex
  /** Every file to write, the manifest last. */
  files: BuildFile[]
  /** The releases compiled, in manifest order. */
  compiled: SourceRelease[]
}

function setPropertyAtPath(target: Record<string, unknown>, propertyPath: string[], value: unknown): void {
  let cursor: Record<string, unknown> = target
  for (const segment of propertyPath.slice(0, -1)) {
    const next = cursor[segment]
    if (next === null || typeof next !== 'object') return
    cursor = next as Record<string, unknown>
  }
  const property = propertyPath.at(-1)
  if (property) cursor[property] = value
}

/**
 * Build one release: the artifact as JSON with the checksum of each file it
 * references, and those files beside it in the release folder.
 */
async function buildRelease(storage: LocalFileSystem, outputDir: string, release: SourceRelease): Promise<{ files: BuildFile[]; path: string; sha256: string }> {
  const path = releasePath(release)
  const folder = path.slice(0, path.lastIndexOf('/'))
  const releaseDir = storage.joinPath(outputDir, folder)
  const sourceDir = storage.dirname(release.sourcePath)

  if (storage.joinPath(outputDir, path) === release.sourcePath) {
    throw new Error(`output would overwrite source artifact: ${release.sourcePath}`)
  }

  const artifact = structuredClone(release.artifact) as unknown as Record<string, unknown>
  const files: BuildFile[] = []
  for (const reference of fileReferencesOf(release.artifact)) {
    const source = storage.joinPath(sourceDir, reference.path)
    if (!(await storage.exists(source))) {
      throw new Error(`referenced file not found: ${reference.path}`)
    }
    const destination = storage.joinPath(releaseDir, reference.path)
    if (leavesFolder(storage.relative(releaseDir, destination))) {
      throw new Error(`referenced file escapes the release folder: ${reference.path}`)
    }
    if (destination === source) {
      throw new Error(`output would overwrite source file: ${source}`)
    }

    const content = await storage.readFile(source, 'binary')
    // Bundle path items point at other artifacts and have no checksum
    // property. Every other walker result is a checksummed file ref.
    if (reference.checksum !== undefined || reference.propertyPath[0] !== 'contents') {
      setPropertyAtPath(artifact, [...reference.propertyPath, 'checksum'], `sha256:${computeHashFromContent(content)}`)
    }
    files.push({ path: storage.relative(outputDir, destination).split('\\').join('/'), content })
  }

  // The checksum is of the bytes written, so the file is built here, once.
  const content = Buffer.from(JSON.stringify(artifact, null, 2), 'utf-8')
  files.push({ path, content })
  return { files, path, sha256: computeHashFromContent(content) }
}

/**
 * Build a registry in memory: every release file and the manifest. Nothing
 * is written, so a build with an error leaves the output folder as it was.
 * @throws Error listing every problem, one line each
 */
export async function buildRegistry(
  storage: LocalFileSystem,
  options: { configDir: string; outputDir: string; config: RegistryConfig; now?: Date },
): Promise<RegistryBuild> {
  const { configDir, outputDir, config } = options
  const loaded = await loadSourceReleases(storage, configDir, config.sources)
  const plan = planRegistryItems(loaded.releases, config.defaults, options.now)
  const errors = [...loaded.errors, ...plan.errors, ...plan.undecided]
  for (const name of Object.keys(config.tags ?? {})) {
    if (!loaded.releases.some((release) => release.name === name)) {
      errors.push(`tags["${name}"]: no source file has the name "${name}"`)
    }
  }

  const files: BuildFile[] = []
  const compiled: SourceRelease[] = []
  const items: RegistryItemSummary[] = []

  for (const item of plan.items) {
    const built = new Map<SourceRelease, { path: string; sha256: string }>()
    for (const release of item.groups.flatMap((group) => group.releases)) {
      try {
        const result = await buildRelease(storage, outputDir, release)
        files.push(...result.files)
        built.set(release, { path: result.path, sha256: result.sha256 })
        compiled.push(release)
      } catch (error) {
        errors.push(`${release.source}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const versionsOf = (group: PlannedGroup) =>
      Object.fromEntries(group.releases.flatMap((release) => {
        const entry = built.get(release)
        return entry === undefined ? [] : [[release.version, entry]]
      }))

    const facts = item.defaultRelease.artifact as unknown as { title?: string; description?: string; layers?: Record<string, unknown> }
    const tags = config.tags?.[item.name]
    const common = {
      name: item.name,
      kind: item.kind,
      ...(facts.title !== undefined && { title: facts.title }),
      ...(facts.description !== undefined && { description: facts.description }),
    }
    const extra = {
      ...(facts.layers !== undefined && { layers: Object.keys(facts.layers) }),
      ...(tags !== undefined && { tags }),
    }

    const first = item.groups[0] as PlannedGroup
    if (item.currentEdition === undefined) {
      items.push({ ...common, latestVersion: first.latestVersion, versions: versionsOf(first), ...extra })
    } else {
      items.push({
        ...common,
        currentEdition: item.currentEdition,
        editions: Object.fromEntries(item.groups.map((group) => {
          const { key, ...editionFacts } = group.edition as SourceEdition
          return [key, { ...editionFacts, latestVersion: group.latestVersion, versions: versionsOf(group) }]
        })),
        ...extra,
      })
    }
  }

  const { sources: _sources, defaults: _defaults, tags: _tags, ...registryFacts } = config
  const manifest = { $schema: `${SCHEMA_BASE}/${REGISTRY_MANIFEST_FILE}`, ...registryFacts, items }

  if (errors.length === 0) {
    const checked = checkRegistryManifest(manifest)
    if (!checked.ok) errors.push(...checked.issues.map((issue) => `${REGISTRY_MANIFEST_FILE}: ${issue}`))
  }
  if (errors.length > 0) {
    throw new RegistryBuildError(errors)
  }

  files.push({ path: REGISTRY_MANIFEST_FILE, content: `${JSON.stringify(manifest, null, 2)}\n` })
  return { manifest: manifest as RegistryIndex, files, compiled }
}

/** A build that cannot produce a manifest, with one line for each problem. */
export class RegistryBuildError extends Error {
  constructor(public errors: string[]) {
    super(errors.join('\n'))
    this.name = 'RegistryBuildError'
  }
}
