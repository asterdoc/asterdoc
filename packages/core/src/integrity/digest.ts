import type { BinaryContent } from '@asterdoc/types'

/** `sha256:<hex>` over the bytes. */
export async function digestOf(bytes: BinaryContent): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
	return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
