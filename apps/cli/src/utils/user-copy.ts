export const PROJECT_REQUIRED_MESSAGE = 'Not in an Asterdoc project. Expected asterdoc.json with a .asterdoc directory.'

export function formatLayerCount(count: number): string {
  return `${count} ${count === 1 ? 'layer' : 'layers'}`
}
