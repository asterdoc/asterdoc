import type { ArtifactInstanceOptions, Form, FormInstance } from '@asterdoc/core'
import type { AsterdocToolsConfig } from './config'
import { isRecord, layerFileResolver } from './artifact'

type Resolver = NonNullable<ArtifactInstanceOptions['resolver']>

export const VERIFIED_FILE_LIMIT = 16

const NO_CONFIG = {}

const verifiedFiles = new WeakMap<object, Map<string, Uint8Array>>()

function filesOf(config: AsterdocToolsConfig | undefined): Map<string, Uint8Array> {
	const owner = config ?? NO_CONFIG
	let files = verifiedFiles.get(owner)
	if (!files) {
		files = new Map()
		verifiedFiles.set(owner, files)
	}
	return files
}

function filePath(path: string): string {
	return path.replace(/^\.\//, '')
}

function declaredChecksums(artifact: Record<string, unknown>): Map<string, string> {
	const checksums = new Map<string, string>()
	const note = (value: unknown) => {
		if (isRecord(value) && typeof value.path === 'string' && typeof value.checksum === 'string') {
			checksums.set(filePath(value.path), value.checksum)
		}
	}
	if (!isRecord(artifact.layers)) return checksums
	for (const layer of Object.values(artifact.layers)) {
		note(layer)
		if (isRecord(layer)) note(layer.font)
	}
	return checksums
}

async function hasChecksum(bytes: Uint8Array, checksum: string): Promise<boolean> {
	const [algorithm, expected] = checksum.split(':')
	if (algorithm !== 'sha256' || !expected) return false
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
	const actual = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
	return actual === expected.toLowerCase()
}

function remember(files: Map<string, Uint8Array>, key: string, bytes: Uint8Array): void {
	files.delete(key)
	files.set(key, bytes.slice())
	while (files.size > VERIFIED_FILE_LIMIT) {
		const oldest = files.keys().next().value
		if (oldest === undefined) break
		files.delete(oldest)
	}
}

/**
 * The resolver for an artifact's layer files, beneath its `base_url`, through
 * the tools' fetch policy. A file that matches the checksum the artifact
 * declares for it is kept, so a later read through the same `config` does not
 * fetch it again. The kept files belong to `config`: a host that serves
 * several tenants gives each tenant its own config, so one tenant never reads
 * a file another fetched. `undefined` when there is no base URL.
 */
export function artifactFileResolver(
	artifact: Record<string, unknown>,
	base_url: string | undefined,
	config?: AsterdocToolsConfig,
): Resolver | undefined {
	const remote = layerFileResolver(base_url, config)
	if (!remote || !base_url) return undefined
	const checksums = declaredChecksums(artifact)
	const files = filesOf(config)
	return {
		async read(path) {
			const checksum = checksums.get(filePath(path))
			const key = checksum && `${base_url}\n${filePath(path)}\n${checksum}`
			const kept = key ? files.get(key) : undefined
			if (key && kept) {
				files.delete(key)
				files.set(key, kept)
				return kept.slice()
			}
			const bytes = await remote.read(path)
			if (key && checksum && await hasChecksum(bytes, checksum)) remember(files, key, bytes)
			return bytes
		},
	}
}

export async function loadToolForm(
	artifact: Record<string, unknown>,
	base_url: string | undefined,
	config?: AsterdocToolsConfig,
): Promise<FormInstance<Form>> {
	const { form, isForm } = await import('@asterdoc/core')
	if (!isForm(artifact)) throw new TypeError('The artifact is not a form.')
	return await form.load(artifact, { resolver: artifactFileResolver(artifact, base_url, config) })
}
