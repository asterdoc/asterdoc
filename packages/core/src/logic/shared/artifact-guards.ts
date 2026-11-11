import type { Bundle, BundleContentItem, Form } from '@asterdoc/types'

export function isInlineBundleArtifact(
  item: BundleContentItem
): item is Extract<BundleContentItem, { type: 'inline' }> {
  return item.type === 'inline' && 'artifact' in item
}

export function isFormArtifact(artifact: unknown): artifact is Form {
  return (
    typeof artifact === 'object' &&
    artifact !== null &&
    'kind' in artifact &&
    artifact.kind === 'form'
  )
}

export function isBundleArtifact(artifact: unknown): artifact is Bundle {
  return (
    typeof artifact === 'object' &&
    artifact !== null &&
    'kind' in artifact &&
    artifact.kind === 'bundle'
  )
}
