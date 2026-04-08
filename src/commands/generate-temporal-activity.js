const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject, moduleExists } = require('../utils/validator');
const { toPackagePath, toPascalCase, toCamelCase, toScreamingSnakeCase } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');
const ChecksumManager = require('../utils/checksum-manager');

// ─── Java type → import mapping ─────────────────────────────────────────────
const JAVA_TYPE_IMPORTS = {
  BigDecimal: 'java.math.BigDecimal',
  LocalDateTime: 'java.time.LocalDateTime',
  LocalDate: 'java.time.LocalDate',
  LocalTime: 'java.time.LocalTime',
  Instant: 'java.time.Instant',
  UUID: 'java.util.UUID',
  List: 'java.util.List',
};

/**
 * Resolve Java imports for a list of typed fields.
 * @param {Array<{javaType: string}>} fields
 * @returns {string[]} sorted import statements
 */
function resolveFieldImports(fields) {
  const imports = new Set();
  for (const field of fields) {
    for (const [type, imp] of Object.entries(JAVA_TYPE_IMPORTS)) {
      if (field.javaType && field.javaType.includes(type)) {
        imports.add(`import ${imp};`);
      }
    }
  }
  return Array.from(imports).sort();
}

/**
 * Parse the `activities:` section from a module's domain.yaml.
 * Returns null if the file does not exist or has no activities.
 * @param {string} domainYamlPath
 * @returns {Array|null}
 */
async function parseActivitiesFromYaml(domainYamlPath) {
  if (!(await fs.pathExists(domainYamlPath))) return null;
  const content = await fs.readFile(domainYamlPath, 'utf-8');
  const data = yaml.load(content);
  if (!data || !Array.isArray(data.activities) || data.activities.length === 0) return null;
  return data.activities;
}

/**
 * Map a single YAML field definition {name, type} to {name, javaType}.
 * @param {{name: string, type: string}} field
 * @returns {{name: string, javaType: string}}
 */
function mapField(field) {
  return { name: field.name, javaType: field.type || 'String' };
}

/**
 * Build the template context for a single activity from its YAML definition.
 * @param {object} activity  - Raw activity object from domain.yaml
 * @param {string} packageName
 * @param {string} moduleName
 * @param {boolean} shared  - Whether this activity's contracts live in shared/
 * @returns {object} context for templates
 */
function buildActivityContext(activity, packageName, moduleName, shared = false) {
  const activityPascalCase = toPascalCase(activity.name);
  const modulePascalCase = toPascalCase(moduleName);
  const categoryType = (activity.type || 'light').toLowerCase() === 'heavy' ? 'HeavyActivity' : 'LightActivity';
  const activityCategory = `${modulePascalCase}${categoryType}`;

  const inputFields = Array.isArray(activity.input) ? activity.input.map(mapField) : [];
  const outputFields = Array.isArray(activity.output) ? activity.output.map(mapField) : [];
  const hasInput = inputFields.length > 0;
  const hasOutput = outputFields.length > 0;

  return {
    packageName,
    moduleName,
    modulePascalCase,
    activityPascalCase,
    activityCategory,
    categoryType,
    hasInput,
    hasOutput,
    inputFields,
    outputFields,
    inputImports: resolveFieldImports(inputFields),
    outputImports: resolveFieldImports(outputFields),
    description: activity.description || '',
    compensation: activity.compensation || null,
    timeout: activity.timeout || null,
    shared,
    targetModule: moduleName,
  };
}

/**
 * Parse system.yaml and return a Set of activity names that are referenced
 * cross-module (i.e. appear as activity or compensation in workflow steps).
 * @param {string} projectDir
 * @returns {Set<string>} activity names (PascalCase) that are cross-module
 */
async function parseCrossModuleActivities(projectDir) {
  const systemYamlPath = path.join(projectDir, 'system', 'system.yaml');
  if (!(await fs.pathExists(systemYamlPath))) return new Set();

  const content = await fs.readFile(systemYamlPath, 'utf-8');
  const data = yaml.load(content);
  if (!data || !Array.isArray(data.workflows)) return new Set();

  const crossModuleSet = new Set();

  for (const wf of data.workflows) {
    if (!Array.isArray(wf.steps)) continue;
    const hostModule = wf.trigger && wf.trigger.module
      ? toCamelCase(wf.trigger.module)
      : null;
    for (const step of wf.steps) {
      if (step.activity && step.target) {
        const targetModule = toCamelCase(step.target);
        // Only mark as cross-module if target differs from the workflow host
        if (targetModule !== hostModule) {
          crossModuleSet.add(toPascalCase(step.activity));
        }
      }
      if (step.compensation) {
        // Compensation targets same module as the step it compensates
        const compTarget = step.target ? toCamelCase(step.target) : hostModule;
        if (compTarget !== hostModule) {
          crossModuleSet.add(toPascalCase(step.compensation));
        }
      }
    }
  }

  return crossModuleSet;
}

/**
 * Generate shared activity contracts (Interface + Input + Output) into
 * shared/domain/contracts/{module}/. Called by YAML-driven generation
 * and also exported for use by `eva g temporal-system`.
 *
 * @param {object} actCtx  - Activity context from buildActivityContext()
 * @param {string} sharedBasePath - Path to shared/ Java directory
 * @param {object} writeOptions
 * @returns {string[]} list of generated file paths (relative)
 */
async function generateSharedContracts(actCtx, sharedBasePath, writeOptions) {
  const templatesDir = path.join(__dirname, '..', '..', 'templates', 'temporal-activity');
  const contractsDir = path.join(sharedBasePath, 'domain', 'contracts', actCtx.targetModule);
  const generated = [];

  // 1. Shared Input record
  if (actCtx.hasInput) {
    await renderAndWrite(
      path.join(templatesDir, 'SharedActivityInput.java.ejs'),
      path.join(contractsDir, `${actCtx.activityPascalCase}Input.java`),
      { ...actCtx, imports: actCtx.inputImports },
      writeOptions
    );
    generated.push(`shared/domain/contracts/${actCtx.targetModule}/${actCtx.activityPascalCase}Input.java`);
  }

  // 2. Shared Output record
  if (actCtx.hasOutput) {
    await renderAndWrite(
      path.join(templatesDir, 'SharedActivityOutput.java.ejs'),
      path.join(contractsDir, `${actCtx.activityPascalCase}Output.java`),
      { ...actCtx, imports: actCtx.outputImports },
      writeOptions
    );
    generated.push(`shared/domain/contracts/${actCtx.targetModule}/${actCtx.activityPascalCase}Output.java`);
  }

  // 3. Shared ActivityInterface
  await renderAndWrite(
    path.join(templatesDir, 'SharedActivityInterface.java.ejs'),
    path.join(contractsDir, `${actCtx.activityPascalCase}Activity.java`),
    actCtx,
    writeOptions
  );
  generated.push(`shared/domain/contracts/${actCtx.targetModule}/${actCtx.activityPascalCase}Activity.java`);

  return generated;
}

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

  // Normalise module name to camelCase
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

  const moduleBasePath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName);
  const checksumManager = new ChecksumManager(moduleBasePath);
  await checksumManager.load();
  const writeOptions = { force: options.force, checksumManager };

  // ── Try YAML-driven generation ──────────────────────────────────────────
  const domainYamlPath = path.join(moduleBasePath, 'domain.yaml');
  const yamlActivities = await parseActivitiesFromYaml(domainYamlPath);

  if (yamlActivities) {
    await generateFromYaml(yamlActivities, activityName, {
      projectDir, packageName, packagePath, moduleName, moduleBasePath, checksumManager, writeOptions, options,
    });
  } else {
    await generateInteractive(activityName, {
      projectDir, packageName, packagePath, moduleName, moduleBasePath, checksumManager, writeOptions, options,
    });
  }

  await checksumManager.save();
}

// ─── YAML-driven generation ─────────────────────────────────────────────────

async function generateFromYaml(yamlActivities, activityName, ctx) {
  const { projectDir, packageName, packagePath, moduleName, moduleBasePath, writeOptions } = ctx;

  // Detect which activities are cross-module from system.yaml
  const crossModuleSet = await parseCrossModuleActivities(projectDir);

  let activitiesToGenerate;

  if (activityName) {
    const match = yamlActivities.find(
      (a) => toPascalCase(a.name) === toPascalCase(activityName)
    );
    if (!match) {
      console.error(chalk.red(`❌ Activity '${activityName}' not found in domain.yaml`));
      console.error(chalk.gray('Available activities: ' + yamlActivities.map((a) => a.name).join(', ')));
      process.exit(1);
    }
    activitiesToGenerate = [match];
  } else if (ctx.options && ctx.options.generateAll) {
    // Non-interactive: generate all activities (used by eva build)
    activitiesToGenerate = yamlActivities;
  } else {
    // Prompt: generate all or select
    const { selection } = await inquirer.prompt([{
      type: 'list',
      name: 'selection',
      message: `Found ${yamlActivities.length} activities in domain.yaml:`,
      choices: [
        { name: 'Generate ALL activities', value: 'all' },
        ...yamlActivities.map((a) => ({ name: `  ${a.name} (${a.type || 'light'})`, value: a.name })),
      ],
    }]);
    activitiesToGenerate = selection === 'all'
      ? yamlActivities
      : [yamlActivities.find((a) => a.name === selection)];
  }

  const spinner = ora(`Generating ${activitiesToGenerate.length} activity(ies)...`).start();

  try {
    const templatesDir = path.join(__dirname, '..', '..', 'templates', 'temporal-activity');
    const sharedBasePath = path.join(projectDir, 'src', 'main', 'java', packagePath, 'shared');
    const generated = [];
    const sharedGenerated = [];

    for (const activity of activitiesToGenerate) {
      const isShared = crossModuleSet.has(toPascalCase(activity.name));
      const actCtx = buildActivityContext(activity, packageName, moduleName, isShared);
      spinner.text = `Generating ${actCtx.activityPascalCase}Activity${isShared ? ' (shared)' : ''}...`;

      if (isShared) {
        // Interface + Input + Output → shared/domain/contracts/{module}/
        const sharedFiles = await generateSharedContracts(actCtx, sharedBasePath, writeOptions);
        sharedGenerated.push(...sharedFiles);
      } else {
        // Interface + Input + Output → {module}/application/
        if (actCtx.hasInput) {
          await renderAndWrite(
            path.join(templatesDir, 'ActivityInput.java.ejs'),
            path.join(moduleBasePath, 'application', 'dtos', 'temporal', `${actCtx.activityPascalCase}Input.java`),
            { ...actCtx, imports: actCtx.inputImports },
            writeOptions
          );
        }
        if (actCtx.hasOutput) {
          await renderAndWrite(
            path.join(templatesDir, 'ActivityOutput.java.ejs'),
            path.join(moduleBasePath, 'application', 'dtos', 'temporal', `${actCtx.activityPascalCase}Output.java`),
            { ...actCtx, imports: actCtx.outputImports },
            writeOptions
          );
        }
        await renderAndWrite(
          path.join(templatesDir, 'ActivityInterface.java.ejs'),
          path.join(moduleBasePath, 'application', 'ports', `${actCtx.activityPascalCase}Activity.java`),
          actCtx,
          writeOptions
        );
      }

      // ActivityImpl always goes in the module
      await renderAndWrite(
        path.join(templatesDir, 'ActivityImpl.java.ejs'),
        path.join(moduleBasePath, 'infrastructure', 'adapters', 'activities', `${actCtx.activityPascalCase}ActivityImpl.java`),
        actCtx,
        writeOptions
      );

      generated.push(actCtx);
    }

    spinner.succeed(chalk.green(`✅ ${generated.length} activity(ies) generated successfully`));

    if (sharedGenerated.length > 0) {
      console.log(chalk.blue('\n📁 Shared contracts (cross-module):'));
      for (const f of sharedGenerated) {
        console.log(chalk.gray(`  ${f}`));
      }
    }

    console.log(chalk.blue('\n📁 Module files:'));
    for (const actCtx of generated) {
      const name = actCtx.activityPascalCase;
      if (!actCtx.shared) {
        if (actCtx.hasInput) {
          console.log(chalk.gray(`  ${moduleName}/application/dtos/temporal/${name}Input.java`));
        }
        if (actCtx.hasOutput) {
          console.log(chalk.gray(`  ${moduleName}/application/dtos/temporal/${name}Output.java`));
        }
        console.log(chalk.gray(`  ${moduleName}/application/ports/${name}Activity.java`));
      }
      console.log(chalk.gray(`  ${moduleName}/infrastructure/adapters/activities/${name}ActivityImpl.java`));
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to generate temporal activity'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

// ─── Interactive generation (fallback when no domain.yaml activities) ────────

async function generateInteractive(activityName, ctx) {
  const { projectDir, packageName, packagePath, moduleName, moduleBasePath, checksumManager, writeOptions, options } = ctx;

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

  // 3. Prompt for input fields
  const inputFields = await promptFields('Input');
  const hasInput = inputFields.length > 0;

  // 4. Prompt for output fields
  const outputFields = await promptFields('Output');
  const hasOutput = outputFields.length > 0;

  // 5. Discover existing workflows across all modules
  const javaRoot = path.join(projectDir, 'src', 'main', 'java', packagePath);
  const workflows = await findExistingWorkflows(javaRoot);

  let selectedWorkflow = null;
  if (workflows.length > 0) {
    const { doRegister } = await inquirer.prompt([{
      type: 'confirm',
      name: 'doRegister',
      message: 'Register activity in an existing workflow?',
      default: true,
    }]);

    if (doRegister) {
      const answer = await inquirer.prompt([{
        type: 'list',
        name: 'selectedWorkflow',
        message: 'Register activity in workflow:',
        choices: workflows.map((w) => ({ name: `${w.moduleName} / ${w.implClass}`, value: w })),
      }]);
      selectedWorkflow = answer.selectedWorkflow;
    }
  }

  const modulePascalCase = toPascalCase(moduleName);
  const moduleActivityCategory = `${modulePascalCase}${activityCategory}`;
  const context = {
    packageName,
    moduleName,
    modulePascalCase,
    activityPascalCase,
    activityCategory: moduleActivityCategory,
    categoryType: activityCategory,
    hasInput,
    hasOutput,
    inputFields,
    outputFields,
    inputImports: resolveFieldImports(inputFields),
    outputImports: resolveFieldImports(outputFields),
  };

  const spinner = ora(`Generating ${activityPascalCase}Activity...`).start();

  try {
    const templatesDir = path.join(__dirname, '..', '..', 'templates', 'temporal-activity');

    // Generate Input record
    if (hasInput) {
      spinner.text = `Generating ${activityPascalCase}Input...`;
      await renderAndWrite(
        path.join(templatesDir, 'ActivityInput.java.ejs'),
        path.join(moduleBasePath, 'application', 'dtos', 'temporal', `${activityPascalCase}Input.java`),
        { ...context, imports: context.inputImports },
        writeOptions
      );
    }

    // Generate Output record
    if (hasOutput) {
      spinner.text = `Generating ${activityPascalCase}Output...`;
      await renderAndWrite(
        path.join(templatesDir, 'ActivityOutput.java.ejs'),
        path.join(moduleBasePath, 'application', 'dtos', 'temporal', `${activityPascalCase}Output.java`),
        { ...context, imports: context.outputImports },
        writeOptions
      );
    }

    // Generate ActivityInterface
    spinner.text = `Generating ${activityPascalCase}Activity interface...`;
    await renderAndWrite(
      path.join(templatesDir, 'ActivityInterface.java.ejs'),
      path.join(moduleBasePath, 'application', 'ports', `${activityPascalCase}Activity.java`),
      context,
      writeOptions
    );

    // Generate ActivityImpl
    spinner.text = `Generating ${activityPascalCase}ActivityImpl...`;
    await renderAndWrite(
      path.join(templatesDir, 'ActivityImpl.java.ejs'),
      path.join(moduleBasePath, 'infrastructure', 'adapters', 'activities', `${activityPascalCase}ActivityImpl.java`),
      context,
      writeOptions
    );

    // Register activity stub in selected WorkFlowImpl
    if (selectedWorkflow) {
      spinner.text = `Registering activity in ${selectedWorkflow.implClass}...`;
      await registerActivityInWorkflow(
        selectedWorkflow.filePath,
        packageName,
        moduleName,
        activityPascalCase,
        activityCategory
      );
    }

    spinner.succeed(chalk.green(`✅ ${activityPascalCase}Activity generated successfully`));

    console.log(chalk.blue('\n📁 Generated files:'));
    if (hasInput) console.log(chalk.gray(`  ${moduleName}/application/dtos/temporal/${activityPascalCase}Input.java`));
    if (hasOutput) console.log(chalk.gray(`  ${moduleName}/application/dtos/temporal/${activityPascalCase}Output.java`));
    console.log(chalk.gray(`  ${moduleName}/application/ports/${activityPascalCase}Activity.java`));
    console.log(chalk.gray(`  ${moduleName}/infrastructure/adapters/activities/${activityPascalCase}ActivityImpl.java`));
    if (selectedWorkflow) {
      console.log(chalk.blue('\n📝 Updated files:'));
      console.log(chalk.gray(`  ${selectedWorkflow.moduleName}/application/usecases/${selectedWorkflow.implClass}.java`));
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to generate temporal activity'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const COMMON_JAVA_TYPES = ['String', 'Integer', 'Long', 'Boolean', 'BigDecimal', 'LocalDateTime', 'LocalDate', 'UUID', 'List'];

async function promptFields(label) {
  const fields = [];
  const { addFields } = await inquirer.prompt([{
    type: 'confirm',
    name: 'addFields',
    message: `Define ${label} fields?`,
    default: true,
  }]);

  if (!addFields) return fields;

  let adding = true;
  while (adding) {
    const { fieldName, fieldType, more } = await inquirer.prompt([
      {
        type: 'input',
        name: 'fieldName',
        message: `  ${label} field name:`,
        validate: (v) => (v.trim() ? true : 'Field name is required'),
      },
      {
        type: 'list',
        name: 'fieldType',
        message: `  ${label} field type:`,
        choices: COMMON_JAVA_TYPES,
      },
      {
        type: 'confirm',
        name: 'more',
        message: `  Add another ${label} field?`,
        default: false,
      },
    ]);
    fields.push({ name: fieldName.trim(), javaType: fieldType });
    adding = more;
  }

  return fields;
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
module.exports.generateSharedContracts = generateSharedContracts;
module.exports.buildActivityContext = buildActivityContext;
module.exports.parseActivitiesFromYaml = parseActivitiesFromYaml;
module.exports.parseCrossModuleActivities = parseCrossModuleActivities;
module.exports.resolveFieldImports = resolveFieldImports;
module.exports.mapField = mapField;
