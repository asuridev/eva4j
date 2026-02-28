const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject, moduleExists } = require('../utils/validator');
const { toPackagePath, toPascalCase } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');
const ChecksumManager = require('../utils/checksum-manager');

async function generateTemporalActivityCommand(moduleName, activityName, options = {}) {
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
    const answer = await inquirer.prompt([{
      type: 'input',
      name: 'moduleName',
      message: 'Module name:',
      validate: (v) => (v.trim() ? true : 'Module name is required'),
    }]);
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

  if (!(await configManager.moduleExists(moduleName))) {
    console.error(chalk.red(`❌ Module '${moduleName}' does not exist`));
    console.error(chalk.gray(`Create it first using: eva add module ${moduleName}`));
    process.exit(1);
  }

  if (!(await moduleExists(projectDir, packagePath, moduleName))) {
    console.error(chalk.red(`❌ Module directory for '${moduleName}' not found`));
    process.exit(1);
  }

  // 1. Prompt activity name
  if (!activityName) {
    const answer = await inquirer.prompt([{
      type: 'input',
      name: 'activityName',
      message: 'Activity name (e.g. register-order, ValidatePayment):',
      validate: (v) => (v.trim() ? true : 'Activity name is required'),
    }]);
    activityName = answer.activityName.trim();
  }

  const activityPascalCase = toPascalCase(activityName);

  // 2. Prompt activity category
  const { activityCategory } = await inquirer.prompt([{
    type: 'list',
    name: 'activityCategory',
    message: 'Activity category:',
    choices: [
      { name: 'LightActivity  (fast, low-resource tasks)', value: 'LightActivity' },
      { name: 'HeavyActivity  (long-running, resource-intensive tasks)', value: 'HeavyActivity' },
    ],
  }]);

  // 3. Discover existing workflows across all modules
  const javaRoot = path.join(projectDir, 'src', 'main', 'java', packagePath);
  const workflows = await findExistingWorkflows(javaRoot);

  if (workflows.length === 0) {
    console.error(chalk.red('❌ No workflows found in this project'));
    console.error(chalk.gray('Create a workflow first using: eva generate temporal-flow <module>'));
    process.exit(1);
  }

  const { selectedWorkflow } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedWorkflow',
    message: 'Register activity in workflow:',
    choices: workflows.map((w) => ({ name: `${w.moduleName} / ${w.implClass}`, value: w })),
  }]);

  const moduleBasePath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName);
  const checksumManager = new ChecksumManager(moduleBasePath);
  await checksumManager.load();

  const spinner = ora(`Generating ${activityPascalCase}Activity...`).start();

  try {
    const context = { packageName, moduleName, activityPascalCase, activityCategory };
    const templatesDir = path.join(__dirname, '..', '..', 'templates', 'temporal-activity');
    const writeOptions = { force: options.force, checksumManager };

    // 4. Generate ActivityInterface in application/ports/
    spinner.text = `Generating ${activityPascalCase}Activity interface...`;
    await renderAndWrite(
      path.join(templatesDir, 'ActivityInterface.java.ejs'),
      path.join(moduleBasePath, 'application', 'ports', `${activityPascalCase}Activity.java`),
      context,
      writeOptions
    );

    // 5. Generate ActivityImpl in infrastructure/adapters/activities/
    spinner.text = `Generating ${activityPascalCase}ActivityImpl...`;
    await renderAndWrite(
      path.join(templatesDir, 'ActivityImpl.java.ejs'),
      path.join(moduleBasePath, 'infrastructure', 'adapters', 'activities', `${activityPascalCase}ActivityImpl.java`),
      context,
      writeOptions
    );

    // 6. Register activity stub in selected WorkFlowImpl
    spinner.text = `Registering activity in ${selectedWorkflow.implClass}...`;
    await registerActivityInWorkflow(
      selectedWorkflow.filePath,
      packageName,
      moduleName,
      activityPascalCase,
      activityCategory
    );

    spinner.succeed(chalk.green(`✅ ${activityPascalCase}Activity generated successfully`));

    console.log(chalk.blue('\n📁 Generated files:'));
    console.log(chalk.gray(`  ${moduleName}/application/ports/${activityPascalCase}Activity.java`));
    console.log(chalk.gray(`  ${moduleName}/infrastructure/adapters/activities/${activityPascalCase}ActivityImpl.java`));
    console.log(chalk.blue('\n📝 Updated files:'));
    console.log(chalk.gray(`  ${selectedWorkflow.moduleName}/application/usecases/${selectedWorkflow.implClass}.java`));

    await checksumManager.save();
  } catch (error) {
    spinner.fail(chalk.red('Failed to generate temporal activity'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

async function findExistingWorkflows(javaRoot) {
  const results = [];
  if (!(await fs.pathExists(javaRoot))) return results;

  const modules = await fs.readdir(javaRoot);
  for (const mod of modules) {
    const usecasesDir = path.join(javaRoot, mod, 'application', 'usecases');
    if (!(await fs.pathExists(usecasesDir))) continue;
    const files = await fs.readdir(usecasesDir);
    for (const file of files) {
      if (file.endsWith('WorkFlowImpl.java')) {
        results.push({
          moduleName: mod,
          implClass: file.replace('.java', ''),
          filePath: path.join(usecasesDir, file),
        });
      }
    }
  }
  return results;
}

async function registerActivityInWorkflow(workflowImplPath, packageName, moduleName, activityPascalCase, activityCategory) {
  if (!(await fs.pathExists(workflowImplPath))) return;

  let content = await fs.readFile(workflowImplPath, 'utf-8');

  const activityInterface = `${activityPascalCase}Activity`;
  const activityField = `${activityPascalCase.charAt(0).toLowerCase()}${activityPascalCase.slice(1)}Activity`;
  const importLine = `import ${packageName}.${moduleName}.application.ports.${activityInterface};`;
  const optionsVar = activityCategory === 'HeavyActivity' ? 'heavyActivityOptions' : 'lightActivityOptions';
  const fieldLine = `    private final ${activityInterface} ${activityField} = Workflow.newActivityStub(${activityInterface}.class, ${optionsVar});`;

  // Skip if already registered
  if (content.includes(fieldLine)) return;

  // Add import after last import line
  if (!content.includes(importLine)) {
    const allImports = [...content.matchAll(/^import .+;/gm)];
    if (allImports.length > 0) {
      const lastImport = allImports[allImports.length - 1];
      const insertPos = lastImport.index + lastImport[0].length;
      content = content.slice(0, insertPos) + '\n' + importLine + content.slice(insertPos);
    }
  }

  // Insert field after last activityOptions block (or append after last existing stub)
  const activityOptionsRegex = /(private final ActivityOptions heavyActivityOptions = ActivityOptions\.newBuilder\(\)[\s\S]*?\.build\(\)\s*\)\.build\(\);)/;
  if (content.includes('//register activities')) {
    // Append after the last existing activity stub
    const lastStubRegex = /(private final \w+Activity \w+Activity = Workflow\.newActivityStub\([^;]+;)/g;
    const allStubs = [...content.matchAll(lastStubRegex)];
    if (allStubs.length > 0) {
      const lastStub = allStubs[allStubs.length - 1];
      const insertPos = lastStub.index + lastStub[0].length;
      content = content.slice(0, insertPos) + '\n' + fieldLine + content.slice(insertPos);
    }
  } else if (activityOptionsRegex.test(content)) {
    content = content.replace(activityOptionsRegex, (match) => {
      return match + '\n\n    //register activities\n' + fieldLine;
    });
  } else {
    // Fallback: insert before the first @Override
    content = content.replace(
      /( {4}@Override)/,
      `    //register activities\n${fieldLine}\n\n$1`
    );
  }

  await fs.writeFile(workflowImplPath, content, 'utf-8');
}

module.exports = generateTemporalActivityCommand;
