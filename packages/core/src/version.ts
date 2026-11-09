declare const __ASTERDOC_CORE_VERSION__: string | undefined

/** The version of `@asterdoc/core` this build is, or `dev` when run from source. */
export const CORE_VERSION: string = typeof __ASTERDOC_CORE_VERSION__ !== 'undefined' ? __ASTERDOC_CORE_VERSION__ : 'dev'
