#!/usr/bin/env node
import { processIo } from './io'
import { run } from './main'

run(process.argv.slice(2), processIo()).then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    console.error(error)
    process.exitCode = 1
  },
)
