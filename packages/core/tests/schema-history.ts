import type * as Schemas from '@asterdoc/schemas'
import type { SchemaAddress, SchemaVersion } from '@asterdoc/schemas'

export const EARLIEST = '2000-01-01' as SchemaVersion
export const EARLIER = '2000-02-01' as SchemaVersion

export const earlierUrl = (version: SchemaVersion, name?: string) =>
	`https://schema.asterdoc.com/${version}${name ? `/${name}` : ''}.json`

export function withEarlierVersions(actual: typeof Schemas, earlier: readonly SchemaVersion[] = [EARLIEST, EARLIER]): typeof Schemas {
	const versions = [...earlier, actual.SCHEMA_VERSION] as readonly string[]
	const isSchemaVersion = (value: string): value is SchemaVersion => versions.includes(value)
	return {
		...actual,
		SCHEMA_VERSIONS: versions as typeof actual.SCHEMA_VERSIONS,
		isSchemaVersion,
		readSchemaAddress(address: string): SchemaAddress {
			const read = actual.readSchemaAddress(address)
			return read.kind === 'unknown-version' && isSchemaVersion(read.version) ? { kind: 'known', version: read.version } : read
		},
	}
}
