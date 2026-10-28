/**
 * Registry Manifest Utility
 *
 * Checks a registry.json manifest against the published schema and formats
 * its releases for display. Release resolution and ordering come from
 * `@asterdoc/schemas`, so every reader agrees on them.
 */

import {
  RegistryIndexSchema,
  listRegistryReleases,
  type RegistryIndex,
  type RegistryItemSummary,
  type RegistryRelease,
} from '@asterdoc/schemas'

/** Where an issue is in a manifest, such as `items[0].editions.2024-03.latestVersion`. */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'root'
  return path
    .map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`))
    .join('')
    .replace(/^\./, '')
}

/** A manifest that breaks the registry.json schema, with one line for each issue. */
export class RegistryManifestError extends Error {
  constructor(
    public source: string,
    public issues: string[],
  ) {
    super(`The registry manifest at ${source} is not valid:\n${issues.map((issue) => `  • ${issue}`).join('\n')}`)
    this.name = 'RegistryManifestError'
  }
}

/**
 * Check a parsed registry.json against the schema.
 * @returns the manifest, or one `path: message` line for each issue
 */
export function checkRegistryManifest(data: unknown): { ok: true; manifest: RegistryIndex } | { ok: false; issues: string[] } {
  const result = RegistryIndexSchema.safeParse(data)
  if (result.success) return { ok: true, manifest: result.data }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`),
  }
}

/**
 * Check a parsed registry.json against the schema.
 * @param source - Where the manifest came from (a URL or a file path), for the error
 * @throws RegistryManifestError naming each issue with its path
 */
export function parseRegistryManifest(data: unknown, source: string): RegistryIndex {
  const result = checkRegistryManifest(data)
  if (!result.ok) throw new RegistryManifestError(source, result.issues)
  return result.manifest
}

/** A release for a person to read: `v1.1.0`, or `2024-03 v1.1.0` with an edition. */
export function formatRelease(release: Pick<RegistryRelease, 'version'> & { edition: { key: string } | null }): string {
  return release.edition === null ? `v${release.version}` : `${release.edition.key} v${release.version}`
}

/** A locked or installed release: `v1.1.0`, or `2024-03 v1.1.0` with an edition. */
export function formatInstalledRelease(installed: { edition?: string; version: string }): string {
  return formatRelease({ version: installed.version, edition: installed.edition === undefined ? null : { key: installed.edition } })
}

/**
 * The editions and versions of an item, one line for each edition: the
 * current edition first and marked, and in each the latest version first and
 * marked. An artifact that has no editions gives one `Versions:` line.
 */
export function formatReleaseLines(item: RegistryItemSummary): string[] {
  const groups = listRegistryReleases(item)
  const versionsOf = (group: (typeof groups)[number]) =>
    group.versions.map((entry) => (entry.isLatest ? `${entry.version} (latest)` : entry.version)).join(', ')

  const lines: string[] = []
  const withEditions = groups.filter((group) => group.edition !== null)
  if (withEditions.length > 0) lines.push('Editions:')
  for (const group of groups) {
    if (group.edition === null) {
      lines.push(`Versions: ${versionsOf(group)}`)
      continue
    }
    const current = group.isCurrent ? ' (current)' : ''
    lines.push(`  ${group.edition.key}${current}  ${group.edition.label}: ${versionsOf(group)}`)
  }
  return lines
}

/** Count the editions and releases a manifest lists. */
export function countReleases(items: readonly RegistryItemSummary[]): { editions: number; releases: number } {
  let editions = 0
  let releases = 0
  for (const item of items) {
    for (const group of listRegistryReleases(item)) {
      if (group.edition !== null) editions += 1
      releases += group.versions.length
    }
  }
  return { editions, releases }
}
