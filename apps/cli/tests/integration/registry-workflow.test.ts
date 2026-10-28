import { runCli as spawnCli } from '../setup/spawn-cli'
/**
 * Integration tests for registry workflow
 *
 * The test-registry server is auto-started via vitest globalSetup
 * (tests/setup/test-registry-server.ts).
 */

import { describe, it, expect, inject } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const testRegistryRoot = path.resolve(__dirname, '../../test-registry')

const TEST_REGISTRY_URL = inject('testRegistryUrl')
/**
 * Execute a CLI command in a given directory
 */

async function runCli(args: string[], cwd: string, timeout = 30000) {
  return spawnCli(args, {
    cwd,
    timeout,
    env: { XDG_CONFIG_HOME: path.join(cwd, '.config'), HOME: cwd },
  })
}

/**
 * Create a project in the temp directory with the test registry configured
 */
async function setupProject(
  tempDir: string,
  projectName: string = 'test-project'
): Promise<void> {
  // Initialize project
  await runCli(['init', '--yes', '--name', projectName], tempDir)

  // Add registry configuration to asterdoc.json
  const manifestPath = path.join(tempDir, 'asterdoc.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
  manifest.registries = {
    '@acme': {
      url: TEST_REGISTRY_URL,
    },
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
}

/**
 * Wrapper that creates a temp directory, runs the test, then cleans up.
 */
function createIntegrationTest(
  name: string,
  testFn: (tempDir: string) => Promise<void>,
  timeout: number = 60000
) {
  it(
    name,
    async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asterdoc-integration-test-'))
      try {
        await testFn(tempDir)
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    },
    timeout
  )
}

describe('Registry Integration Tests', () => {
  describe('Search workflow', () => {
    createIntegrationTest('searches artifacts in the registry', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['search', 'lease', '--registry', '@acme'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('residential-lease')
    })

    createIntegrationTest('finds W9 artifact by searching for tax', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['search', 'tax', '--registry', '@acme'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('w9')
    })

    createIntegrationTest('filters search by kind', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['search', '--kind', 'checklist', '--registry', '@acme'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('property-inspection')
      expect(result.stdout).not.toContain('residential-lease')
    })

    createIntegrationTest('outputs search results as JSON', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['search', '--json', '--registry', '@acme'], tempDir)
      expect(result.exitCode).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBeGreaterThan(0)
    })

    createIntegrationTest('shows the editions and versions of each artifact, with the current edition and latest version marked', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['search', '--registry', '@acme'], tempDir)
      expect(result.exitCode).toBe(0)
      // The default release is beside the reference: the publisher's current edition, not the newest
      expect(result.stdout).toContain('@acme/w4 2024 v1.1.0')
      expect(result.stdout).toContain('Editions:')
      expect(result.stdout).toContain('2024 (current)  2024: 1.1.0 (latest), 1.0.0')
      expect(result.stdout).toContain('2025  2025: 1.0.0 (latest)')
      expect(result.stdout.indexOf('2024 (current)')).toBeLessThan(result.stdout.indexOf('2025  2025'))
      // An artifact with no editions: the latest version first, then by precedence
      expect(result.stdout).toContain('@acme/pet-policy v1.1.0')
      expect(result.stdout).toContain('Versions: 1.1.0 (latest), 2.0.0-beta.1, 1.0.0')
    })

    createIntegrationTest('carries every edition and version in --json', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['search', '--json', '--registry', '@acme'], tempDir)
      const data = JSON.parse(result.stdout) as Array<Record<string, unknown>>
      const w4 = data.find((item) => item.name === 'w4') as { currentEdition: string; editions: Record<string, { latestVersion: string; versions: Record<string, { path: string; sha256: string }> }> }
      expect(w4.currentEdition).toBe('2024')
      expect(Object.keys(w4.editions).sort()).toEqual(['2024', '2025'])
      expect(w4.editions['2024']!.latestVersion).toBe('1.1.0')
      expect(w4.editions['2024']!.versions['1.0.0']!.path).toBe('w4/2024/1.0.0/w4.json')
      expect(w4).not.toHaveProperty('version')
      const petPolicy = data.find((item) => item.name === 'pet-policy') as { latestVersion: string; versions: Record<string, unknown> }
      expect(petPolicy.latestVersion).toBe('1.1.0')
      expect(Object.keys(petPolicy.versions).sort()).toEqual(['1.0.0', '1.1.0', '2.0.0-beta.1'])
    })

    createIntegrationTest('counts editions and releases in registry info', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['registry', 'info', '@acme', '--json'], tempDir)
      expect(JSON.parse(result.stdout)).toMatchObject({ artifactCount: 7, editionCount: 2, releaseCount: 11 })
    })
  })

  describe('Add artifact workflow', () => {
    createIntegrationTest('adds W9 artifact from the registry', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['add', '@acme/w9'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Added @acme/w9')

      // Verify W9 file was created (default format is json)
      const artifactPath = path.join(tempDir, 'artifacts', '@acme', 'w9.json')
      const exists = await fs
        .access(artifactPath)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)

      // Verify W9 content has expected fields
      const content = await fs.readFile(artifactPath, 'utf-8')
      expect(content).toContain('name')
      expect(content).toContain('taxClassification')
      expect(content).toContain('ssn')
      expect(content).toContain('ein')
    })

    createIntegrationTest('adds an artifact from the registry', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['add', '@acme/residential-lease'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Added @acme/residential-lease')

      // Verify artifact file was created (default format is json)
      const artifactPath = path.join(tempDir, 'artifacts', '@acme', 'residential-lease.json')
      const exists = await fs
        .access(artifactPath)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)
    })

    createIntegrationTest('adds artifact with specific format', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['add', '@acme/residential-lease', '--output', 'json'], tempDir)
      expect(result.exitCode).toBe(0)

      // Verify JSON file was created
      const artifactPath = path.join(tempDir, 'artifacts', '@acme', 'residential-lease.json')
      const exists = await fs
        .access(artifactPath)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)
    })

    createIntegrationTest('adds artifact with --layers flag', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['add', '@acme/residential-lease', '--layers', 'all'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Added')
      expect(await fs.readFile(path.join(tempDir, 'artifacts', '@acme', 'residential-lease-legal.md'), 'utf8'))
        .toBe(await fs.readFile(path.join(testRegistryRoot, 'r', 'residential-lease', '1.0.0', 'residential-lease-legal.md'), 'utf8'))
    })

    createIntegrationTest('creates lock file entry', async (tempDir) => {
      await setupProject(tempDir)
      await runCli(['add', '@acme/residential-lease'], tempDir)

      const lockPath = path.join(tempDir, '.asterdoc', 'lock.json')
      const lockExists = await fs
        .access(lockPath)
        .then(() => true)
        .catch(() => false)
      expect(lockExists).toBe(true)

      const lock = JSON.parse(await fs.readFile(lockPath, 'utf-8'))
      expect(lock.artifacts['@acme/residential-lease']).toBeDefined()
      expect(lock.artifacts['@acme/residential-lease'].version).toBe('1.0.0')
    })

    createIntegrationTest('can re-add (update) an existing artifact', async (tempDir) => {
      await setupProject(tempDir)

      // First add
      await runCli(['add', '@acme/residential-lease'], tempDir)

      // Second add (should overwrite)
      const result = await runCli(['add', '@acme/residential-lease'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Added @acme/residential-lease')
    })
  })

  describe('List installed artifacts', () => {
    createIntegrationTest('lists installed artifacts', async (tempDir) => {
      await setupProject(tempDir)
      await runCli(['add', '@acme/residential-lease'], tempDir)

      const result = await runCli(['list'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('residential-lease')
    })

    createIntegrationTest('shows empty list when no artifacts installed', async (tempDir) => {
      await setupProject(tempDir)
      const result = await runCli(['list'], tempDir)
      // Should succeed but show no artifacts
      expect(result.exitCode).toBe(0)
    })
  })

  describe('Show artifact details', () => {
    createIntegrationTest('shows installed artifact details', async (tempDir) => {
      await setupProject(tempDir)
      await runCli(['add', '@acme/residential-lease'], tempDir)

      const result = await runCli(['show', 'artifacts/@acme/residential-lease.json'], tempDir)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('residential-lease')
    })
  })

  describe('Project configuration', () => {
    createIntegrationTest('uses project-level registry configuration', async (tempDir) => {
      await setupProject(tempDir)

      // The registry was configured in setupProject, verify it works
      const result = await runCli(['search', '--registry', '@acme'], tempDir)
      expect(result.exitCode).toBe(0)
      // Should find items from the @acme registry
      expect(result.stdout).toContain('acme')
    })

    createIntegrationTest('respects custom artifacts directory', async (tempDir) => {
      await setupProject(tempDir)

      // Modify manifest to use custom directory
      const manifestPath = path.join(tempDir, 'asterdoc.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
      manifest.artifacts = { dir: 'custom-artifacts' }
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))

      await runCli(['add', '@acme/residential-lease'], tempDir)

      // Verify artifact was placed in custom directory
      const artifactPath = path.join(tempDir, 'custom-artifacts', '@acme', 'residential-lease.json')
      const exists = await fs
        .access(artifactPath)
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(true)
    })
  })
})
