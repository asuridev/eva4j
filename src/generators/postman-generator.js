'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const crypto = require('crypto');

const { parseDomainYaml } = require('../utils/yaml-to-entity');
const { renderTemplate } = require('../utils/template-engine');
const { toKebabCase, toCamelCase, toPackagePath } = require('../utils/naming');
const { initSeed, generateFakeValue, generateFakeBody, generateFakeId } = require('../utils/fake-data');

const TEMPLATES_DIR = path.join(__dirname, '../../templates/postman');

// Audit / internal fields excluded from command bodies
const EXCLUDED_FIELDS = new Set([
  'id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'deletedAt',
]);

/**
 * Determine which aggregate an operation belongs to based on use case naming.
 * E.g. "CreateProduct" → "Product", "FindAllCategorys" → "Category".
 *
 * @param {string} useCase      - e.g. "CreateProduct"
 * @param {Array}  aggregates   - parsed aggregates with `.name`
 * @returns {string|null}       - aggregate name or null
 */
function resolveOwnerAggregate(useCase, aggregates) {
  const ucLower = useCase.toLowerCase();
  // Sort longest name first so "UserProfile" matches before "User"
  const sorted = [...aggregates].sort((a, b) => b.name.length - a.name.length);
  for (const agg of sorted) {
    if (ucLower.includes(agg.name.toLowerCase())) return agg.name;
  }
  return null;
}

/**
 * Generate a unified Postman collection covering every module in the system.
 *
 * @param {Object}   opts
 * @param {string}   opts.projectDir     - Absolute path to the project root
 * @param {string}   opts.systemDir      - Absolute path to the system/ directory
 * @param {string}   opts.packageName    - Full Java package name (e.g. "com.example.myapp")
 * @param {Object}   opts.systemConfig   - Parsed system.yaml object
 * @param {Object}   opts.projectConfig  - Parsed .eva4j.json project config
 * @returns {Promise<string|null>}       - Path to the generated file, or null on error
 */
async function generateUnifiedPostmanCollection({
  projectDir,
  systemDir,
  packageName,
  systemConfig,
  projectConfig,
}) {
  const systemName = systemConfig.system?.name || projectConfig.projectName || projectConfig.artifactId || 'eva4j-app';
  const port = projectConfig.server?.port || 8040;
  const modules = systemConfig.modules || [];

  if (!modules.length) return null;

  // Seed faker for deterministic output
  initSeed(42);

  // ── Collect module contexts ───────────────────────────────────────────────
  const moduleContexts = [];

  for (const mod of modules) {
    const yamlPath = path.join(systemDir, `${mod.name}.yaml`);
    if (!(await fs.pathExists(yamlPath))) continue;

    let parsed;
    try {
      parsed = await parseDomainYaml(yamlPath, packageName, mod.name);
    } catch (err) {
      console.log(chalk.yellow(`  ⚠️  Could not parse ${mod.name}.yaml for Postman: ${err.message}`));
      continue;
    }

    const { aggregates, allEnums, endpoints } = parsed;
    const aggregateContexts = [];

    for (const agg of aggregates) {
      const rootEntity = agg.rootEntity;
      const idField = rootEntity.fields.find(f => f.name === 'id');
      const idType = idField ? idField.javaType : 'String';
      const exampleId = generateFakeId(idType);
      const trackUser = rootEntity.audit?.trackUser === true;
      const valueObjects = agg.valueObjects || [];

      // Command fields: exclude id, audit, readOnly, deletedAt
      const commandFields = rootEntity.fields.filter(
        f => !EXCLUDED_FIELDS.has(f.name) && !f.readOnly
      );

      // Build fake body for create/update
      const defaultBody = generateFakeBody(commandFields, [], allEnums, valueObjects);

      if (endpoints && endpoints.versions && endpoints.versions.length > 0) {
        // ── Endpoint-driven ───────────────────────────────────────────────
        const operations = [];
        const bodies = {};

        for (const version of endpoints.versions) {
          for (const op of version.operations) {
            // Classify operation → which aggregate it belongs to
            const owner = resolveOwnerAggregate(op.useCase, aggregates);
            if (owner && owner !== agg.name) continue;
            // If no aggregate could be resolved, assign to the first aggregate
            if (!owner && agg !== aggregates[0]) continue;

            const basePath = endpoints.basePath || '/';
            operations.push({
              useCase: op.useCase,
              method: op.method,
              path: op.path || '/',
              basePath,
              version: version.version,
            });

            // Generate body for write operations
            if (op.method === 'POST' || op.method === 'PUT' || op.method === 'PATCH') {
              // Re-seed per operation so bodies vary
              bodies[op.useCase] = generateFakeBody(commandFields, [], allEnums, valueObjects);
            }
          }
        }

        aggregateContexts.push({
          name: agg.name,
          trackUser,
          idType,
          exampleId,
          resourceNameKebab: toKebabCase(agg.name),
          operations,
          defaultCrud: false,
          bodies,
        });
      } else {
        // ── Default CRUD (no endpoints section) ──────────────────────────
        aggregateContexts.push({
          name: agg.name,
          trackUser,
          idType,
          exampleId,
          resourceNameKebab: toKebabCase(agg.name),
          operations: null,
          defaultCrud: true,
          bodies: { default: defaultBody },
        });
      }
    }

    if (aggregateContexts.length > 0) {
      moduleContexts.push({
        name: mod.name,
        aggregates: aggregateContexts,
      });
    }
  }

  if (!moduleContexts.length) return null;

  // ── Render template ─────────────────────────────────────────────────────
  const templatePath = path.join(TEMPLATES_DIR, 'UnifiedCollection.json.ejs');
  const collectionId = crypto.randomUUID();

  const context = {
    systemName,
    collectionId,
    port,
    modules: moduleContexts,
  };

  const content = await renderTemplate(templatePath, context);

  // ── Write output ────────────────────────────────────────────────────────
  const outputDir = path.join(projectDir, 'postman');
  await fs.ensureDir(outputDir);

  const outputFileName = `${toKebabCase(systemName)}-Postman-Collection.json`;
  const outputPath = path.join(outputDir, outputFileName);
  await fs.writeFile(outputPath, content, 'utf-8');

  return outputPath;
}

module.exports = { generateUnifiedPostmanCollection };
