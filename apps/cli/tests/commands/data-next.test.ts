import { runCli } from '../setup/spawn-cli'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { ASTERDOC_SCHEMA_URL } from '@asterdoc/schemas'

const appearance = {
  $schema: ASTERDOC_SCHEMA_URL,
  kind: 'form',
  name: 'appearance',
  version: '1.0.0',
  title: 'Notice of appearance',
  fields: {
    isAttorney: { type: 'boolean', label: 'Is an attorney', description: 'Part 2, Item 1.a', required: true },
    name: { type: 'text', label: 'Full name', required: true, maxLength: 40 },
    status: {
      type: 'enum',
      label: 'Subject to a restricting order',
      required: true,
      enum: [
        { value: 'am_not', label: 'Am not subject' },
        { value: 'am', label: 'Am subject' },
      ],
    },
    officeAddress: { type: 'address', label: 'Office address' },
    yearsInPractice: { type: 'number', label: 'Years in practice', min: 0, max: 70 },
    admittedOn: { type: 'date', label: 'Date admitted' },
    barNumber: { type: 'text', label: 'Bar number', visible: 'fields.isAttorney == true', required: 'fields.isAttorney == true' },
    licensingState: {
      type: 'enum',
      label: 'Licensing state',
      visible: 'fields.isAttorney == true',
      required: 'fields.isAttorney == true',
      enum: [
        { value: 'CA', label: 'California' },
        { value: 'OH', label: 'Ohio' },
      ],
    },
    orderDetails: { type: 'text', label: 'Order details', visible: 'fields.status == "am"', required: 'fields.status == "am"' },
    stateBarSection: { type: 'text', label: 'State bar section', visible: 'fields.licensingState == "CA"', required: 'fields.licensingState == "CA"' },
  },
  parties: {
    client: { label: 'Client', partyType: 'person', min: 1, max: 1 },
  },
  rules: {
    realName: { expr: 'fields.name != "Nobody"', severity: 'error', message: 'Give a real name' },
    longCareer: { expr: 'fields.yearsInPractice == null or fields.yearsInPractice <= 60', severity: 'warning', message: 'More than 60 years in practice is unusual' },
  },
}

const client = { client: { name: 'Elena Quintero' } }
const level0 = { isAttorney: true, name: 'Nadia Calloway', status: 'am' }

interface NextJson {
  form: string
  complete: boolean
  problems: Array<{ path: string; message: string }>
  rules: Array<{ path: string; message: string }>
  summary?: { requiredDone: number; requiredTotal: number }
  open?: Array<{ key: string; kind: string; required: boolean; type?: string; options?: unknown; constraints?: unknown; shape?: string; format?: string; description?: string; pages?: number[]; prints?: string[]; conditional?: boolean; input?: string }>
  waiting?: { count: number; on: string[] }
  warnings?: Array<{ ruleId: string; message: string }>
  pagesFrom?: { layer: string; path: string }
}

const blankPdf = [
  '%PDF-1.4',
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj',
  'trailer << /Root 1 0 R >>',
  '%%EOF',
].join('\n')

const boxesPdf = (names: string[]) => [
  '%PDF-1.4',
  `1 0 obj << /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${names.map((_, index) => `${index + 4} 0 R`).join(' ')}] >> >> endobj`,
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
  `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [${names.map((_, index) => `${index + 4} 0 R`).join(' ')}] >> endobj`,
  ...names.map((name, index) => `${index + 4} 0 obj << /FT /Tx /T (${name}) /Subtype /Widget /Rect [20 ${700 - index * 20} 300 ${714 - index * 20}] /P 3 0 R /DA (/Helv 10 Tf 0 g) >> endobj`),
  'trailer << /Root 1 0 R >>',
  '%%EOF',
].join('\n')

const NAME_BOXES = boxesPdf(['family', 'given', 'company'])

describe('asterdoc data next', () => {
  let dir: string
  let formFile: string

  const write = async (name: string, data: unknown) => {
    const file = path.join(dir, name)
    await fs.writeFile(file, JSON.stringify(data))
    return file
  }
  const next = async (data?: unknown) => {
    const args = ['data', 'next', formFile, '--json']
    if (data !== undefined) args.push('--data', await write('data.json', data))
    const result = await runCli(args)
    expect(result.exitCode, result.stderr).toBe(0)
    return JSON.parse(result.stdout) as NextJson
  }
  const keys = (output: NextJson) => output.open!.map((target) => target.key)

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'asterdoc-data-next-'))
    formFile = await write('appearance.json', appearance)
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('without data, gives the whole first batch and names the answers that more fields wait on', async () => {
    const output = await next()
    expect(keys(output)).toEqual(['client', 'isAttorney', 'name', 'status', 'officeAddress', 'yearsInPractice', 'admittedOn'])
    expect(output.open!.filter((target) => target.required).map((target) => target.key)).toEqual(['client', 'isAttorney', 'name', 'status'])
    expect(output.waiting).toEqual({ count: 4, on: ['isAttorney', 'status'] })
    expect(output.complete).toBe(false)
  })

  it('describes each field so a value can be matched to it: description, type, options, limits, shape and format', async () => {
    const open = (await next()).open!
    const target = (key: string) => open.find((entry) => entry.key === key)!
    expect(target('isAttorney')).toMatchObject({ type: 'boolean', description: 'Part 2, Item 1.a' })
    expect(target('status').options).toEqual([
      { value: 'am_not', label: 'Am not subject' },
      { value: 'am', label: 'Am subject' },
    ])
    expect(target('name').constraints).toEqual({ maxLength: 40 })
    expect(target('yearsInPractice').constraints).toEqual({ min: 0, max: 70 })
    expect(target('officeAddress').shape).toMatch(/^address: \{/)
    expect(target('admittedOn').format).toBe('YYYY-MM-DD')
    expect(target('client')).toMatchObject({ kind: 'party', type: 'person' })
  })

  it('opens the next level as a batch once the first answers are in the data file', async () => {
    const output = await next({ fields: level0, parties: client })
    expect(keys(output)).toEqual(['barNumber', 'licensingState', 'orderDetails', 'officeAddress', 'yearsInPractice', 'admittedOn'])
    expect(output.waiting).toEqual({ count: 1, on: ['licensingState'] })
    expect(output.summary).toMatchObject({ requiredDone: 4 })
  })

  it('opens a field two levels down only after the answer it depends on', async () => {
    const output = await next({ fields: { ...level0, barNumber: '0094127', licensingState: 'CA', orderDetails: 'Suspended in 2019' }, parties: client })
    expect(keys(output)).toEqual(['stateBarSection', 'officeAddress', 'yearsInPractice', 'admittedOn'])
    expect(output.complete).toBe(false)
  })

  it('reports complete when no required field is open and every rule passes, with the optional fields still listed', async () => {
    const output = await next({ fields: { isAttorney: false, name: 'Nadia Calloway', status: 'am_not' }, parties: client })
    expect(output.complete).toBe(true)
    expect(keys(output)).toEqual(['officeAddress', 'yearsInPractice', 'admittedOn'])
    expect(output.open!.every((target) => !target.required)).toBe(true)
  })

  it('lists an unmet rule and is not complete while it fails', async () => {
    const output = await next({ fields: { isAttorney: false, name: 'Nobody', status: 'am_not' }, parties: client })
    expect(output.complete).toBe(false)
    expect(output.rules).toEqual([{ path: 'rules.realName', message: 'Give a real name' }])
  })

  it('lists a warning rule that fails and stays complete, and lists none when the rule passes', async () => {
    const fields = { isAttorney: false, name: 'Nadia Calloway', status: 'am_not' }
    const warned = await next({ fields: { ...fields, yearsInPractice: 65 }, parties: client })
    expect(warned.complete).toBe(true)
    expect(warned.rules).toEqual([])
    expect(warned.warnings).toEqual([{ ruleId: 'longCareer', message: 'More than 60 years in practice is unusual' }])
    expect((await next({ fields: { ...fields, yearsInPractice: 12 }, parties: client })).warnings).toEqual([])
  })

  it('prints a failed warning rule in the text output, and no warning section when none fails', async () => {
    const fields = { isAttorney: false, name: 'Nadia Calloway', status: 'am_not' }
    const text = async (years: number) => {
      const dataFile = await write('data.json', { fields: { ...fields, yearsInPractice: years }, parties: client })
      const result = await runCli(['data', 'next', formFile, '--data', dataFile])
      expect(result.exitCode, result.stderr).toBe(0)
      return result.stdout
    }
    const warned = await text(65)
    expect(warned).toContain('Warnings (the form accepts these values, but each is probably wrong: check it against the facts):')
    expect(warned).toContain('  - rules.longCareer: More than 60 years in practice is unusual')
    expect(warned).toContain('Ready to render, with 2 optional targets still open')
    expect(warned).toContain('Correct each value under Warnings, or keep it and name it in your report.')
    const clean = await text(12)
    expect(clean).toContain('Ready to render, with 2 optional targets still open')
    expect(clean).not.toContain('Warnings')
  })

  it('names a value given for a field that does not apply, with the condition, and is not complete while it is there', async () => {
    const fields = { isAttorney: false, name: 'Nadia Calloway', status: 'am_not' }
    const output = await next({ fields: { ...fields, barNumber: '254301' }, parties: client })
    expect(output.complete).toBe(false)
    expect(output.problems).toEqual([
      { path: 'fields.barNumber', message: 'A value is given, but this field does not apply. It applies when: fields.isAttorney == true' },
    ])
    expect(keys(output)).toEqual(['officeAddress', 'yearsInPractice', 'admittedOn'])
    const applies = await next({ fields: { ...fields, isAttorney: true, barNumber: '254301', licensingState: 'OH' }, parties: client })
    expect(applies.problems).toEqual([])
    expect(applies.complete).toBe(true)
  })

  it('refuses to render a form that has a value for a field that does not apply', async () => {
    const data = await write('data.json', { fields: { isAttorney: false, name: 'Nadia Calloway', status: 'am_not', barNumber: '254301' }, parties: client })
    await write('appearance.json', { ...appearance, layers: { text: { kind: 'inline', mimeType: 'text/plain', text: '{{fields.name}}' } }, defaultLayer: 'text' })
    const result = await runCli(['render', formFile, '--data', data, '--out', path.join(dir, 'out.txt')])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('fields.barNumber: A value is given, but this field does not apply. It applies when: fields.isAttorney == true')
  })

  describe('with a PDF layer that prints the client name in parts', () => {
    const fields = { isAttorney: false, name: 'Nadia Calloway', status: 'am_not' }
    const splitName = { family: 'parties.client.lastName', given: 'parties.client.firstName' }
    const problem = {
      path: 'parties.client',
      message: 'The "pdf" layer prints this party\'s name from lastName and firstName, and the party gives none of them. Its name would not print. Give them next to name.',
    }

    beforeEach(async () => {
      await fs.writeFile(path.join(dir, 'appearance.pdf'), NAME_BOXES)
      await write('appearance.json', { ...appearance, layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: 'appearance.pdf', bindings: splitName } }, defaultLayer: 'pdf' })
    })

    it('says on the open party which members the form prints', async () => {
      expect((await next()).open!.find((target) => target.key === 'client')!.prints).toEqual(['lastName', 'firstName'])
      const text = await runCli(['data', 'next', formFile])
      expect(text.stdout).toContain('      prints: lastName, firstName (the form prints these: give each one)')
    })

    it('names a party that gives only a full name as a problem, and is not complete until the parts are given', async () => {
      const nameOnly = await next({ fields, parties: client })
      expect(nameOnly.complete).toBe(false)
      expect(nameOnly.problems).toEqual([problem])
      const withParts = await next({ fields, parties: { client: { name: 'Elena Quintero', firstName: 'Elena', lastName: 'Quintero' } } })
      expect(withParts.problems).toEqual([])
      expect(withParts.complete).toBe(true)
    })

    it('refuses to render a party that gives only a full name', async () => {
      const data = await write('data.json', { fields, parties: client })
      const result = await runCli(['render', formFile, '--data', data, '--out', path.join(dir, 'out.pdf')])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain(`${problem.path}: ${problem.message}`)
    })
  })

  describe('with a party that can be a person or an organization, on a PDF layer that prints the name parts and the legal name', () => {
    const fields = { isAttorney: false, name: 'Nadia Calloway', status: 'am_not' }
    const boxes = { family: 'parties.client.lastName', given: 'parties.client.firstName', company: 'parties.client.legalName' }

    beforeEach(async () => {
      await fs.writeFile(path.join(dir, 'appearance.pdf'), NAME_BOXES)
      await write('appearance.json', {
        ...appearance,
        parties: { client: { label: 'Client', partyType: 'any', min: 1, max: 1 } },
        layers: { pdf: { kind: 'file', mimeType: 'application/pdf', path: 'appearance.pdf', bindings: boxes } },
        defaultLayer: 'pdf',
      })
    })

    it('gives both shapes, says how the kind is read, and asks only for the printed members that the kind has', async () => {
      const text = (await runCli(['data', 'next', formFile])).stdout
      expect(text).toMatch(/\n {2}\[required\] client \(party, any[^\n]*\): Client\n {6}shape: person: \{[^\n]*firstName[^\n]*\} or organization: \{[^\n]*legalName[^\n]*\}\n/)
      expect(text).toContain('      prints: lastName, firstName, legalName (the form prints these: give each one that the kind of the party has)\n')
      expect(text).toContain('      input: The members say which kind the party is. For an organization give `legalName` next to `name`')
    })

    it('is complete for an organization that gives its legal name, and names an organization that gives only a name as a problem', async () => {
      const company = await next({ fields, parties: { client: { name: 'Larkmoor Foods', legalName: 'Larkmoor Foods LLC' } } })
      expect(company.problems).toEqual([])
      expect(company.complete).toBe(true)
      const nameOnly = await next({ fields, parties: { client: { name: 'Larkmoor Foods' } } })
      expect(nameOnly.complete).toBe(false)
      expect(nameOnly.problems).toEqual([
        {
          path: 'parties.client',
          message: 'The "pdf" layer prints this party\'s name from lastName, firstName and legalName, and the party gives none of them. Its name would not print. Give them next to name.',
        },
      ])
    })
  })

  it('stops on a value the form refuses and names the field, without a batch', async () => {
    const output = await next({ fields: { status: 'maybe' } })
    expect(output.complete).toBe(false)
    expect(output.problems.map((problem) => problem.path)).toEqual(['fields.status'])
    expect(output.open).toBeUndefined()
  })

  it('prints the batch as text by default, with the command for the next pass', async () => {
    const result = await runCli(['data', 'next', formFile, '--data', await write('data.json', { fields: level0, parties: client })])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[required] barNumber (text): Bar number')
    expect(result.stdout).toContain('options: "CA" = California; "OH" = Ohio')
    expect(result.stdout).toContain('Waiting: 1 more can open after answers to: licensingState.')
    expect(result.stdout).toContain(`Next: add the values to ${path.join(dir, 'data.json')} and run: asterdoc data next ${formFile} --data ${path.join(dir, 'data.json')}`)
  })

  describe('the text output', () => {
    const done = { isAttorney: false, name: 'Nadia Calloway', status: 'am_not' }
    const everyOptional = { officeAddress: { line1: '1 Main St', locality: 'Columbus', region: 'OH', postalCode: '43215', country: 'US' }, yearsInPractice: 12, admittedOn: '2014-05-01' }
    const text = async (data?: unknown, ...flags: string[]) => {
      const args = ['data', 'next', formFile, ...flags]
      if (data !== undefined) args.push('--data', await write('data.json', data))
      const result = await runCli(args)
      expect(result.exitCode, result.stderr).toBe(0)
      return result.stdout
    }
    const secondLine = (output: string) => output.split('\n')[1]

    it('says in its second line that the data is not ready while a required target is open or a rule is not met', async () => {
      expect(secondLine(await text())).toBe('Not ready to render: 4 required targets are open.')
      expect(secondLine(await text({ fields: { ...done, name: 'Nobody' }, parties: client }))).toBe('Not ready to render: 1 rule is not met.')
      expect(secondLine(await text({ fields: { isAttorney: false, status: 'am_not' }, parties: client }))).toBe('Not ready to render: 1 required target is open.')
    })

    it('does not call the data complete while an optional target is open', async () => {
      const ready = await text({ fields: done, parties: client })
      expect(secondLine(ready)).toBe('Ready to render, with 3 optional targets still open: fill each one you have a fact for first.')
      expect(ready).not.toContain('Complete')
      const complete = await text({ fields: { ...done, ...everyOptional }, parties: client })
      expect(secondLine(complete)).toBe('Complete: no target is open and every rule passes.')
      expect(complete).not.toContain('Open now')
    })

    it('with data, gives one line to an optional target that no answer opened, and describes the others in full', async () => {
      const output = await text({ fields: level0, parties: client })
      expect(output).toContain('In short form (3): the optional targets that no answer opened.')
      expect(output).toContain('  officeAddress (address): Office address\n  yearsInPractice (number): Years in practice\n  admittedOn (date): Date admitted\n')
      expect(output).not.toContain('shape: address')
      expect(output).toContain('  [required] licensingState (enum): Licensing state\n      options: "CA" = California; "OH" = Ohio')
    })

    it('describes in full an optional target that an answer opened', async () => {
      formFile = await write('appearance.json', { ...appearance, fields: { ...appearance.fields, firmName: { type: 'text', label: 'Firm name', maxLength: 60, visible: 'fields.isAttorney == true' } } })
      const output = await text({ fields: level0, parties: client })
      expect(output).toContain('  firmName (text): Firm name\n      limits: maxLength 60')
      expect(output.indexOf('firmName')).toBeLessThan(output.indexOf('In short form'))
    })

    it('describes every open target in full without data, and with --full', async () => {
      const first = await text()
      expect(first).not.toContain('In short form')
      expect(first).toContain('shape: address')
      const full = await text({ fields: level0, parties: client }, '--full')
      expect(full).not.toContain('In short form')
      expect(full).toContain('shape: address')
      expect(full).toContain('format: YYYY-MM-DD')
    })

    it('prints the fields of each row under a list whose rows are objects, and only the row type for a list of plain values', async () => {
      const children = {
        type: 'list',
        label: 'Children',
        maxItems: 2,
        item: {
          type: 'fieldset',
          fields: {
            familyName: { type: 'text', label: 'Family name', required: true, maxLength: 47 },
            relation: { type: 'enum', label: 'Relation', enum: [{ value: 'child', label: 'Child' }, { value: 'stepchild', label: 'Stepchild' }] },
          },
        },
      }
      formFile = await write('appearance.json', { ...appearance, fields: { ...appearance.fields, children, nicknames: { type: 'list', label: 'Nicknames', item: { type: 'text' } } } })
      const output = await text()
      expect(output).toContain([
        '  children (list): Children',
        '      limits: maxItems 2',
        '      rows: one object for each row, with these fields:',
        '        [required] familyName (text): Family name',
        '            limits: maxLength 47',
        '        relation (enum): Relation',
        '            options: "child"; "stepchild"',
        '',
      ].join('\n'))
      expect(output).toContain('  nicknames (list): Nicknames\n      rows: text\n')
      expect(await text({ fields: { ...done, children: [{ familyName: 'Calloway', relation: 'child' }] }, parties: client })).not.toContain('Problems in the data')
    })

    it('names the draft render for data that is not ready, and not before the first values or while a value is refused', async () => {
      const draft = 'render a draft and name each open item in your report: asterdoc render'
      expect(await text({ fields: level0, parties: client })).toContain(draft)
      expect(await text()).not.toContain(draft)
      expect(await text({ fields: { ...done, barNumber: '254301' }, parties: client })).not.toContain(draft)
      expect(await text({ fields: done, parties: client })).not.toContain('--draft')
    })

    it('writes an option whose label repeats its value once, and a long option list with one option to a line', async () => {
      const states = ['AK', 'AL', 'AR'].map((value) => ({ value, label: value }))
      const reasons = Array.from({ length: 12 }, (_, index) => ({ value: `reason_${index}`, label: `Reason ${index}: a statement long enough to fill the line` }))
      formFile = await write('appearance.json', { ...appearance, fields: { ...appearance.fields, state: { type: 'enum', label: 'State', enum: states }, reason: { type: 'enum', label: 'Reason', enum: reasons } } })
      const output = await text()
      expect(output).toContain('      options: "AK"; "AL"; "AR"\n')
      expect(output).toContain('      options:\n        "reason_0" = Reason 0: a statement long enough to fill the line\n        "reason_1" = ')
    })

    it('marks only the required targets, and says once that every other target is optional', async () => {
      const output = await text()
      expect(output).toContain('A target marked [required] must have a value. Every other target is optional.\n')
      expect(output).toContain('\n  [required] name (text): Full name\n')
      expect(output).toContain('\n  officeAddress (address): Office address\n')
      expect(output).not.toContain('[optional]')
    })

    it('prints a long option list in full once, and refers to it from each later target with the same list', async () => {
      const codes = Array.from({ length: 30 }, (_, index) => ({ value: `S${index}` }))
      const state = (label: string) => ({ type: 'enum', label, enum: codes })
      const yesNo = (label: string) => ({ type: 'enum', label, enum: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] })
      formFile = await write('appearance.json', { ...appearance, fields: { ...appearance.fields, homeState: state('Home state'), workState: state('Work state'), sworn: yesNo('Sworn'), served: yesNo('Served') } })
      const output = await text()
      expect(output).toContain('  homeState (enum): Home state\n      options: "S0"; "S1"; ')
      expect(output).toContain('  workState (enum): Work state\n      options: the same as homeState\n')
      expect(output).toContain('  sworn (enum): Sworn\n      options: "yes"; "no"\n  served (enum): Served\n      options: "yes"; "no"\n')
      const later = await text({ fields: { ...done, homeState: 'S1' }, parties: client }, '--full')
      expect(later).toContain('  workState (enum): Work state\n      options: "S0"; "S1"; ')
    })

    it('says that a role with room for several parties takes a list, and refuses one party given as an object', async () => {
      formFile = await write('appearance.json', { ...appearance, parties: { ...appearance.parties, witnesses: { label: 'Witnesses', partyType: 'person', min: 0, max: 3 } } })
      const first = await text()
      expect(first).toContain('\n  witnesses (party, person): Witnesses\n')
      expect(first).toContain('      list: this role takes a list: write an array with one person object for each party\n')
      expect(first).toContain('      limits: maxItems 3\n')
      expect(first.split('[required] client (party, person)')[1]!.split('[')[0]).not.toContain('list:')
      const refused = await text({ fields: done, parties: { ...client, witnesses: { name: 'Omar Haddad' } } })
      expect(refused).toContain('parties.witnesses')
      expect(await text({ fields: done, parties: { ...client, witnesses: [{ name: 'Omar Haddad' }] } })).not.toContain('Problems in the data')
    })

    it('says how to write a telephone number', async () => {
      formFile = await write('appearance.json', { ...appearance, fields: { ...appearance.fields, phone: { type: 'phone', label: 'Daytime telephone' } } })
      expect(await text()).toContain('      input: `number` is the full international number with no spaces or marks: +, the country code, the national number (+12154852665).')
      const refused = await text({ fields: { phone: { number: '6145550142' } } })
      expect(refused).toContain('  - fields.phone.number: Must be the full international number with no spaces or marks: +, the country code, the national number, such as +14155552671')
      expect(await text({ fields: { phone: { number: '+16145550142' } } })).not.toContain('Problems in the data')
    })
  })

  it('marks in the JSON output the targets that an answer opened', async () => {
    const output = await next({ fields: level0, parties: client })
    expect(Object.fromEntries(output.open!.map((target) => [target.key, target.conditional === true]))).toEqual({
      barNumber: true,
      licensingState: true,
      orderDetails: true,
      officeAddress: false,
      yearsInPractice: false,
      admittedOn: false,
    })
  })

  describe('with a PDF layer', () => {
    const twoPagePdf = [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R 7 0 R 8 0 R] >> >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [5 0 R 6 0 R] >> endobj',
      '4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [7 0 R 8 0 R] >> endobj',
      '5 0 obj << /FT /Tx /T (full_name) /Subtype /Widget /Rect [72 700 300 720] /P 3 0 R >> endobj',
      '6 0 obj << /FT /Tx /T (client_name) /Subtype /Widget /Rect [72 660 300 680] /P 3 0 R >> endobj',
      '7 0 obj << /FT /Tx /T (office_city) /Subtype /Widget /Rect [72 700 300 720] /P 4 0 R >> endobj',
      '8 0 obj << /FT /Tx /T (years) /Subtype /Widget /Rect [72 660 300 680] /P 4 0 R >> endobj',
      'trailer << /Root 1 0 R >>',
      '%%EOF',
    ].join('\n')
    const bindings = {
      full_name: 'name',
      client_name: 'parties.client.name',
      office_city: { template: '{{fields.officeAddress.locality}}, {{fields.officeAddress.region}}' },
      years: 'yearsInPractice',
    }
    const pdfLayer = (file: string) => ({ kind: 'file', mimeType: 'application/pdf', path: file, bindings })
    const withLayers = (layers: Record<string, unknown>, defaultLayer?: string) => ({ ...appearance, layers, ...(defaultLayer && { defaultLayer }) })
    const pagesOf = (output: NextJson) => Object.fromEntries(output.open!.map((target) => [target.key, target.pages]))

    beforeEach(async () => {
      await fs.writeFile(path.join(dir, 'appearance.pdf'), twoPagePdf)
      formFile = await write('appearance.json', withLayers({ pdf: pdfLayer('appearance.pdf') }))
    })

    it('says which page of the PDF each open field prints on, and leaves the artifact file as it was', async () => {
      const before = await fs.readFile(formFile, 'utf8')
      const output = await next()
      expect(output.pagesFrom).toEqual({ layer: 'pdf', path: 'appearance.pdf' })
      expect(pagesOf(output)).toEqual({
        client: [1],
        isAttorney: undefined,
        name: [1],
        status: undefined,
        officeAddress: [2],
        yearsInPractice: [2],
        admittedOn: undefined,
      })
      expect(await fs.readFile(formFile, 'utf8')).toBe(before)
    })

    it('prints the page beside the type in the text form', async () => {
      const result = await runCli(['data', 'next', formFile])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('A page is where the value prints in appearance.pdf.')
      expect(result.stdout).toContain('[required] name (text, page 1): Full name')
      expect(result.stdout).toContain('[required] client (party, person, page 1): Client')
      expect(result.stdout).toContain('\n  officeAddress (address, page 2): Office address')
      expect(result.stdout).toContain('[required] isAttorney (boolean): Is an attorney')
    })

    it('shows no pages for a form with no PDF layer, or whose PDF file is not there', async () => {
      formFile = await write('appearance.json', appearance)
      const plain = await next()
      expect(plain.pagesFrom).toBeUndefined()
      expect(Object.values(pagesOf(plain)).every((pages) => pages === undefined)).toBe(true)

      formFile = await write('appearance.json', withLayers({ pdf: pdfLayer('missing.pdf') }))
      const missing = await runCli(['data', 'next', formFile])
      expect(missing.exitCode).toBe(1)
      expect(missing.stderr).toContain('Layer "pdf" could not be read from "missing.pdf"')
    })

    it('with several PDF layers, reads the default layer, or the one --layer names', async () => {
      await fs.writeFile(path.join(dir, 'copy.pdf'), twoPagePdf)
      const copy = { kind: 'file', mimeType: 'application/pdf', path: 'copy.pdf', bindings: { years: 'name' } }
      formFile = await write('appearance.json', withLayers({ pdf: pdfLayer('appearance.pdf'), copy }, 'pdf'))
      expect((await next()).pagesFrom).toEqual({ layer: 'pdf', path: 'appearance.pdf' })

      const named = await runCli(['data', 'next', formFile, '--json', '--layer', 'copy'])
      const output = JSON.parse(named.stdout) as NextJson
      expect(output.pagesFrom).toEqual({ layer: 'copy', path: 'copy.pdf' })
      expect(pagesOf(output).name).toEqual([2])

      formFile = await write('appearance.json', withLayers({ pdf: pdfLayer('appearance.pdf'), copy }))
      expect((await next()).pagesFrom).toBeUndefined()
    })

    it('refuses a --layer that is not a PDF layer, or whose file cannot be read', async () => {
      const unknown = await runCli(['data', 'next', formFile, '--layer', 'markdown'])
      expect(unknown.exitCode).toBe(1)
      expect(unknown.stderr).toContain('Layer "markdown" is not a PDF layer of this form. PDF layers: pdf.')

      formFile = await write('appearance.json', withLayers({ pdf: pdfLayer('missing.pdf') }))
      const unreadable = await runCli(['data', 'next', formFile, '--layer', 'pdf'])
      expect(unreadable.exitCode).toBe(1)
      expect(unreadable.stderr).toContain('Layer "pdf" could not be read from "missing.pdf"')
    })
  })

  it('refuses an artifact that is not a form', async () => {
    const file = await write('checklist.json', { $schema: ASTERDOC_SCHEMA_URL, kind: 'checklist', name: 'list', version: '1.0.0', title: 'List', items: [] })
    const result = await runCli(['data', 'next', file])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Expected form artifact')
  })
})
