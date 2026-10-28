/**
 * The toolchain `asterdoc dev` borrows from the project.
 *
 * The preview compiles the project's own compositions against the project's own
 * React and its own `@asterdoc/react`, so the bundler that compiles them is the
 * project's too. All eight are optional peers of `@asterdoc/cli`, resolved at the
 * project, and a project missing one is told exactly what to install rather than
 * shown a resolution error from inside a dependency.
 *
 * React peers come from the project so the composition and renderer share one React instance.
 *
 * **Where each one is resolved.** `react`, `react-dom`, `@asterdoc/react` and
 * `@asterdoc/react-pdf` are resolved at the project and nowhere else: a copy of
 * them from `asterdoc`'s own installation would be a different React and a
 * different component library from the ones the page loads, which is the failure
 * this is meant to prevent. The PDF route renders through the project's
 * `@asterdoc/react-pdf` so that it shares the project's `@asterdoc/react`. The
 * bundler and its plugins have no such identity: they compile, they are not
 * compiled, so those fall back to `asterdoc`'s own dependencies, which is what makes
 * the command work inside this repository, where the packages are linked rather
 * than installed into a consumer project.
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { InlineConfig, Plugin, ViteDevServer } from 'vite'

/**
 * The packages whose identity has to be the project's, because the page loads
 * them. They are runtime dependencies of a project that composes documents.
 */
export const DEV_RUNTIME_PEERS = ['@asterdoc/react', '@asterdoc/react-pdf', 'react', 'react-dom'] as const

/**
 * The packages that only compile. `asterdoc`'s own copies serve if the project has
 * none, so these are development dependencies.
 */
export const DEV_BUILD_PEERS = [
	'vite',
	'@vitejs/plugin-react',
	'@tailwindcss/vite',
	'tailwindcss',
] as const

/** Everything `asterdoc dev` needs from the project, named the way a person installs it. */
export const DEV_PEERS = [...DEV_BUILD_PEERS, ...DEV_RUNTIME_PEERS] as const

/**
 * The loader `asterdoc check` imports a composition through. It only compiles, so
 * it sits in the same tier as the bundler: the project's copy, else `asterdoc`'s own.
 */
export const CHECK_LOADER_PEER = 'tsx'

/** Which command is asking, and what it does with the packages it asks for. */
export interface PeerNeed {
	command: string
	reason: string
}

const DEV_NEED: PeerNeed = {
	command: 'asterdoc dev',
	reason:
		'The preview compiles your compositions against your own React and ' +
		"your own @asterdoc/react, so it uses your project's toolchain.",
}

/** What `asterdoc check` says when the project cannot supply a package it loads. */
export const CHECK_NEED: PeerNeed = {
	command: 'asterdoc check',
	reason:
		'The check imports your composition against your own React and your own ' +
		"@asterdoc/react, through your project's TypeScript loader.",
}

/** The install commands each package manager spells, by the lockfile it leaves. */
const PACKAGE_MANAGERS = [
	{ lockfile: 'pnpm-lock.yaml', runtime: 'pnpm add', development: 'pnpm add -D' },
	{ lockfile: 'yarn.lock', runtime: 'yarn add', development: 'yarn add -D' },
	{ lockfile: 'bun.lock', runtime: 'bun add', development: 'bun add -d' },
	{ lockfile: 'bun.lockb', runtime: 'bun add', development: 'bun add -d' },
	{ lockfile: 'package-lock.json', runtime: 'npm install', development: 'npm install --save-dev' },
] as const

/** The commands the project's own package manager would use. */
function installer(root: string): { runtime: string; development: string } {
	for (const manager of PACKAGE_MANAGERS) {
		if (existsSync(join(root, manager.lockfile))) return manager
	}
	return { runtime: 'npm install', development: 'npm install --save-dev' }
}

/** Thrown when the project cannot supply what a command is built from. */
export class MissingPeerError extends Error {
	/** The packages that could not be resolved, in the order they are listed. */
	readonly peers: readonly string[]

	constructor(peers: readonly string[], root: string, need: PeerNeed = DEV_NEED) {
		const commands = installer(root)
		const runtime = peers.filter((peer) => (DEV_RUNTIME_PEERS as readonly string[]).includes(peer))
		const development = peers.filter((peer) => !runtime.includes(peer))
		const lines = [
			runtime.length > 0 ? `  ${commands.runtime} ${runtime.join(' ')}` : undefined,
			development.length > 0 ? `  ${commands.development} ${development.join(' ')}` : undefined,
		].filter((line): line is string => line !== undefined)

		super(
			`${need.command} needs ${peers.join(', ')}, and ${peers.length === 1 ? 'it is' : 'they are'} not ` +
				`installed in ${root}. ${need.reason} Install ${peers.length === 1 ? 'it' : 'them'} with:\n\n` +
				`${lines.join('\n')}\n`,
		)
		this.name = 'MissingPeerError'
		this.peers = peers
	}
}

/** What the dev server needs, once every peer has been found. */
export interface DevToolchain {
	/** Vite's `createServer`, from the project's copy. */
	createServer: (config: InlineConfig) => Promise<ViteDevServer>
	/** The React plugin factory. */
	react: () => Plugin[] | Plugin
	/** The Tailwind plugin factory. */
	tailwindcss: () => Plugin[] | Plugin
}

/** Where a specifier may be resolved from, in the order the parents are tried. */
function parentsFor(root: string, specifier: string): string[] {
	const project = join(resolve(root), 'package.json')
	const owner = specifier.startsWith('@')
		? specifier.split('/').slice(0, 2).join('/')
		: (specifier.split('/')[0] ?? specifier)
	return (DEV_RUNTIME_PEERS as readonly string[]).includes(owner)
		? [project]
		: [project, import.meta.url]
}

/** The file a specifier resolves to, or nothing when the project has no such package. */
function resolveFrom(root: string, specifier: string): string | undefined {
	for (const parent of parentsFor(root, specifier)) {
		try {
			return createRequire(parent).resolve(specifier)
		} catch {
			// Try the next parent; a specifier missing from all of them is reported once, below.
		}
	}
	return undefined
}

/**
 * A module resolved for this project, imported through its file URL.
 *
 * @throws {MissingPeerError} when the project cannot supply it.
 */
export async function importPeer(
	root: string,
	specifier: string,
	need: PeerNeed = DEV_NEED,
): Promise<Record<string, unknown>> {
	const file = resolveFrom(root, specifier)
	if (!file) throw new MissingPeerError([packageOf(specifier)], root, need)
	return (await import(pathToFileURL(file).href)) as Record<string, unknown>
}

/**
 * The loader module `asterdoc check` registers, from the project or from `asterdoc` itself.
 *
 * @throws {MissingPeerError} naming `asterdoc check` when neither has it.
 */
export async function importCheckLoader(root: string): Promise<Record<string, unknown>> {
	return importPeer(root, `${CHECK_LOADER_PEER}/esm/api`, CHECK_NEED)
}

/** The package a subpath specifier belongs to, which is what a person installs. */
function packageOf(specifier: string): string {
	const parts = specifier.split('/')
	return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier)
}

/**
 * Every peer the project cannot supply, in the order they are listed.
 *
 * Separate from loading them so the command can ask before it reads the project:
 * a person with none of them installed should be told all eight at once, not
 * sent back for the next one each time they run it.
 */
export function missingDevPeers(root: string): string[] {
	return DEV_PEERS.filter((peer) => resolveFrom(root, peer) === undefined)
}

/** Refuses a project that cannot supply the toolchain. @throws {MissingPeerError} */
export function assertDevPeers(root: string): void {
	const missing = missingDevPeers(root)
	if (missing.length > 0) throw new MissingPeerError(missing, root)
}

/**
 * Everything the preview is built from, or one error naming every missing part.
 *
 * @throws {MissingPeerError} when the project cannot supply a peer.
 */
export async function loadDevToolchain(root: string): Promise<DevToolchain> {
	assertDevPeers(root)

	const vite = await importPeer(root, 'vite')
	const reactPlugin = await importPeer(root, '@vitejs/plugin-react')
	const tailwindPlugin = await importPeer(root, '@tailwindcss/vite')

	return {
		createServer: vite.createServer as DevToolchain['createServer'],
		// Both plugins are default exports; a CommonJS build of either arrives
		// under `default` a second time, which is the one interop worth handling.
		react: unwrap(reactPlugin) as DevToolchain['react'],
		tailwindcss: unwrap(tailwindPlugin) as DevToolchain['tailwindcss'],
	}
}

/** The default export of a module, whichever way the module was built. */
function unwrap(module: Record<string, unknown>): unknown {
	const exported = module.default ?? module
	const nested = (exported as { default?: unknown }).default
	return typeof exported === 'function' ? exported : (nested ?? exported)
}
