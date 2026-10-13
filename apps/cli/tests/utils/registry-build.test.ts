import { describe, expect, it } from 'vitest'
import type { Artifact } from '@paradoc/core'
import { planRegistryItems, releasePath, type SourceEdition, type SourceRelease } from '../../src/utils/registry-build.js'

const NOW = new Date('2026-06-15T12:00:00Z')

function release(name: string, version: string, edition: SourceEdition | null = null, source = `${name}-${edition?.key ?? 'x'}-${version}.json`): SourceRelease {
  return {
    source,
    sourcePath: `/registry/${source}`,
    artifact: { kind: 'form', name, version } as unknown as Artifact,
    name,
    kind: 'form',
    version,
    edition,
  }
}

const edition = (key: string, facts: Partial<SourceEdition> = {}): SourceEdition => ({ key, label: `Rev. ${key}`, ...facts })

/** The current edition the plan chooses for editions with these start facts. */
function currentOf(editions: SourceEdition[], defaults = {}) {
  const plan = planRegistryItems(editions.map((entry) => release('w-9', '1.0.0', entry)), defaults, NOW)
  return { current: plan.items[0]?.currentEdition, errors: plan.errors, undecided: plan.undecided }
}

describe('planRegistryItems: latestVersion', () => {
  it('defaults to the highest version that is not a pre-release, by SemVer precedence', () => {
    const plan = planRegistryItems(['1.2.0', '1.10.0', '2.0.0-rc.1', '1.9.0'].map((version) => release('pet', version)), {}, NOW)
    expect(plan.errors).toEqual([])
    expect(plan.items[0]!.groups[0]!.latestVersion).toBe('1.10.0')
    expect(plan.items[0]!.defaultRelease.version).toBe('1.10.0')
  })

  it('uses the version the publisher states, a pre-release included', () => {
    const plan = planRegistryItems([release('pet', '1.0.0'), release('pet', '2.0.0-rc.1')], { pet: { latestVersion: '2.0.0-rc.1' } }, NOW)
    expect(plan.items[0]!.groups[0]!.latestVersion).toBe('2.0.0-rc.1')
  })

  it('does not decide when every version is a pre-release', () => {
    const plan = planRegistryItems([release('pet', '1.0.0-rc.1')], {}, NOW)
    expect(plan.items).toEqual([])
    expect(plan.errors).toEqual([])
    expect(plan.undecided).toEqual([
      'pet: every version is a pre-release (1.0.0-rc.1), and a pre-release is the default only when the publisher says so. Set defaults["pet"].latestVersion in registry.config.json',
    ])
  })
})

describe('planRegistryItems: currentEdition', () => {
  it('is the only edition when there is one, even with a future date or none', () => {
    expect(currentOf([edition('2999-01', { date: '2999-01' })]).current).toBe('2999-01')
    expect(currentOf([edition('3b')]).current).toBe('3b')
  })

  it('is the edition that started last and not after today', () => {
    expect(currentOf([
      edition('2018-10', { date: '2018-10' }),
      edition('2024-03', { date: '2024-03' }),
      edition('2027-01', { date: '2027-01' }),
    ]).current).toBe('2024-03')
  })

  it('reads effectiveFrom before date: an edition released already and effective later has not started', () => {
    expect(currentOf([
      edition('2024-03', { date: '2024-03' }),
      edition('2026-05', { date: '2026-05', effectiveFrom: '2026-07-01' }),
    ]).current).toBe('2024-03')
    expect(currentOf([
      edition('2024-03', { date: '2024-03' }),
      edition('2026-05', { date: '2026-05', effectiveFrom: '2026-06-15' }),
    ]).current).toBe('2026-05')
  })

  it('counts a date of the present month or year as started', () => {
    expect(currentOf([edition('2024', { date: '2024' }), edition('2026', { date: '2026' })]).current).toBe('2026')
    expect(currentOf([edition('2024-03', { date: '2024-03' }), edition('2026-06', { date: '2026-06' })]).current).toBe('2026-06')
    expect(currentOf([edition('2024-03', { date: '2024-03' }), edition('2026-07', { date: '2026-07' })]).current).toBe('2024-03')
  })

  it('uses the edition the publisher states, a future one included', () => {
    expect(currentOf(
      [edition('2024-03', { date: '2024-03' }), edition('2027-01', { date: '2027-01' })],
      { 'w-9': { currentEdition: '2027-01' } },
    ).current).toBe('2027-01')
  })

  it.each([
    ['an edition has no date', [edition('2024-03', { date: '2024-03' }), edition('3b')], 'because edition 3b has no effectiveFrom or date'],
    ['every edition starts after today', [edition('2027-01', { date: '2027-01' }), edition('2028-01', { date: '2028-01' })], 'because every edition starts after today (2026-06-15)'],
    ['two dates of different precision do not say which is later', [edition('2024', { date: '2024' }), edition('2024-03', { date: '2024-03' })], 'have dates that do not say which is later'],
    ['two editions start on the same date', [edition('a', { date: '2024-03' }), edition('b', { date: '2024-03' })], 'have dates that do not say which is later'],
  ])('does not decide when %s, and asks for the statement', (_what, editions, reason) => {
    const result = currentOf(editions)
    expect(result.current).toBeUndefined()
    expect(result.errors).toEqual([])
    expect(result.undecided).toHaveLength(1)
    expect(result.undecided[0]).toContain(reason)
    expect(result.undecided[0]).toContain('Set defaults["w-9"].currentEdition in registry.config.json')
  })
})

describe('planRegistryItems: grouping', () => {
  it('groups releases by name, then by edition, and takes the edition facts from its latest version', () => {
    const plan = planRegistryItems([
      release('w-9', '1.0.0', edition('2024-03', { label: 'Rev. Mar 2024', date: '2024-03' })),
      release('w-9', '1.1.0', edition('2024-03', { label: 'Rev. March 2024', date: '2024-03' })),
      release('w-9', '1.0.0', edition('2018-10', { date: '2018-10' })),
      release('pet', '1.0.0'),
    ], {}, NOW)

    expect(plan.errors).toEqual([])
    expect(plan.items.map((item) => item.name)).toEqual(['pet', 'w-9'])
    const w9 = plan.items[1]!
    expect(w9.currentEdition).toBe('2024-03')
    expect(w9.groups.map((group) => [group.edition?.key, group.latestVersion, group.releases.length])).toEqual([
      ['2018-10', '1.0.0', 1],
      ['2024-03', '1.1.0', 2],
    ])
    expect(w9.groups[1]!.edition?.label).toBe('Rev. March 2024')
    expect(plan.items[0]!.currentEdition).toBeUndefined()
  })

  it('is an error when one source file of a name has an edition and another has none', () => {
    const plan = planRegistryItems([
      release('w-9', '1.0.0', edition('2024-03'), 'with.json'),
      release('w-9', '1.1.0', null, 'without.json'),
      release('pet', '1.0.0'),
    ], {}, NOW)

    expect(plan.items.map((item) => item.name)).toEqual(['pet'])
    expect(plan.errors).toEqual([
      'w-9: with.json has an edition and without.json has none. An artifact has editions in every release or in none: give every source file of "w-9" an edition, or remove the edition from all of them',
    ])
  })

  it('is an error when two source files are the same release', () => {
    const plan = planRegistryItems([release('pet', '1.0.0', null, 'a.json'), release('pet', '1.0.0', null, 'b.json')], {}, NOW)
    expect(plan.items).toEqual([])
    expect(plan.errors).toEqual(['pet v1.0.0: a.json and b.json are the same release; change the version of one, or remove one'])
  })

  it('allows the same version in two editions', () => {
    const plan = planRegistryItems([
      release('w-9', '1.0.0', edition('2018-10', { date: '2018-10' })),
      release('w-9', '1.0.0', edition('2024-03', { date: '2024-03' })),
    ], {}, NOW)
    expect(plan.errors).toEqual([])
    expect(plan.items).toHaveLength(1)
  })

  it.each([
    [{ ghost: { latestVersion: '1.0.0' } }, 'defaults["ghost"]: no source file has the name "ghost"'],
    [{ pet: { currentEdition: '2024-03' } }, 'defaults["pet"].currentEdition: pet has no editions; state latestVersion only'],
    [{ 'w-9': { latestVersion: '1.0.0' } }, 'defaults["w-9"].latestVersion: w-9 has editions; state the version inside the edition'],
    [{ 'w-9': { editions: { '2019-01': { latestVersion: '1.0.0' } } } }, 'defaults["w-9"].editions["2019-01"]: no source file of w-9 has edition "2019-01" (2024-03)'],
  ])('is an error when a default does not fit the source files: %j', (defaults, message) => {
    const plan = planRegistryItems([release('pet', '1.0.0'), release('w-9', '1.0.0', edition('2024-03'))], defaults, NOW)
    expect(plan.errors.join('\n')).toContain(message)
  })
})

describe('releasePath', () => {
  it('mirrors the release: <name>/<edition>/<version>/<name>.json, without the edition when there is none', () => {
    expect(releasePath(release('w-9', '1.1.0', edition('2024-03')))).toBe('w-9/2024-03/1.1.0/w-9.json')
    expect(releasePath(release('pet-addendum', '1.1.0'))).toBe('pet-addendum/1.1.0/pet-addendum.json')
  })
})
