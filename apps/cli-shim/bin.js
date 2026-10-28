#!/usr/bin/env node
process.env.ASTERDOC_CLI_PACKAGE = 'asterdoc'
await import('@asterdoc/cli/dist/index.js')
