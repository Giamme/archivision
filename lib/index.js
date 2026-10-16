'use strict';
// Archivision as a library: the same steps the CLI runs.
const { scanRepo } = require('./repo/scan');
const { autoMap } = require('./repo/automap');
const { buildRepo } = require('./repo/build');
const { readInputs } = require('./arch/inputs');
const { generate } = require('./arch/ai');
const { validate, archToScene } = require('./arch/model');
const { ARCH_SCHEMA } = require('./arch/schema');
const { renderPage, writePage } = require('./page');
const { SCAN_SCHEMA, validateScan } = require('./scan-schema');

module.exports = { scanRepo, SCAN_SCHEMA, validateScan, autoMap, buildRepo, readInputs, generate, validate, archToScene, ARCH_SCHEMA, renderPage, writePage };
