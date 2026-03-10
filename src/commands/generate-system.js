'use strict';

const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const pluralize = require('pluralize');

const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toCamelCase, toPascalCase, toPackagePath } = require('../utils/naming');

const addModuleCommand = require('./add-module');
const addKafkaClientCommand = require('./add-kafka-client');

// Supported brokers → add-client command mapping
const BROKER_CLIENT_COMMANDS = {
  kafka: addKafkaClientCommand,
};

async function generateSystemCommand() {
  const projectDir = process.cwd();

  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  // ── Read system.yaml ──────────────────────────────────────────────────────
  const systemYamlPath = path.join(projectDir, 'system.yaml');
  if (!(await fs.pathExists(systemYamlPath))) {
    console.error(chalk.red('❌ system.yaml not found in project root'));
    console.error(chalk.gray('Create a system.yaml file first'));
    process.exit(1);
  }

  let systemConfig;
  try {
    const content = await fs.readFile(systemYamlPath, 'utf-8');
    systemConfig = yaml.load(content);
  } catch (err) {
    console.error(chalk.red('❌ Failed to parse system.yaml:'), err.message);
    process.exit(1);
  }

  const { messaging, modules = [] } = systemConfig;

  if (!modules.length) {
    console.log(chalk.yellow('⚠️  No modules defined in system.yaml'));
    process.exit(0);
  }

  console.log(chalk.blue('\n🚀 eva generate system\n'));

  const configManager = new ConfigManager(projectDir);

  // ── Step 1: Add modules ───────────────────────────────────────────────────
  console.log(chalk.blue('\n📦 Adding modules...\n'));

  for (const mod of modules) {
    const modulePackageName = toCamelCase(mod.name);
    const alreadyExists = await configManager.moduleExists(modulePackageName);

    if (alreadyExists) {
      console.log(chalk.gray(`  ✓ Module '${mod.name}' already exists, skipping`));
    } else {
      await addModuleCommand(mod.name, {});
    }
  }

  // ── Step 2: Messaging broker client ──────────────────────────────────────
  if (messaging && messaging.enabled === true) {
    const broker = messaging.broker;
    const addClientFn = BROKER_CLIENT_COMMANDS[broker];

    if (!addClientFn) {
      console.log(chalk.yellow(`  ⚠️  Broker '${broker}' is not yet supported. Skipping client setup.`));
    } else {
      const alreadyInstalled = await configManager.featureExists(broker);
      if (alreadyInstalled) {
        console.log(chalk.gray(`  ✓ ${broker}-client already installed, skipping\n`));
      } else {
        console.log(chalk.blue(`\n📡 Adding ${broker}-client...\n`));
        await addClientFn();
      }
    }
  }

  // ── Step 3: Generate domain.yaml per module ───────────────────────────────
  const projectConfig = await configManager.loadProjectConfig();
  if (!projectConfig) {
    console.error(chalk.red('❌ Could not load project configuration'));
    process.exit(1);
  }

  const packagePath = toPackagePath(projectConfig.packageName);

  console.log(chalk.blue('\n📄 Generating domain.yaml skeletons...\n'));

  for (const mod of modules) {
    const modulePackageName = toCamelCase(mod.name);
    const moduleDir = path.join(projectDir, 'src', 'main', 'java', packagePath, modulePackageName);
    const domainYamlPath = path.join(moduleDir, 'domain.yaml');

    const existed = await fs.pathExists(domainYamlPath);
    const content = buildDomainYaml(mod, systemConfig);
    await fs.writeFile(domainYamlPath, content, 'utf-8');

    if (existed) {
      console.log(chalk.yellow(`  ♻️  ${modulePackageName}/domain.yaml overwritten`));
    } else {
      console.log(chalk.green(`  ✨ ${modulePackageName}/domain.yaml created`));
    }
  }

  console.log(chalk.blue('\n✅ System bootstrap complete!\n'));
  console.log(chalk.white('Next steps:'));
  console.log(chalk.gray("  1. Edit each module's domain.yaml — add fields, enums, and refine the aggregate"));
  console.log(chalk.gray('  2. Run: eva g entities <module>  (for each module)'));
  console.log(chalk.gray('\n  Tip: run eva system validate to check cross-module consistency'));
  console.log();
}

// ── Domain YAML builder ───────────────────────────────────────────────────────

function buildDomainYaml(mod, systemConfig) {
  const integrations = systemConfig.integrations || {};
  const asyncEvents = integrations.async || [];
  const syncCalls = integrations.sync || [];

  const moduleName = mod.name;
  const aggregateName = toPascalCase(pluralize.singular(moduleName));
  const entityName = aggregateName.charAt(0).toLowerCase() + aggregateName.slice(1);
  const tableName = moduleName.replace(/-/g, '_');

  // Events this module produces
  const producedEvents = asyncEvents.filter(e => e.producer === moduleName);
  // Sync calls this module makes as caller
  const outboundPorts = syncCalls.filter(s => s.caller === moduleName);
  // REST endpoints exposed by this module
  const exposes = mod.exposes || [];

  const lines = [];
  const today = new Date().toISOString().split('T')[0];

  lines.push(`# domain.yaml — ${moduleName}`);
  lines.push(`# Generated by: eva generate system  (${today})`);
  lines.push(`#`);
  lines.push(`# TODO: Complete this file:`);
  lines.push(`#   - Add entity fields under aggregates[].entities[].fields`);
  if (producedEvents.length) lines.push(`#   - Add event fields under aggregates[].events[].fields`);
  if (outboundPorts.length)  lines.push(`#   - Add response shapes to ports[].methods[].response`);
  if (exposes.length)        lines.push(`#   - Verify endpoints[].aggregate matches aggregates[].name`);
  lines.push(``);

  // ── aggregates ────────────────────────────────────────────────────────────
  lines.push(`aggregates:`);
  lines.push(`  - name: ${aggregateName}`);
  lines.push(`    entities:`);
  lines.push(`      - name: ${entityName}`);
  lines.push(`        isRoot: true`);
  lines.push(`        tableName: ${tableName}`);
  lines.push(`        audit:`);
  lines.push(`          enabled: true`);
  lines.push(`        fields:`);
  lines.push(`          - name: id`);
  lines.push(`            type: String`);
  lines.push(`          # TODO: add more fields`);

  if (producedEvents.length) {
    lines.push(`    events:`);
    for (const ev of producedEvents) {
      lines.push(`      - name: ${ev.event}`);
      lines.push(`        fields: []  # TODO: add event fields`);
      lines.push(`        kafka: true`);
    }
  }

  lines.push(``);

  // ── endpoints ─────────────────────────────────────────────────────────────
  if (exposes.length) {
    lines.push(`endpoints:`);
    lines.push(`  - version: v1`);
    lines.push(`    aggregate: ${aggregateName}  # must match aggregates[].name above`);
    lines.push(`    operations:`);
    for (const ep of exposes) {
      lines.push(`      - useCase: ${ep.useCase}`);
      lines.push(`        method: ${ep.method}`);
      lines.push(`        path: ${ep.path}`);
      if (ep.description) lines.push(`        description: "${ep.description}"`);
    }
    lines.push(``);
  }

  // ── ports ─────────────────────────────────────────────────────────────────
  if (outboundPorts.length) {
    lines.push(`ports:`);
    for (const port of outboundPorts) {
      lines.push(`  - name: ${port.port}`);
      lines.push(`    target: ${port.calls}  # from system.yaml integrations.sync`);
      lines.push(`    methods:`);
      for (const endpoint of (port.using || [])) {
        const methodName = deriveMethodName(endpoint);
        lines.push(`      - name: ${methodName}  # TODO: rename if needed`);
        lines.push(`        http: ${endpoint}`);
        lines.push(`        response: []  # TODO: add response fields`);
      }
    }
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * Derive a camelCase Java method name from an HTTP entry like "GET /customers/{id}"
 */
function deriveMethodName(httpEntry) {
  const parts = httpEntry.trim().split(/\s+/);
  const method = (parts[0] || 'GET').toUpperCase();
  const urlPath = parts[1] || '/';

  const segments = urlPath.split('/').filter(s => s.length > 0);
  const hasId = segments.some(s => s.charAt(0) === '{');
  const resourceSegments = segments.filter(s => s.charAt(0) !== '{');
  const lastResource = resourceSegments[resourceSegments.length - 1] || 'resource';
  const singular = pluralize.singular(lastResource);
  const pascal = toPascalCase(singular);

  if (method === 'GET' && hasId) return `find${pascal}ById`;
  if (method === 'GET') return `findAll${toPascalCase(lastResource)}`;
  if (method === 'POST') return `create${pascal}`;
  if (method === 'PUT' || method === 'PATCH') return `update${pascal}`;
  if (method === 'DELETE') return `delete${pascal}`;
  return toCamelCase(`${method.toLowerCase()}_${lastResource}`);
}

module.exports = generateSystemCommand;
