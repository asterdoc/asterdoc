import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// We need to mock modules before importing the module under test
const mockVersion = vi.hoisted(() => ({ value: '0.1.3' }))

// A getter keeps VERSION live: the factory result is cached across resetModules
vi.mock('../../src/constants.js', () => ({
	get VERSION() {
		return mockVersion.value
	},
}))

// Point the notifier's cache at a per-test temp home instead of the real one
const mockHome = vi.hoisted(() => ({ value: '' }))

vi.mock('node:os', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:os')>()
	return { ...actual, homedir: () => mockHome.value || actual.homedir() }
})

describe('update-notifier', () => {
	let tempDir: string
	let cacheFile: string
	let originalEnv: NodeJS.ProcessEnv
	let originalIsTTY: boolean | undefined
	let originalStderrIsTTY: boolean | undefined

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(join(tmpdir(), 'asterdoc-update-test-'))
		cacheFile = join(tempDir, '.asterdoc', 'update-check.json')
		mockHome.value = tempDir
		originalEnv = { ...process.env }
		originalIsTTY = process.stdout.isTTY
		originalStderrIsTTY = process.stderr.isTTY

		// Reset mocks
		vi.restoreAllMocks()

		// Default: pretend we're in a TTY, not CI
		Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
		Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true })
		delete process.env.CI
		delete process.env.ASTERDOC_NO_UPDATE_CHECK
		delete process.env.ASTERDOC_CLI_PACKAGE
		mockVersion.value = '0.1.3'
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
		process.env = originalEnv
		Object.defineProperty(process.stdout, 'isTTY', {
			value: originalIsTTY,
			configurable: true,
		})
		Object.defineProperty(process.stderr, 'isTTY', {
			value: originalStderrIsTTY,
			configurable: true,
		})
		vi.resetModules()
	})

	describe('checkForUpdate', () => {
		it('skips check when VERSION is dev', async () => {
			mockVersion.value = 'dev'
			vi.resetModules()

			const fetchSpy = vi.spyOn(globalThis, 'fetch')
			const { checkForUpdate } = await import('../../src/utils/update-notifier.js')

			checkForUpdate()
			// Give the async void a tick
			await new Promise((r) => setTimeout(r, 50))

			expect(fetchSpy).not.toHaveBeenCalled()
		})

		it('skips check when CI env var is set', async () => {
			process.env.CI = 'true'
			vi.resetModules()

			const fetchSpy = vi.spyOn(globalThis, 'fetch')
			const { checkForUpdate } = await import('../../src/utils/update-notifier.js')

			checkForUpdate()
			await new Promise((r) => setTimeout(r, 50))

			expect(fetchSpy).not.toHaveBeenCalled()
		})

		it('skips check when ASTERDOC_NO_UPDATE_CHECK is set', async () => {
			process.env.ASTERDOC_NO_UPDATE_CHECK = '1'
			vi.resetModules()

			const fetchSpy = vi.spyOn(globalThis, 'fetch')
			const { checkForUpdate } = await import('../../src/utils/update-notifier.js')

			checkForUpdate()
			await new Promise((r) => setTimeout(r, 50))

			expect(fetchSpy).not.toHaveBeenCalled()
		})

		it('skips check when stdout is not a TTY', async () => {
			Object.defineProperty(process.stdout, 'isTTY', {
				value: false,
				configurable: true,
			})
			vi.resetModules()

			const fetchSpy = vi.spyOn(globalThis, 'fetch')
			const { checkForUpdate } = await import('../../src/utils/update-notifier.js')

			checkForUpdate()
			await new Promise((r) => setTimeout(r, 50))

			expect(fetchSpy).not.toHaveBeenCalled()
		})

		it('skips check when stderr is not a TTY', async () => {
			Object.defineProperty(process.stderr, 'isTTY', {
				value: false,
				configurable: true,
			})
			vi.resetModules()

			const fetchSpy = vi.spyOn(globalThis, 'fetch')
			const { checkForUpdate } = await import('../../src/utils/update-notifier.js')

			checkForUpdate()
			await new Promise((r) => setTimeout(r, 50))

			expect(fetchSpy).not.toHaveBeenCalled()
		})

		it.each([
			['@asterdoc/cli when run directly', undefined, '@asterdoc/cli'],
			['asterdoc when run through the shim', 'asterdoc', 'asterdoc'],
			['@asterdoc/cli for an unknown package marker', 'asterdoc-cli', '@asterdoc/cli'],
		])('checks %s', async (_label, marker, expectedPackage) => {
			if (marker) process.env.ASTERDOC_CLI_PACKAGE = marker
			vi.resetModules()

			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify({ version: '0.2.0' }), { status: 200 }))
			const { checkForUpdate } = await import('../../src/utils/update-notifier.js')

			checkForUpdate()
			await vi.waitFor(async () => {
				const written = JSON.parse(await fs.readFile(cacheFile, 'utf-8')) as { latestVersion: string }
				expect(written.latestVersion).toBe('0.2.0')
			})

			expect(fetchSpy).toHaveBeenCalledWith(
				`https://registry.npmjs.org/${expectedPackage}/latest`,
				expect.anything(),
			)
		})

		it('records a failed check so it is not retried on every command', async () => {
			vi.resetModules()
			vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
			const { checkForUpdate } = await import('../../src/utils/update-notifier.js')

			checkForUpdate()
			await vi.waitFor(async () => {
				const written = JSON.parse(await fs.readFile(cacheFile, 'utf-8')) as { lastChecked: number }
				expect(written.lastChecked).toBeGreaterThan(0)
			})
		})
	})

	describe('printUpdateNotice', () => {
		const writeNewerVersionCache = async (): Promise<void> => {
			await fs.mkdir(join(tempDir, '.asterdoc'), { recursive: true })
			await fs.writeFile(cacheFile, JSON.stringify({ lastChecked: Date.now(), latestVersion: '0.2.0' }))
		}

		const printAndCapture = async (): Promise<{ stderr: string; stdout: string }> => {
			vi.resetModules()
			const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
			const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
			const { printUpdateNotice } = await import('../../src/utils/update-notifier.js')

			printUpdateNotice()

			const captured = {
				stderr: stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join(''),
				stdout: [
					...stdoutSpy.mock.calls.map(([chunk]) => String(chunk)),
					...logSpy.mock.calls.flat().map(String),
				].join(''),
			}
			stderrSpy.mockRestore()
			stdoutSpy.mockRestore()
			logSpy.mockRestore()
			return captured
		}

		it('prints the notice on stderr and nothing on stdout', async () => {
			await writeNewerVersionCache()

			const output = await printAndCapture()

			expect(output.stderr).toContain('Update available: 0.1.3 \u2192 0.2.0')
			expect(output.stderr).toContain('npm i -g @asterdoc/cli')
			expect(output.stdout).toBe('')
		})

		it('tells a shim user to update the shim package', async () => {
			process.env.ASTERDOC_CLI_PACKAGE = 'asterdoc'
			await writeNewerVersionCache()

			const output = await printAndCapture()

			expect(output.stderr).toContain('npm i -g asterdoc')
			expect(output.stderr).not.toContain('@asterdoc/cli')
		})

		it('prints nothing when stderr is not a terminal', async () => {
			Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true })
			await writeNewerVersionCache()

			expect(await printAndCapture()).toEqual({ stderr: '', stdout: '' })
		})

		it('prints nothing when stdout is not a terminal', async () => {
			Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
			await writeNewerVersionCache()

			expect(await printAndCapture()).toEqual({ stderr: '', stdout: '' })
		})

		it('prints nothing when VERSION is dev', async () => {
			mockVersion.value = 'dev'
			await writeNewerVersionCache()

			expect(await printAndCapture()).toEqual({ stderr: '', stdout: '' })
		})

		it('prints nothing when the CI env var is set', async () => {
			process.env.CI = 'true'
			await writeNewerVersionCache()

			expect(await printAndCapture()).toEqual({ stderr: '', stdout: '' })
		})

		it('prints nothing when ASTERDOC_NO_UPDATE_CHECK is set', async () => {
			process.env.ASTERDOC_NO_UPDATE_CHECK = '1'
			await writeNewerVersionCache()

			expect(await printAndCapture()).toEqual({ stderr: '', stdout: '' })
		})

		it('ignores the retired OFM_NO_UPDATE_CHECK name', async () => {
			process.env.OFM_NO_UPDATE_CHECK = '1'
			await writeNewerVersionCache()

			expect((await printAndCapture()).stderr).toContain('0.2.0')
		})

		it('prints nothing when the cached version is not newer', async () => {
			await fs.mkdir(join(tempDir, '.asterdoc'), { recursive: true })
			await fs.writeFile(cacheFile, JSON.stringify({ lastChecked: Date.now(), latestVersion: '0.1.3' }))

			expect(await printAndCapture()).toEqual({ stderr: '', stdout: '' })
		})

		it('prints nothing when the cache file is missing', async () => {
			expect(await printAndCapture()).toEqual({ stderr: '', stdout: '' })
		})

		it('prints nothing when the cache file is malformed', async () => {
			await fs.mkdir(join(tempDir, '.asterdoc'), { recursive: true })
			await fs.writeFile(cacheFile, '{not json')

			expect(await printAndCapture()).toEqual({ stderr: '', stdout: '' })
		})
	})

	describe('version comparison logic', () => {
		it('detects newer major version', async () => {
			const semver = await import('semver')
			expect(semver.default.gt('1.0.0', '0.1.3')).toBe(true)
		})

		it('detects newer minor version', async () => {
			const semver = await import('semver')
			expect(semver.default.gt('0.2.0', '0.1.3')).toBe(true)
		})

		it('detects newer patch version', async () => {
			const semver = await import('semver')
			expect(semver.default.gt('0.1.4', '0.1.3')).toBe(true)
		})

		it('handles prerelease versions', async () => {
			const semver = await import('semver')
			// Prerelease is less than release
			expect(semver.default.gt('0.2.0-beta.1', '0.1.3')).toBe(true)
			expect(semver.default.gt('0.1.3-beta.1', '0.1.3')).toBe(false)
		})
	})
})
