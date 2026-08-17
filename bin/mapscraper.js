#!/usr/bin/env node
const { createCli } = require('../src/cli');

const program = createCli();
program.parse(process.argv);
