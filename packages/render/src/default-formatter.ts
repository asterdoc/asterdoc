import { createFormatter } from '@asterdoc/format'
import { phoneProvider } from '@asterdoc/format/phone'
import type { Formatter } from '@asterdoc/types'

/**
 * The formatter every renderer uses when the caller passes none: the
 * `@asterdoc/format` defaults, with every lookup provider, so each layer
 * format an artifact can declare prints.
 */
export const defaultFormatter: Formatter = createFormatter({ providers: { phone: phoneProvider } })
