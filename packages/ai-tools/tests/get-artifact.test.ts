import { describe, expect, it, vi } from 'vitest'
import { PARADOC_SCHEMA_URL } from '@paradoc/core'
import { executeGetArtifact } from '../src/tools/get-artifact'
import { registryFetch } from './helpers/registry'

describe('executeGetArtifact instruction resolution', () => {
  it('returns inline instructions and inline agent instructions', async () => {
    const artifact = {
      $schema: PARADOC_SCHEMA_URL,
      kind: 'form',
      name: 'pet-addendum',
      version: '1.0.0',
      instructions: {
        kind: 'inline',
        text: 'Fill out required pet details only.',
      },
      agentInstructions: {
        kind: 'inline',
        text: 'Ask one question at a time.',
      },
    }

    const mockFetch = vi.fn(registryFetch('https://public.paradoc.dev', [{ artifact }]))

    const result = await executeGetArtifact(
      { registry_url: 'https://public.paradoc.dev', artifact_name: 'pet-addendum' },
      { fetch: mockFetch },
    )

    expect(result.error).toBeUndefined()
    expect(result.instructions?.kind).toBe('inline')
    expect(result.instructions?.content).toContain('required pet details')
    expect(result.agent_instructions?.kind).toBe('inline')
    expect(result.agent_instructions?.content).toContain('one question at a time')
  })

  it('fetches file-backed instructions and agent instructions', async () => {
    const artifact = {
      $schema: PARADOC_SCHEMA_URL,
      kind: 'form',
      name: 'pet-addendum',
      version: '1.0.0',
      instructions: {
        kind: 'file',
        path: 'instructions.md',
        mimeType: 'text/markdown',
      },
      agentInstructions: {
        kind: 'file',
        path: 'agent-instructions.md',
        mimeType: 'text/markdown',
      },
    }

    const mockFetch = vi.fn(registryFetch('https://public.paradoc.dev', [{ artifact }], {
      'pet-addendum/1.0.0/instructions.md': '# Instructions',
      'pet-addendum/1.0.0/agent-instructions.md': '# Agent Instructions',
    }))

    const result = await executeGetArtifact(
      { registry_url: 'https://public.paradoc.dev', artifact_name: 'pet-addendum' },
      { fetch: mockFetch },
    )

    expect(result.error).toBeUndefined()
    expect(result.instructions?.kind).toBe('file')
    expect(result.instructions?.encoding).toBe('utf-8')
    expect(result.instructions?.content).toContain('Instructions')
    expect(result.agent_instructions?.kind).toBe('file')
    expect(result.agent_instructions?.encoding).toBe('utf-8')
    expect(result.agent_instructions?.content).toContain('Agent Instructions')
  })

  it('returns an error when referenced instruction file cannot be fetched', async () => {
    const artifact = {
      $schema: PARADOC_SCHEMA_URL,
      kind: 'form',
      name: 'pet-addendum',
      version: '1.0.0',
      instructions: {
        kind: 'file',
        path: 'instructions.md',
        mimeType: 'text/markdown',
      },
    }

    const mockFetch = vi.fn(registryFetch('https://public.paradoc.dev', [{ artifact }]))

    const result = await executeGetArtifact(
      { registry_url: 'https://public.paradoc.dev', artifact_name: 'pet-addendum' },
      { fetch: mockFetch },
    )

    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('instructions.md')
    expect(result.instructions).toBeUndefined()
  })
})
