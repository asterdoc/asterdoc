/**
 * The test registry is served to every registry workflow test, so the
 * committed registry in test-registry/r must be exactly what `registry
 * compile` writes from the source files, its manifest must be valid, and each
 * release must be the file the manifest lists.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { validate } from '@asterdoc/core'
import { RegistryIndexSchema, listRegistryReleases } from '@asterdoc/schemas'
import { runCli } from '../setup/spawn-cli.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-registry')
const servedDir = path.join(root, 'r')
const readJson = (file: string): Record<string, unknown> => JSON.parse(fs.readFileSync(file, 'utf-8'))

/** Every file under a folder, as sorted paths relative to it. */
function filesUnder(dir: string, prefix = ''): string[] {
  return fs.readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name)
    return entry.isDirectory() ? filesUnder(dir, relative) : [relative]
  }).sort()
}

const manifest = RegistryIndexSchema.parse(readJson(path.join(servedDir, 'registry.json')))
const releases = manifest.items.flatMap((item) =>
  listRegistryReleases(item).flatMap((group) =>
    group.versions.map((entry) => ({ name: item.name, kind: item.kind, edition: group.edition?.key, ...entry })),
  ),
)

describe('test registry', () => {
  it('matches fresh registry compile output', async () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'asterdoc-test-registry-'))
    try {
      const result = await runCli(['registry', 'compile', '--config', path.join(root, 'registry.config.json'), '--output', output], { cwd: root })
      expect(result.exitCode).toBe(0)
      const committed = filesUnder(servedDir)
      expect(filesUnder(output)).toEqual(committed)
      for (const file of committed) {
        expect(fs.readFileSync(path.join(output, file)), file).toEqual(fs.readFileSync(path.join(servedDir, file)))
      }
    } finally {
      fs.rmSync(output, { recursive: true, force: true })
    }
  })

  it.each(releases)('serves $path as a valid artifact that is the release the manifest lists', (release) => {
    const bytes = fs.readFileSync(path.join(servedDir, release.path))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(release.sha256)

    const artifact = JSON.parse(bytes.toString()) as { name: string; kind: string; version: string; edition?: { key: string } }
    expect(validate(artifact).issues ?? []).toEqual([])
    expect({ name: artifact.name, kind: artifact.kind, version: artifact.version, edition: artifact.edition?.key })
      .toEqual({ name: release.name, kind: release.kind, version: release.version, edition: release.edition })
  })

  it('refuses an artifact whose shape does not match its kind', () => {
    const checklist = readJson(path.join(servedDir, 'property-inspection/1.0.0/property-inspection.json'))
    const result = validate({ ...checklist, items: { exterior: { title: 'Exterior' } }, fields: {} })
    expect(result.issues?.length).toBeGreaterThan(0)
  })

  it('lists an artifact with editions and one with several versions, so the workflow tests cover both', () => {
    expect(releases.map((release) => `${release.name}/${release.edition ?? '-'}@${release.version}`).sort()).toEqual([
      'commercial-lease/-@1.0.0',
      'lease-addendum/-@1.0.0',
      'pet-policy/-@1.0.0',
      'pet-policy/-@1.1.0',
      'pet-policy/-@2.0.0-beta.1',
      'property-inspection/-@1.0.0',
      'residential-lease/-@1.0.0',
      'w4/2024@1.0.0',
      'w4/2024@1.1.0',
      'w4/2025@1.0.0',
      'w9/-@1.0.0',
    ])
  })
})
