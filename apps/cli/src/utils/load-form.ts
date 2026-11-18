import { form, type Form, type FormInstance } from '@asterdoc/core'
import { createFsResolver } from '@asterdoc/resolvers/fs'

/** Load a form read from a file: its PDF layers are read from the file's folder. */
export function loadFormFile(definition: Form, baseDir: string): Promise<FormInstance<Form>> {
  return form.load(definition, { resolver: createFsResolver({ root: baseDir }) })
}
