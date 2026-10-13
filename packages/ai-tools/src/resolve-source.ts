import type { ParadocToolsConfig } from './config'
import { SourceSchema, type SourceInput } from './contracts'
import {
	fetchPolicyFromConfig,
	fetchRegistryArtifact,
	MAX_ITEM_SIZE,
	registryUrlFromConfig,
	safeFetch,
} from './registry-client'

export interface ResolvedSource {
	artifact: Record<string, unknown>
	base_url?: string
	artifact_url?: string
}

class MissingRegistryUrlError extends Error {
	readonly code = 'missing_registry_url'
}

function requireRegistryUrl(input: string | undefined, config?: ParadocToolsConfig): string {
	const registryUrl = registryUrlFromConfig(input, config)
	if (!registryUrl) throw new MissingRegistryUrlError('registry_url is required, or configure defaultRegistryUrl.')
	return registryUrl
}

function artifactBaseUrl(artifactUrl: string): string {
	const url = new URL(artifactUrl)
	url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
	url.search = ''
	url.hash = ''
	return url.toString().replace(/\/$/, '')
}

/**
 * Resolve the artifact a tool works on, under the rules every loading surface
 * applies. An artifact read from a URL or a registry is a file, so its
 * `$schema` must name the current schema version. An inline artifact is an
 * object, as with `loadFromObject`: it may omit `$schema`, but one it declares
 * must be current. Loading never migrates; the error points to `paradoc migrate`.
 */
export async function resolveSource(
	input: SourceInput | Record<string, unknown>,
	config?: ParadocToolsConfig,
): Promise<ResolvedSource> {
	const resolved = await resolveUncheckedSource(input, config)
	const { assertCurrentSchemaVersion } = await import('@paradoc/core')
	assertCurrentSchemaVersion(resolved.artifact, { required: resolved.artifact_url !== undefined })
	return resolved
}

async function resolveUncheckedSource(
	input: SourceInput | Record<string, unknown>,
	config?: ParadocToolsConfig,
): Promise<ResolvedSource> {
	const source = SourceSchema.parse(input)
	if (source.source === 'artifact') {
		return { artifact: source.artifact, base_url: source.base_url }
	}

	if (source.source === 'url') {
		const response = await safeFetch(source.url, MAX_ITEM_SIZE, config?.fetch, fetchPolicyFromConfig(config))
		const artifact = await response.json()
		if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
			throw new Error('Artifact URL must return a JSON object')
		}
		const finalArtifactUrl = response.url || source.url
		return { artifact: artifact as Record<string, unknown>, base_url: artifactBaseUrl(finalArtifactUrl), artifact_url: finalArtifactUrl }
	}

	const registryUrl = requireRegistryUrl(source.registry_url, config)
	const fetched = await fetchRegistryArtifact(
		registryUrl,
		{ name: source.artifact_name, edition: source.edition, version: source.version },
		config?.fetch,
		config,
	)
	return { artifact: fetched.artifact, base_url: fetched.baseUrl, artifact_url: fetched.artifactUrl }
}
