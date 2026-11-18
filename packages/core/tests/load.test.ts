import { describe, test, expect } from 'vitest'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/schemas'
import { load, safeLoad, LoadError, type AnyArtifactInstance } from '@/serialization'
import type { FormInstance } from '@/artifacts'

/**
 * Tests for load/safeLoad functions.
 *
 * These functions allow loading artifacts from strings (YAML/JSON) or
 * parsed objects when the artifact kind is not known at compile time.
 */
describe('load functions', () => {
  // ============================================================================
  // Test Fixtures
  // ============================================================================

  const formYAML = `
$schema: ${ASTERDOC_SCHEMA_URL}
kind: form
name: test-form
version: 1.0.0
title: Test Form
fields:
  name:
    type: text
    label: Name
`

  const formJSON = JSON.stringify({
    $schema: ASTERDOC_SCHEMA_URL,
    kind: 'form',
    name: 'test-form',
    version: '1.0.0',
    title: 'Test Form',
    fields: {
      name: { type: 'text', label: 'Name' },
    },
  })

  const documentYAML = `
$schema: ${ASTERDOC_SCHEMA_URL}
kind: document
name: test-document
version: 1.0.0
title: Test Document
layers:
  default:
    kind: inline
    mimeType: text/plain
    text: Hello World
`

  const bundleYAML = `
$schema: ${ASTERDOC_SCHEMA_URL}
kind: bundle
name: test-bundle
version: 1.0.0
title: Test Bundle
contents:
  - type: registry
    key: main-form
    slug: "@test/forms/test-form"
    version: "1.0.0"
`

  const checklistYAML = `
$schema: ${ASTERDOC_SCHEMA_URL}
kind: checklist
name: test-checklist
version: 1.0.0
title: Test Checklist
items:
  - id: item1
    title: First Item
`

  // ============================================================================
  // await load() Function
  // ============================================================================

  describe('await load()', () => {
    describe('from YAML string', () => {
      test('loads form from YAML', async () => {
        const instance = await load(formYAML)

        expect(instance.kind).toBe('form')
        expect(instance.name).toBe('test-form')
      })

      test('loads document from YAML', async () => {
        const instance = await load(documentYAML)

        expect(instance.kind).toBe('document')
        expect(instance.name).toBe('test-document')
      })

      test('loads bundle from YAML', async () => {
        const instance = await load(bundleYAML)

        expect(instance.kind).toBe('bundle')
        expect(instance.name).toBe('test-bundle')
      })

      test('loads checklist from YAML', async () => {
        const instance = await load(checklistYAML)

        expect(instance.kind).toBe('checklist')
        expect(instance.name).toBe('test-checklist')
      })
    })

    describe('from JSON string', () => {
      test('loads form from JSON', async () => {
        const instance = await load(formJSON)

        expect(instance.kind).toBe('form')
        expect(instance.name).toBe('test-form')
      })

      test('loads bundle from JSON', async () => {
        const json = JSON.stringify({
          $schema: ASTERDOC_SCHEMA_URL,
          kind: 'bundle',
          name: 'json-bundle',
          version: '1.0.0',
          title: 'JSON Bundle',
          contents: [],
        })
        const instance = await load(json)

        expect(instance.kind).toBe('bundle')
        expect(instance.name).toBe('json-bundle')
      })
    })

    describe('error cases', () => {
      test('throws LoadError for invalid YAML/JSON', async () => {
        await expect(load('{ invalid json')).rejects.toThrow(LoadError)
      })

      test('throws LoadError for missing kind', async () => {
        const yaml = `
name: no-kind
version: 1.0.0
title: No Kind
`
        await expect(load(yaml)).rejects.toThrow(LoadError)
        await expect(load(yaml)).rejects.toThrow(/missing or invalid "kind" field/)
      })

      test('throws LoadError for unknown kind', async () => {
        const yaml = `
$schema: ${ASTERDOC_SCHEMA_URL}
kind: unknown
name: unknown
version: 1.0.0
title: Unknown
`
        await expect(load(yaml)).rejects.toThrow(LoadError)
        await expect(load(yaml)).rejects.toThrow(/Unknown artifact kind/)
      })

      test('throws LoadError for non-object content', async () => {
        await expect(load('"just a string"')).rejects.toThrow(LoadError)
        await expect(load('123')).rejects.toThrow(LoadError)
        await expect(load('null')).rejects.toThrow(LoadError)
      })

      test('LoadError has cause property for parse errors', async () => {
        try {
          await load('{ invalid')
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(LoadError)
          const loadError = error as LoadError
          expect(loadError.cause).toBeDefined()
        }
      })
    })

    describe('type narrowing', () => {
      test('can narrow by kind', async () => {
        const instance = await load(formYAML)

        if (instance.kind === 'form') {
          // TypeScript should know this is FormInstance
          expect(instance.fields).toBeDefined()
        }
      })

      test('returns AnyArtifactInstance union type', async () => {
        const instance: AnyArtifactInstance = await load(formYAML)
        expect(instance).toBeDefined()
      })
    })
  })

  // ============================================================================
  // await safeLoad() Function
  // ============================================================================

  describe('await safeLoad()', () => {
    describe('success cases', () => {
      test('returns success for valid YAML', async () => {
        const result = await safeLoad(formYAML)

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.kind).toBe('form')
          expect(result.data.name).toBe('test-form')
        }
      })

      test('returns success for valid JSON', async () => {
        const result = await safeLoad(formJSON)

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.kind).toBe('form')
        }
      })

      test('returns correct instance type for each artifact kind', async () => {
        const formResult = await safeLoad(formYAML)
        const documentResult = await safeLoad(documentYAML)
        const bundleResult = await safeLoad(bundleYAML)
        const checklistResult = await safeLoad(checklistYAML)

        expect(formResult.success && formResult.data.kind).toBe('form')
        expect(documentResult.success && documentResult.data.kind).toBe('document')
        expect(bundleResult.success && bundleResult.data.kind).toBe('bundle')
        expect(checklistResult.success && checklistResult.data.kind).toBe('checklist')
      })
    })

    describe('error cases', () => {
      test('returns error for invalid YAML/JSON', async () => {
        const result = await safeLoad('{ invalid')

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toBeInstanceOf(LoadError)
        }
      })

      test('returns error for missing kind', async () => {
        const yaml = `
name: no-kind
version: 1.0.0
title: No Kind
`
        const result = await safeLoad(yaml)

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.message).toContain('kind')
        }
      })

      test('returns error for unknown kind', async () => {
        const yaml = `
$schema: ${ASTERDOC_SCHEMA_URL}
kind: unknown
name: unknown
version: 1.0.0
title: Unknown
`
        const result = await safeLoad(yaml)

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.message).toContain('Unknown artifact kind')
        }
      })

      test('returns error for validation failures', async () => {
        const yaml = `
$schema: ${ASTERDOC_SCHEMA_URL}
kind: form
name: ""
version: 1.0.0
title: Empty Name
`
        const result = await safeLoad(yaml)

        expect(result.success).toBe(false)
      })
    })
  })

  // ============================================================================
  // await load() Function
  // ============================================================================

  describe('await load()', () => {
    describe('success cases', () => {
      test('loads form from object', async () => {
        const obj = {
          kind: 'form',
          name: 'object-form',
          version: '1.0.0',
          title: 'Object Form',
        }
        const instance = await load(obj)

        expect(instance.kind).toBe('form')
        expect(instance.name).toBe('object-form')
      })

      test('loads document from object', async () => {
        const obj = {
          kind: 'document',
          name: 'object-document',
          version: '1.0.0',
          title: 'Object Document',
        }
        const instance = await load(obj)

        expect(instance.kind).toBe('document')
      })

      test('loads bundle from object', async () => {
        const obj = {
          kind: 'bundle',
          name: 'object-bundle',
          version: '1.0.0',
          title: 'Object Bundle',
          contents: [],
        }
        const instance = await load(obj)

        expect(instance.kind).toBe('bundle')
      })

      test('loads checklist from object', async () => {
        const obj = {
          kind: 'checklist',
          name: 'object-checklist',
          version: '1.0.0',
          title: 'Object Checklist',
          items: [],
        }
        const instance = await load(obj)

        expect(instance.kind).toBe('checklist')
      })
    })

    describe('error cases', () => {
      test('throws LoadError for null', async () => {
        await expect(load(null)).rejects.toThrow(LoadError)
        await expect(load(null)).rejects.toThrow(/expected an object/)
      })

      test('throws LoadError for undefined', async () => {
        await expect(load(undefined)).rejects.toThrow(LoadError)
      })

      test('throws LoadError for non-object', async () => {
        await expect(load('string')).rejects.toThrow(LoadError)
        await expect(load(123)).rejects.toThrow(LoadError)
        await expect(load(true)).rejects.toThrow(LoadError)
      })

      test('throws LoadError for missing kind', async () => {
        await expect(load({
            name: 'no-kind',
            version: '1.0.0',
            title: 'No Kind',
          })).rejects.toThrow(LoadError)
        await expect(load({
            name: 'no-kind',
            version: '1.0.0',
            title: 'No Kind',
          })).rejects.toThrow(/missing or invalid "kind" field/)
      })

      test('throws LoadError for non-string kind', async () => {
        await expect(load({
            kind: 123,
            name: 'invalid-kind',
            version: '1.0.0',
            title: 'Invalid Kind',
          })).rejects.toThrow(LoadError)
      })

      test('throws LoadError for unknown kind', async () => {
        await expect(load({
            kind: 'unknown',
            name: 'unknown',
            version: '1.0.0',
            title: 'Unknown',
          })).rejects.toThrow(LoadError)
        await expect(load({
            kind: 'unknown',
            name: 'unknown',
            version: '1.0.0',
            title: 'Unknown',
          })).rejects.toThrow(/Unknown artifact kind: "unknown"/)
      })
    })
  })

  // ============================================================================
  // await safeLoad() Function
  // ============================================================================

  describe('await safeLoad()', () => {
    describe('success cases', () => {
      test('returns success for valid form object', async () => {
        const obj = {
          kind: 'form',
          name: 'safe-form',
          version: '1.0.0',
          title: 'Safe Form',
        }
        const result = await safeLoad(obj)

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.kind).toBe('form')
        }
      })

      test('returns success for all artifact kinds', async () => {
        const artifacts = [
          { kind: 'form', name: 'f', version: '1.0.0', title: 'F' },
          { kind: 'document', name: 'd', version: '1.0.0', title: 'D' },
          { kind: 'bundle', name: 'b', version: '1.0.0', title: 'B', contents: [] },
          { kind: 'checklist', name: 'cl', version: '1.0.0', title: 'CL', items: [] },
        ]

        for (const artifact of artifacts) {
          const result = await safeLoad(artifact)
          expect(result.success).toBe(true)
        }
      })
    })

    describe('error cases', () => {
      test('returns error for null', async () => {
        const result = await safeLoad(null)

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toBeInstanceOf(LoadError)
        }
      })

      test('returns error for missing kind', async () => {
        const result = await safeLoad({
          name: 'no-kind',
          version: '1.0.0',
          title: 'No Kind',
        })

        expect(result.success).toBe(false)
      })

      test('returns error for unknown kind', async () => {
        const result = await safeLoad({
          kind: 'unknown',
          name: 'unknown',
          version: '1.0.0',
          title: 'Unknown',
        })

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.message).toContain('Unknown artifact kind')
        }
      })

      test('returns error for validation failures', async () => {
        const result = await safeLoad({
          kind: 'form',
          name: '',
          version: '1.0.0',
          title: 'Empty Name',
        })

        expect(result.success).toBe(false)
      })
    })
  })

  // ============================================================================
  // LoadError Class
  // ============================================================================

  describe('LoadError', () => {
    test('has correct name', () => {
      const error = new LoadError('test message')
      expect(error.name).toBe('LoadError')
    })

    test('has correct message', () => {
      const error = new LoadError('test message')
      expect(error.message).toBe('test message')
    })

    test('stores cause', () => {
      const cause = new Error('original error')
      const error = new LoadError('wrapper message', cause)

      expect(error.cause).toBe(cause)
    })

    test('is instanceof Error', () => {
      const error = new LoadError('test')
      expect(error).toBeInstanceOf(Error)
    })

    test('is instanceof LoadError', () => {
      const error = new LoadError('test')
      expect(error).toBeInstanceOf(LoadError)
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('integration', () => {
    test('loaded instance has all expected methods', async () => {
      const instance = await load(formYAML) as FormInstance<any>

      // Base instance methods
      expect(typeof instance.validate).toBe('function')
      expect(typeof instance.isValid).toBe('function')
      expect(typeof instance.toJSON).toBe('function')
      expect(typeof instance.toYAML).toBe('function')
      expect(typeof instance.clone).toBe('function')

      // Form-specific methods
      expect(typeof instance.parseData).toBe('function')
      expect(typeof instance.safeParseData).toBe('function')
      expect(typeof instance.fill).toBe('function')
      expect(typeof instance.safeFill).toBe('function')
    })

    test('loaded instance can be cloned', async () => {
      const instance = await load(formYAML)
      const clone = instance.clone()

      expect(clone.name).toBe(instance.name)
      expect(clone).not.toBe(instance)
    })

    test('loaded instance can be serialized back to YAML', async () => {
      const instance = await load(formYAML)
      const yaml = instance.toYAML()

      expect(yaml).toContain('kind: form')
      expect(yaml).toContain('name: test-form')
    })

    test('loaded form can parse data', async () => {
      const instance = await load(formYAML) as FormInstance<any>
      const result = instance.safeParseData({ fields: { name: 'John' } })

      expect(result.success).toBe(true)
    })

    test('round-trip: YAML -> load -> toYAML -> load', async () => {
      const instance1 = await load(formYAML)
      const yaml = instance1.toYAML()
      const instance2 = await load(yaml)

      expect(instance2.kind).toBe(instance1.kind)
      expect(instance2.name).toBe(instance1.name)
      expect(instance2.title).toBe(instance1.title)
    })
  })
})
