import { createHash } from 'node:crypto'

export const sha256 = (body: string): string => createHash('sha256').update(body).digest('hex')

interface EditionFacts {
	key: string
	label: string
	date?: string
	effectiveFrom?: string
}

export interface RegistryFile {
	/** The artifact as the file states it. It needs `name`, `kind` and `version`. */
	artifact: Record<string, unknown>
	/** Path relative to the registry base address. Default: `<name>[/<edition>]/<version>/<name>.json`. */
	path?: string
}

/**
 * Build a `registry.json` manifest and the file bodies it lists. For each
 * artifact name, the first file given is the default: its edition is the
 * current edition and its version is the latest version.
 */
export function registryFixture(files: RegistryFile[]): { manifest: Record<string, unknown>; bodies: Record<string, string> } {
	const bodies: Record<string, string> = {}
	const items = new Map<string, Record<string, unknown>>()
	for (const file of files) {
		const { name, kind, version } = file.artifact as { name: string; kind: string; version: string }
		const edition = file.artifact.edition as EditionFacts | undefined
		const path = file.path ?? [name, ...(edition ? [edition.key] : []), version, `${name}.json`].join('/')
		const body = JSON.stringify(file.artifact)
		bodies[path] = body
		const entry = { path, sha256: sha256(body) }
		const item = items.get(name) ?? { name, kind }
		items.set(name, item)
		if (edition) {
			item.currentEdition ??= edition.key
			const editions = (item.editions ??= {}) as Record<string, { latestVersion: string; versions: Record<string, unknown> }>
			const { key, ...facts } = edition
			editions[key] ??= { ...facts, latestVersion: version, versions: {} }
			editions[key].versions[version] = entry
		} else {
			item.latestVersion ??= version
			const versions = (item.versions ??= {}) as Record<string, unknown>
			versions[version] = entry
		}
	}
	return { manifest: { name: 'test-registry', items: [...items.values()] }, bodies }
}

/**
 * A fetch that serves a registry fixture from `baseUrl`. `extra` adds or
 * replaces responses by path, for instruction files or a tampered artifact.
 */
export function registryFetch(
	baseUrl: string,
	files: RegistryFile[],
	extra: Record<string, string> = {},
): (input: string | URL | Request) => Promise<Response> {
	const { manifest, bodies } = registryFixture(files)
	const served: Record<string, string> = { 'registry.json': JSON.stringify(manifest), ...bodies, ...extra }
	const root = `${baseUrl.replace(/\/$/, '')}/`
	return async (input) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
		const body = url.startsWith(root) ? served[url.slice(root.length)] : undefined
		return body === undefined ? new Response('Not found', { status: 404 }) : new Response(body)
	}
}
