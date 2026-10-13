import type { ParadocToolsConfig } from '../config'
import { GetRegistryInputSchema, type GetRegistryInput, type GetRegistryOutput } from '../contracts'
import { errorFromUnknown } from '../errors'
import { fetchRegistryIndex, registryUrlFromConfig, summarizeRegistryReleases } from '../registry-client'

export async function executeGetRegistry(
	input: GetRegistryInput | Record<string, unknown> = {},
	config?: ParadocToolsConfig,
): Promise<GetRegistryOutput> {
	try {
		const normalized = GetRegistryInputSchema.parse(input)
		const registryUrl = registryUrlFromConfig(normalized.registry_url, config)
		if (!registryUrl) return { items: [], error: { code: 'missing_registry_url', message: 'registry_url is required, or configure defaultRegistryUrl.' } }
		const index = await fetchRegistryIndex(registryUrl, config?.fetch, config)
		return {
			registry_url: registryUrl,
			name: index.name,
			...(index.description !== undefined ? { description: index.description } : {}),
			items: index.items.map((item) => ({
				name: item.name,
				kind: item.kind,
				...(item.title !== undefined ? { title: item.title } : {}),
				...(item.description !== undefined ? { description: item.description } : {}),
				...(item.tags !== undefined ? { tags: item.tags } : {}),
				...summarizeRegistryReleases(item),
			})),
		}
	} catch (error) {
		return { items: [], error: errorFromUnknown(error, 'registry_fetch_error') }
	}
}
