import { describe, it, expect } from 'vitest'
import {
  parseArtifactArg,
  parseArtifactRef,
  parseNamespaceOnly,
  buildRegistryIndexUrl,
  buildReleaseUrl,
  buildLayerFileUrl,
} from '../../src/utils/registry.js'
import type { ResolvedRegistry } from '../../src/types.js'

describe('parseArtifactRef', () => {
  it('parses valid artifact references', () => {
    const result = parseArtifactRef('@acme/residential-lease')
    expect(result).toEqual({
      namespace: '@acme',
      name: 'residential-lease',
      full: '@acme/residential-lease',
    })
  })

  it('handles namespace with underscore', () => {
    const result = parseArtifactRef('@my_org/my-artifact')
    expect(result).toEqual({
      namespace: '@my_org',
      name: 'my-artifact',
      full: '@my_org/my-artifact',
    })
  })

  it.each(['@acme/my_artifact', '@acme/a--b', '@acme/-a', '@acme/a-'])(
    'refuses %s, whose name breaks the artifact name rule',
    (ref) => {
      expect(parseArtifactRef(ref)).toBeNull()
    },
  )

  it('parses an edition and a version, and keeps them out of the lock key', () => {
    expect(parseArtifactRef('@acme/w-9/2024-03@1.0.0')).toEqual({
      namespace: '@acme',
      name: 'w-9',
      full: '@acme/w-9',
      edition: '2024-03',
      version: '1.0.0',
    })
    expect(parseArtifactRef('@acme/w-9/2024-03')).toEqual({ namespace: '@acme', name: 'w-9', full: '@acme/w-9', edition: '2024-03' })
    expect(parseArtifactRef('@acme/w-9@1.0.0')).toEqual({ namespace: '@acme', name: 'w-9', full: '@acme/w-9', version: '1.0.0' })
  })

  it('reads current and latest as the default, the same as leaving them out', () => {
    expect(parseArtifactRef('@acme/w-9/current@latest')).toEqual({ namespace: '@acme', name: 'w-9', full: '@acme/w-9' })
  })

  it.each(['@acme/w-9@1.0', '@acme/w-9@', '@acme/w-9/', '@acme/w-9/2024-03/extra', '@acme/w-9/editions'])(
    'refuses %s, which is not a registry reference',
    (ref) => {
      expect(parseArtifactRef(ref)).toBeNull()
    },
  )

  it('handles namespace with dash', () => {
    const result = parseArtifactRef('@my-org/my-artifact')
    expect(result).toEqual({
      namespace: '@my-org',
      name: 'my-artifact',
      full: '@my-org/my-artifact',
    })
  })

  it('returns null for missing @ prefix', () => {
    const result = parseArtifactRef('acme/residential-lease')
    expect(result).toBeNull()
  })

  it('returns null for missing slash', () => {
    const result = parseArtifactRef('@acme')
    expect(result).toBeNull()
  })

  it('returns null for empty name', () => {
    const result = parseArtifactRef('@acme/')
    expect(result).toBeNull()
  })

  it('returns null for empty namespace', () => {
    const result = parseArtifactRef('@/artifact')
    expect(result).toBeNull()
  })

  it('returns null for invalid namespace characters', () => {
    const result = parseArtifactRef('@acme!/artifact')
    expect(result).toBeNull()
  })

  it('returns null for empty string', () => {
    const result = parseArtifactRef('')
    expect(result).toBeNull()
  })
})
describe('parseNamespaceOnly', () => {
  it('returns the namespace with its @', () => {
    expect(parseNamespaceOnly('@my_org')).toEqual({ namespace: '@my_org' })
  })

  it('returns null for a reference or a bare name', () => {
    expect(parseNamespaceOnly('@acme/w9')).toBeNull()
    expect(parseNamespaceOnly('acme')).toBeNull()
  })
})

describe('parseArtifactArg with a direct URL', () => {
  it('names the artifact after the last path segment and the namespace after the host', () => {
    expect(parseArtifactArg('https://registry.acme.com/r/w-9.json')).toEqual({
      type: 'url',
      artifactUrl: 'https://registry.acme.com/r/w-9.json',
      baseUrl: 'https://registry.acme.com',
      namespace: '@registry.acme.com',
      name: 'w-9',
    })
  })

  it.each(['https://registry.acme.com/r/w_9.json', 'https://registry.acme.com/r/w--9.yaml'])(
    'refuses %s, whose file name is not a valid artifact name',
    (url) => {
      expect(parseArtifactArg(url)).toBeNull()
    },
  )
})



describe('buildRegistryIndexUrl', () => {
  it('builds correct URL for registry index', () => {
    const registry: ResolvedRegistry = {
      namespace: '@acme',
      baseUrl: 'https://registry.acme.com',
    }
    expect(buildRegistryIndexUrl(registry)).toBe('https://registry.acme.com/registry.json')
  })

  it('handles trailing slash in baseUrl', () => {
    const registry: ResolvedRegistry = {
      namespace: '@acme',
      baseUrl: 'https://registry.acme.com/',
    }
    expect(buildRegistryIndexUrl(registry)).toBe('https://registry.acme.com/registry.json')
  })
})

describe('buildReleaseUrl', () => {
  it('resolves a manifest path under the registry base address', () => {
    const registry: ResolvedRegistry = { namespace: '@acme', baseUrl: 'https://registry.acme.com' }
    expect(buildReleaseUrl(registry, 'w-9/2024-03/1.0.0/w-9.json')).toBe(
      'https://registry.acme.com/w-9/2024-03/1.0.0/w-9.json'
    )
  })

  it('keeps a base address that is a folder, with or without its trailing slash', () => {
    for (const baseUrl of ['https://acme.com/forms/registry', 'https://acme.com/forms/registry/']) {
      expect(buildReleaseUrl({ namespace: '@acme', baseUrl }, 'pet-addendum/1.1.0/pet-addendum.json')).toBe(
        'https://acme.com/forms/registry/pet-addendum/1.1.0/pet-addendum.json'
      )
    }
  })
})

describe('buildLayerFileUrl', () => {
  it('builds correct URL for layer file', () => {
    const registry: ResolvedRegistry = {
      namespace: '@acme',
      baseUrl: 'https://registry.acme.com',
    }
    expect(buildLayerFileUrl(registry, 'layers/template.txt')).toBe(
      'https://registry.acme.com/layers/template.txt'
    )
  })

  it('handles file path with leading slash', () => {
    const registry: ResolvedRegistry = {
      namespace: '@acme',
      baseUrl: 'https://registry.acme.com',
    }
    expect(buildLayerFileUrl(registry, '/layers/template.txt')).toBe(
      'https://registry.acme.com/layers/template.txt'
    )
  })
})
