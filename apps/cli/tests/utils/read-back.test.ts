import { describe, expect, it } from 'vitest'
import type { FormExtraction } from '@asterdoc/core'
import { readBack, readBackLines, readBackPasses } from '../../src/utils/read-back.js'

type Entry = FormExtraction['report']['entries'][number]

const extraction = (data: FormExtraction['data'], entries: Array<Partial<Entry> & Pick<Entry, 'path' | 'status'>>): FormExtraction => ({
  layer: 'pdf',
  data,
  report: { entries: entries.map((entry) => ({ sources: [], ...entry })), unbound: [] },
})

describe('readBack', () => {
  it('counts a value the PDF holds that equals the data, in fields, list rows and parties', () => {
    const result = readBack(
      extraction(
        { fields: { city: 'Kumasi', children: [{ familyName: 'Amankwah' }] }, parties: { applicant: { firstName: 'Kwesi' } } },
        [
          { path: 'city', status: 'recovered', lossy: false },
          { path: 'children[0].familyName', status: 'recovered', lossy: false },
          { path: 'parties.applicant.firstName', status: 'recovered', lossy: false },
        ],
      ),
      { fields: { city: 'Kumasi', children: [{ familyName: 'Amankwah' }] }, parties: { applicant: { id: 'applicant-0', name: 'Kwesi Amankwah', firstName: 'Kwesi' } } },
    )
    expect(result).toEqual({ equal: 3, differ: [], notPrinted: [], unreadable: [], notCompared: [] })
    expect(readBackPasses(result)).toBe(true)
    expect(readBackLines('filled.pdf', result)).toEqual(['Read back from filled.pdf: 3 values equal the data.'])
  })

  it('names a value the PDF holds that is not the value the data gives', () => {
    const result = readBack(extraction({ fields: { city: 'Accra' } }, [{ path: 'city', status: 'recovered', lossy: false }]), { fields: { city: 'Kumasi' } })
    expect(result.differ).toEqual([{ path: 'city', given: 'Kumasi', read: 'Accra' }])
    expect(readBackPasses(result)).toBe(false)
    expect(readBackLines('filled.pdf', result)).toEqual([
      'Read back from filled.pdf: 0 values equal the data, 1 differs.',
      '  Differ (the data has one value, the PDF holds another):',
      '    - city: data "Kumasi", PDF "Accra"',
    ])
  })

  it('takes a difference of case as equal only when the print drops case', () => {
    const data = { fields: { city: 'Kumasi' } }
    expect(readBack(extraction({ fields: { city: 'KUMASI' } }, [{ path: 'city', status: 'recovered', lossy: true }]), data).equal).toBe(1)
    expect(readBack(extraction({ fields: { city: 'KUMASI' } }, [{ path: 'city', status: 'recovered', lossy: false }]), data).differ).toHaveLength(1)
  })

  it('names a value the data gives whose box is empty, and passes an empty box for false or for no value', () => {
    const result = readBack(
      extraction({ fields: {} }, [
        { path: 'city', status: 'empty' },
        { path: 'hasPet', status: 'empty' },
        { path: 'nickname', status: 'empty' },
      ]),
      { fields: { city: 'Kumasi', hasPet: false } },
    )
    expect(result.notPrinted).toEqual(['city'])
    expect(readBackPasses(result)).toBe(false)
    expect(readBackLines('filled.pdf', result)).toContain('  Did not print (the data has a value, the box is empty):')
  })

  it('names a box whose text cannot be read as a value, with the reason', () => {
    const result = readBack(extraction({ fields: {} }, [{ path: 'born', status: 'unparseable', reason: 'The date parts name no calendar date.' }]), { fields: { born: '2020-02-30' } })
    expect(result.unreadable).toEqual([{ path: 'born', reason: 'The date parts name no calendar date.' }])
    expect(readBackPasses(result)).toBe(false)
  })

  it('does not count as a fault a value that prints in a form that does not read back, and shows what the box holds', () => {
    const reason = 'A phone number is joined back only with its countryCode, which is not bound.'
    const result = readBack(
      extraction({ fields: {} }, [
        { path: 'phone', status: 'not_recoverable', reason, sources: [{ field: 'Phone[0]', value: '6145550142' }] },
        { path: 'fax', status: 'not_recoverable', reason, sources: [{ field: 'Fax[0]' }] },
      ]),
      { fields: { phone: { number: '+16145550142' } } },
    )
    expect(result.notCompared).toEqual([{ path: 'phone', holds: ['6145550142'] }])
    expect(readBackPasses(result)).toBe(true)
    expect(readBackLines('filled.pdf', result)).toEqual([
      'Read back from filled.pdf: 0 values equal the data.',
      '  Not compared (1): it prints in a form that does not read back as one value. This is not a fault.',
      '    - phone: the PDF holds "6145550142"',
    ])
  })

  it('does not compare a value the form computes, which the data does not give', () => {
    const result = readBack(extraction({ fields: { total: 12 } }, [{ path: 'total', status: 'recovered', lossy: false }]), { fields: {} })
    expect(result).toEqual({ equal: 0, differ: [], notPrinted: [], unreadable: [], notCompared: [] })
  })
})
