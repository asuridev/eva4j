const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject, moduleExists } = require('../utils/validator');
const { toPackagePath, toPascalCase, toCamelCase, toScreamingSnakeCase } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');
const ChecksumManager = require('../utils/checksum-manager');

async function generateTemporalFlowCommand(moduleName, flowName, options = {}) {
  const projectDir = process.cwd();

  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  const configManager = new ConfigManager(projectDir);

  if (!(await configManager.featureExists('temporal'))) {
    console.error(chalk.red('❌ Temporal client is not installed in this project'));
    console.error(chalk.gray('Install Temporal first using: eva add temporal-client'));
    process.exit(1);
  }

  if (!moduleName) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'moduleName',
        message: 'Module name:',
        validate: (v) => (v.trim() ? true : 'Module name is required'),
      },
    ]);
    moduleName = answer.moduleName.trim();
  }

  const projectConfig = await configManager.loadProjectConfig();
  if (!projectConfig) {
    console.error(chalk.red('❌ Could not load project configuration'));
    console.error(chalk.gray('Make sure .eva4j.json exists in the project root'));
    process.exit(1);
  }

  const { packageName } = projectConfig;
  const packagePath = toPackagePath(packageName);

  // Normalise module name to camelCase (system.yaml uses kebab-case, .eva4j.json stores camelCase)
  moduleName = toCamelCase(moduleName);

  if (!(await configManager.moduleExists(moduleName))) {
    console.error(chalk.red(`❌ Module '${moduleName}' does not exist`));
    console.error(chalk.gray(`Create it first using: eva add module ${moduleName}`));
    process.exit(1);
  }

  if (!(await moduleExists(projectDir, packagePath, moduleName))) {
    console.error(chalk.red(`❌ Module directory for '${moduleName}' not found`));
    process.exit(1);
  }

  if (!flowName) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'flowName',
        message: 'Workflow name (e.g. process-order, Payment):',
        validate: (v) => (v.trim() ? true : 'Workflow name is required'),
      },
    ]);
    flowName = answer.flowName.trim();
  }

  const flowPascalCase = toPascalCase(flowName);
  const modulePascalCase = toPascalCase(moduleName);
  const moduleScreamingSnake = toScreamingSnakeCase(moduleName);

  const moduleBasePath = path.join(
    projectDir,
    'src',
    'main',
    'java',
    packagePath,
    moduleName
  );

  const checksumManager = new ChecksumManager(moduleBasePath);
  await checksumManager.load();

  const spinner = ora(`Generating ${flowPascalCase}WorkFlow...`).start();

  try {
    const context = {
      packageName,
      moduleName,
      flowPascalCase,
      modulePascalCase,
      moduleCamelCase: moduleName,
      moduleScreamingSnake,
    };

    const templatesDir = path.join(__dirname, '..', '..', 'templates', 'temporal-flow');
    const usecasesDir = path.join(moduleBasePath, 'application', 'usecases');
    const writeOptions = { force: options.force, checksumManager };

    // 1. Generate WorkFlow interface
    spinner.text = `Generating ${flowPascalCase}WorkFlow interface...`;
    await renderAndWrite(
      path.join(templatesDir, 'WorkFlowInterface.java.ejs'),
      path.join(usecasesDir, `${flowPascalCase}WorkFlow.java`),
      context,
      writeOptions
    );

    // 2. Generate WorkFlow implementation
    spinner.text = `Generating ${flowPascalCase}WorkFlowImpl...`;
    await renderAndWrite(
      path.join(templatesDir, 'WorkFlowImpl.java.ejs'),
      path.join(usecasesDir, `${flowPascalCase}WorkFlowImpl.java`),
      context,
      writeOptions
    );

    // 3. Generate WorkFlow service facade
    spinner.text = `Generating ${flowPascalCase}WorkFlowService...`;
    await renderAndWrite(
      path.join(templatesDir, 'WorkFlowService.java.ejs'),
      path.join(usecasesDir, `${flowPascalCase}WorkFlowService.java`),
      context,
      writeOptions
    );

    // 4. Generate module-scoped marker interfaces (idempotent)
    spinner.text = `Generating ${modulePascalCase} Temporal interfaces...`;
    const interfacesDir = path.join(moduleBasePath, 'domain', 'interfaces');
    await renderAndWrite(
      path.join(templatesDir, 'ModuleHeavyActivity.java.ejs'),
      path.join(interfacesDir, `${modulePascalCase}HeavyActivity.java`),
      context,
      writeOptions
    );
    await renderAndWrite(
      path.join(templatesDir, 'ModuleLightActivity.java.ejs'),
      path.join(interfacesDir, `${modulePascalCase}LightActivity.java`),
      context,
      writeOptions
    );

    // 5. Generate ModuleTemporalWorkerConfig (idempotent)
    spinner.text = `Generating ${modulePascalCase}TemporalWorkerConfig...`;
    const configDir = path.join(moduleBasePath, 'infrastructure', 'configurations');
    await renderAndWrite(
      path.join(templatesDir, 'ModuleTemporalWorkerConfig.java.ejs'),
      path.join(configDir, `${modulePascalCase}TemporalWorkerConfig.java`),
      context,
      writeOptions
    );

    // 6. Register workflow in module worker config
    spinner.text = 'Registering workflow in module worker config...';
    await registerWorkflowInModuleWorkerConfig(
      path.join(configDir, `${modulePascalCase}TemporalWorkerConfig.java`),
      packageName, moduleName, flowPascalCase, modulePascalCase
    );

    // 7. Append module queue section to temporal.yaml (idempotent)
    spinner.text = 'Updating temporal.yaml with module queues...';
    await appendModuleQueues(projectDir, moduleName, moduleScreamingSnake);

    spinner.succeed(chalk.green(`✅ ${flowPascalCase}WorkFlow generated successfully`));

    console.log(chalk.blue('\n📁 Generated files:'));
    console.log(chalk.gray(`  ${moduleName}/application/usecases/${flowPascalCase}WorkFlow.java`));
    console.log(chalk.gray(`  ${moduleName}/application/usecases/${flowPascalCase}WorkFlowImpl.java`));
    console.log(chalk.gray(`  ${moduleName}/application/usecases/${flowPascalCase}WorkFlowService.java`));
    console.log(chalk.gray(`  ${moduleName}/domain/interfaces/${modulePascalCase}HeavyActivity.java`));
    console.log(chalk.gray(`  ${moduleName}/domain/interfaces/${modulePascalCase}LightActivity.java`));
    console.log(chalk.gray(`  ${moduleName}/infrastructure/configurations/${modulePascalCase}TemporalWorkerConfig.java`));
    console.log(chalk.blue('\n📝 Queue names:'));
    console.log(chalk.gray(`  Flow:  ${moduleScreamingSnake}_WORKFLOW_QUEUE`));
    console.log(chalk.gray(`  Heavy: ${moduleScreamingSnake}_HEAVY_TASK_QUEUE`));
    console.log(chalk.gray(`  Light: ${moduleScreamingSnake}_LIGHT_TASK_QUEUE`));

    await checksumManager.save();
  } catch (error) {
    spinner.fail(chalk.red('Failed to generate temporal flow'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

async function registerWorkflowInModuleWorkerConfig(configPath, packageName, moduleName, flowPascalCase, modulePascalCase) {
  if (!(await fs.pathExists(configPath))) {
    console.warn(chalk.yellow(`\n⚠️  ${modulePascalCase}TemporalWorkerConfig.java not found — skipping auto-registration`));
    return;
  }

  let content = await fs.readFile(configPath, 'utf-8');

  const implClass = `${flowPascalCase}WorkFlowImpl`;
  const importLine = `import ${packageName}.${moduleName}.application.usecases.${implClass};`;

  // Add import if not already present
  if (!content.includes(importLine)) {
    const allImports = [...content.matchAll(/^import .+;/gm)];
    if (allImports.length > 0) {
      const lastImport = allImports[allImports.length - 1];
      const insertPos = lastImport.index + lastImport[0].length;
      content = content.slice(0, insertPos) + '\n' + importLine + content.slice(insertPos);
    }
  }

  // Check if there is already an active registerWorkflowImplementationTypes call
  const activeRegisterRegex = /workflowWorker\.registerWorkflowImplementationTypes\(([^)]+)\);/;
  if (activeRegisterRegex.test(content)) {
    content = content.replace(activeRegisterRegex, (match, classes) => {
      const classList = classes
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (!classList.includes(`${implClass}.class`)) {
        classList.push(`${implClass}.class`);
      }
      return `workflowWorker.registerWorkflowImplementationTypes(${classList.join(', ')});`;
    });
  } else {
    // Insert active registration after the comment marker
    content = content.replace(
      /(\/\/ registered by eva g temporal-flow\r?\n)/,
      `$1        workflowWorker.registerWorkflowImplementationTypes(${implClass}.class);\n`
    );
  }

  await fs.writeFile(configPath, content, 'utf-8');
}

/**
 * Append module-specific queue configuration to temporal.yaml files (idempotent)
 */
async function appendModuleQueues(projectDir, moduleName, moduleScreamingSnake) {
  const environments = ['local', 'develop', 'test', 'production'];
  const resourcesDir = path.join(projectDir, 'src', 'main', 'resources', 'parameters');

  const moduleSection = [
    `    ${moduleName}:`,
    `      flow-queue: ${moduleScreamingSnake}_WORKFLOW_QUEUE`,
    `      heavy-queue: ${moduleScreamingSnake}_HEAVY_TASK_QUEUE`,
    `      light-queue: ${moduleScreamingSnake}_LIGHT_TASK_QUEUE`,
  ].join('\n');

  for (const env of environments) {
    const yamlPath = path.join(resourcesDir, env, 'temporal.yaml');

    if (!(await fs.pathExists(yamlPath))) continue;

    let content = await fs.readFile(yamlPath, 'utf-8');

    // Skip if module already registered
    if (content.includes(`${moduleName}:`)) continue;

    // Add modules: section if not present
    if (!content.includes('modules:')) {
      content = content.trimEnd() + '\n  modules:\n' + moduleSection + '\n';
    } else {
      // Append under existing modules: section
      content = content.trimEnd() + '\n' + moduleSection + '\n';
    }

    await fs.writeFile(yamlPath, content, 'utf-8');
  }
}

module.exports = generateTemporalFlowCommand;
