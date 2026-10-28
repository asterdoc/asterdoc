/**
 * The project's own `@asterdoc/react/discovery`, loaded for this project.
 *
 * The conventions live in the package, not here, so `asterdoc dev` and `asterdoc check`
 * cannot disagree about what a composition is or which artifact renders it. The
 * package is resolved at the project for the same reason `react` is: the answer
 * has to come from the copy the preview compiles against.
 */

import type * as Discovery from '@asterdoc/react/discovery'

import { importPeer } from './peers.js'

export type { DiscoveredComposition, SampleSource } from '@asterdoc/react/discovery'

/**
 * `@asterdoc/react/discovery` for one project.
 *
 * @throws {MissingPeerError} when the project has no `@asterdoc/react`.
 */
export async function loadDiscovery(root: string): Promise<typeof Discovery> {
	return (await importPeer(root, '@asterdoc/react/discovery')) as unknown as typeof Discovery
}
