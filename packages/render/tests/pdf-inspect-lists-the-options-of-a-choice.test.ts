import { describe, expect, it } from 'vitest'
import { inspectAcroFormFields } from '../src/pdf/inspect'
import { acroFormPdf } from './pdf-fixtures'

const pdf = acroFormPdf([
  { kind: 'text', name: 'name' },
  { kind: 'checkbox', name: 'agree' },
  { kind: 'choice', name: 'status', options: [['F1', 'F1 - STUDENT - ACADEMIC'], ['B2', 'B2 - VISITOR FOR PLEASURE']] },
  { kind: 'choice', name: 'state', options: ['CA', 'OH'] },
  { kind: 'radio', name: 'filing', states: ['single', 'joint'] },
])

const field = async (name: string) => (await inspectAcroFormFields(pdf)).find((entry) => entry.name === name)!

describe('the options of a PDF field in an inspection', () => {
  it('give the value a dropdown stores and the text it shows', async () => {
    expect((await field('status')).options).toEqual([
      { value: 'F1', label: 'F1 - STUDENT - ACADEMIC' },
      { value: 'B2', label: 'B2 - VISITOR FOR PLEASURE' },
    ])
  })

  it('give the one text as value and label when the dropdown stores what it shows', async () => {
    expect((await field('state')).options).toEqual([{ value: 'CA', label: 'CA' }, { value: 'OH', label: 'OH' }])
  })

  it('give the on state of each button of a radio group', async () => {
    expect((await field('filing')).options).toEqual([{ value: 'single', label: 'single' }, { value: 'joint', label: 'joint' }])
  })

  it('are absent for a text field and for a checkbox', async () => {
    expect(await field('name')).not.toHaveProperty('options')
    expect(await field('agree')).not.toHaveProperty('options')
  })

})
