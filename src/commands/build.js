'use strict';

const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');

const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toCamelCase, toPackagePath } = require('../utils/naming');
const addModuleCommand = require('./add-module');
const addKafkaClientCommand = require('./add-kafka-client');
const generateEntitiesCommand = require('./generate-entities');

async function buildCommand(options = {}) {
  const projectDir = process.cwd();

  // ── 1. Validate project ───────────────────────────────────────────────────
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  // ── 2. Load project config ────────────────────────────────────────────────
  const configManager = new ConfigManager(projectDir);
  const projectConfig = await configManager.loadProjectConfig();

  if (!projectConfig) {
    console.error(chalk.red('❌ Could not load project configuration'));
    console.error(chalk.gray('Make sure .eva4j.json exists in the project root'));
    process.exit(1);
  }

  const { packageName } = projectConfig;
  const packagePath = toPackagePath(packageName);

  // ── 3. Read system/system.yaml ────────────────────────────────────────────
  const systemDir = path.join(projectDir, 'system');
  const systemYamlPath = path.join(systemDir, 'system.yaml');

  if (!(await fs.pathExists(systemYamlPath))) {
    console.error(chalk.red('❌ system/system.yaml not found'));
    console.error(chalk.gray('Create system/system.yaml first with module definitions'));
    process.exit(1);
  }

  let systemConfig;
  try {
    const content = await fs.readFile(systemYamlPath, 'utf-8');
    systemConfig = yaml.load(content);
  } catch (err) {
    console.error(chalk.red('❌ Failed to parse system/system.yaml:'), err.message);
    process.exit(1);
  }

  const { modules = [], messaging } = systemConfig;

  if (!modules.length) {
    console.log(chalk.yellow('⚠️  No modules defined in system/system.yaml'));
    process.exit(0);
  }

  console.log(chalk.blue('\n🏗️  eva build\n'));
  console.log(chalk.gray(`  Project : ${projectConfig.projectName || projectConfig.artifactId}`));
  console.log(chalk.gray(`  Modules : ${modules.map(m => m.name).join(', ')}`));
  console.log();

  // ── STEP 1: Create modules ─────────────────────────────────────────────────
  console.log(chalk.blue('━━━ Step 1: Creating modules ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  for (const mod of modules) {
    const modulePackageName = toCamelCase(mod.name);

    // Check if already registered in config
    if (await configManager.moduleExists(modulePackageName)) {
      console.log(chalk.gray(`  ⏭  ${mod.name} — already exists, skipping`));
      continue;
    }

    // Check if filesystem directory already exists (safety guard)
    const moduleDir = path.join(projectDir, 'src', 'main', 'java', packagePath, modulePackageName);
    if (await fs.pathExists(moduleDir)) {
      console.log(chalk.gray(`  ⏭  ${mod.name} — directory already exists, skipping`));
      continue;
    }

    console.log(chalk.cyan(`  ➕ Adding module: ${mod.name}`));
    await addModuleCommand(mod.name, {});

    // Reload config manager state after adding each module
    await configManager.loadProjectConfig();
  }

  console.log();

  // ── STEP 2: Install broker client ─────────────────────────────────────────
  console.log(chalk.blue('━━━ Step 2: Installing broker client ━━━━━━━━━━━━━━━━━━━━━━━━━'));

  const brokerEnabled = messaging && messaging.enabled === true;
  const broker = messaging && messaging.broker;

  if (!brokerEnabled || !broker) {
    console.log(chalk.gray('  ⏭  No messaging configured, skipping broker install'));
  } else if (broker === 'kafka') {
    if (await configManager.featureExists('kafka')) {
      console.log(chalk.gray('  ⏭  kafka-client — already installed, skipping'));
    } else {
      console.log(chalk.cyan('  ➕ Installing kafka-client'));
      await addKafkaClientCommand();
    }
  } else {
    console.log(chalk.yellow(`  ⚠️  Broker '${broker}' is not supported by eva build (only kafka is supported)`));
  }

  console.log();

  // ── STEP 3: Copy domain.yaml files ────────────────────────────────────────
  console.log(chalk.blue('━━━ Step 3: Copying domain.yaml files ━━━━━━━━━━━━━━━━━━━━━━━'));

  for (const mod of modules) {
    const sourceYaml = path.join(systemDir, `${mod.name}.yaml`);
    const modulePackageName = toCamelCase(mod.name);
    const destYaml = path.join(projectDir, 'src', 'main', 'java', packagePath, modulePackageName, 'domain.yaml');

    if (!(await fs.pathExists(sourceYaml))) {
      console.log(chalk.yellow(`  ⚠️  system/${mod.name}.yaml not found — skipping ${mod.name}`));
      continue;
    }

    const content = await fs.readFile(sourceYaml, 'utf-8');
    await fs.ensureDir(path.dirname(destYaml));
    await fs.writeFile(destYaml, content, 'utf-8');
    console.log(chalk.green(`  ✅ ${mod.name}/domain.yaml updated`));
  }

  console.log();

  // ── STEP 4: Generate entities ─────────────────────────────────────────────
  console.log(chalk.blue('━━━ Step 4: Generating entities ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  const generateOptions = { force: options.force || false };

  for (const mod of modules) {
    const modulePackageName = toCamelCase(mod.name);
    const domainYamlPath = path.join(
      projectDir, 'src', 'main', 'java', packagePath, modulePackageName, 'domain.yaml'
    );

    if (!(await fs.pathExists(domainYamlPath))) {
      console.log(chalk.yellow(`  ⚠️  domain.yaml not found for '${mod.name}' — skipping entity generation`));
      continue;
    }

    console.log(chalk.cyan(`\n  Generating entities for: ${mod.name}`));
    await generateEntitiesCommand(mod.name, generateOptions);
  }

  console.log();
  console.log(chalk.green('✅ eva build completed successfully\n'));
}

module.exports = buildCommand;
