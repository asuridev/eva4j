const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toPackagePath, toPascalCase, pluralizeWord, toKebabCase } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');

/**
 * Generate REST resource with CRUD operations and corresponding use cases
 * @param {string} moduleName - Name of the module
 */
async function generateResourceCommand(moduleName) {
  const projectDir = process.cwd();

  // Validate eva4j project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('   Run this command from the root of an eva4j project'));
    process.exit(1);
  }

  // Load project configuration
  const configManager = new ConfigManager(projectDir);
  const projectConfig = await configManager.loadProjectConfig();
  const { packageName } = projectConfig;
  const packagePath = toPackagePath(packageName);

  // Validate module exists
  if (!(await configManager.moduleExists(moduleName))) {
    console.error(chalk.red(`❌ Module '${moduleName}' not found in project`));
    console.error(chalk.gray('   Available modules:'));
    const modules = projectConfig.modules || [];
    modules.forEach(mod => console.error(chalk.gray(`   - ${mod}`)));
    process.exit(1);
  }

  // Prompt for resource name
  const { resourceName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'resourceName',
      message: 'Enter the resource name (e.g., user, product, order-item):',
      default: moduleName,
      validate: (input) => {
        if (!input || input.trim().length === 0) {
          return 'Resource name is required';
        }
        if (!/^[a-zA-Z][a-zA-Z0-9-_]*$/.test(input.trim())) {
          return 'Resource name must contain only letters, numbers, hyphens, and underscores';
        }
        return true;
      },
      filter: (input) => toPascalCase(input.trim())
    }
  ]);

  // Prompt for API version
  const { apiVersion } = await inquirer.prompt([
    {
      type: 'input',
      name: 'apiVersion',
      message: 'Enter the API version (e.g., v1, v2):',
      default: 'v1',
      validate: (input) => {
        if (!input || input.trim().length === 0) {
          return 'API version is required';
        }
        if (!/^v\d+$/.test(input.trim())) {
          return 'API version must follow the pattern v1, v2, v3, etc.';
        }
        return true;
      },
      filter: (input) => input.trim().toLowerCase()
    }
  ]);

  const spinner = ora('Generating resource...').start();

  try {
    const resourceNameKebab = toKebabCase(resourceName);
    const resourceNameCamel = resourceName.charAt(0).toLowerCase() + resourceName.slice(1);
    const resourceNamePlural = pluralizeWord(resourceName);

    // Check if controller already exists
    const controllerPath = path.join(
      projectDir,
      'src',
      'main',
      'java',
      packagePath,
      moduleName,
      'infrastructure',
      'rest',
      'controllers',
      resourceNameCamel,
      apiVersion,
      `${resourceName}Controller.java`
    );

    if (await fs.pathExists(controllerPath)) {
      spinner.fail(chalk.red('Resource already exists'));
      console.error(chalk.red(`\n❌ Resource already exists at:`));
      console.error(chalk.gray(`   ${moduleName}/infrastructure/rest/controllers/${resourceNameCamel}/${apiVersion}/${resourceName}Controller.java`));
      process.exit(1);
    }

    // Define use cases to generate
    const useCases = [
      {
        name: `Create${resourceName}`,
        type: 'command',
        description: 'Create new resource',
        hasId: false
      },
      {
        name: `Update${resourceName}`,
        type: 'command',
        description: 'Update existing resource',
        hasId: true
      },
      {
        name: `Delete${resourceName}`,
        type: 'command',
        description: 'Delete resource',
        hasId: true
      },
      {
        name: `Find${resourceName}ById`,
        type: 'query',
        description: 'Find resource by ID',
        hasId: true
      },
      {
        name: `FindAll${resourceNamePlural}`,
        type: 'query',
        description: 'Find all resources',
        hasId: false
      }
    ];

    const moduleBasePath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName);

    // Generate single ResponseDto for the resource
    spinner.text = 'Generating Response DTO...';
    const dtoPath = path.join(moduleBasePath, 'application', 'dtos', `${resourceName}ResponseDto.java`);
    if (!fs.existsSync(dtoPath)) {
      const dtoContext = {
        packageName,
        moduleName,
        resourceName
      };
      const dtoTemplatePath = path.join(__dirname, '..', '..', 'templates', 'resource', 'ResponseDto.java.ejs');
      await renderAndWrite(dtoTemplatePath, dtoPath, dtoContext);
    }

    // Generate use cases
    for (const useCase of useCases) {
      spinner.text = `Generating ${useCase.name}...`;

      const context = {
        packageName,
        moduleName,
        resourceName,
        usecaseName: useCase.name,
        hasId: useCase.hasId || false,
        isFindAll: require('../utils/naming').isAllTypeQuery(useCase.name)
      };

      if (useCase.type === 'command') {
        // Generate Command
        const commandPath = path.join(moduleBasePath, 'application', 'commands', `${useCase.name}Command.java`);
        const commandTemplatePath = path.join(__dirname, '..', '..', 'templates', 'resource', 'Command.java.ejs');
        await renderAndWrite(commandTemplatePath, commandPath, context);

        // Generate CommandHandler
        const handlerPath = path.join(moduleBasePath, 'application', 'usecases', `${useCase.name}CommandHandler.java`);
        const handlerTemplatePath = path.join(__dirname, '..', '..', 'templates', 'resource', 'CommandHandler.java.ejs');
        await renderAndWrite(handlerTemplatePath, handlerPath, context);

      } else if (useCase.type === 'query') {
        // Generate Query
        const queryPath = path.join(moduleBasePath, 'application', 'queries', `${useCase.name}Query.java`);
        const queryTemplatePath = path.join(__dirname, '..', '..', 'templates', 'resource', 'Query.java.ejs');
        await renderAndWrite(queryTemplatePath, queryPath, context);

        // Generate QueryHandler
        const handlerPath = path.join(moduleBasePath, 'application', 'usecases', `${useCase.name}QueryHandler.java`);
        const handlerTemplatePath = path.join(__dirname, '..', '..', 'templates', 'resource', 'QueryHandler.java.ejs');
        await renderAndWrite(handlerTemplatePath, handlerPath, context);
      }
    }

    // Generate Controller
    spinner.text = 'Generating REST controller...';
    const controllerContext = {
      packageName,
      moduleName,
      resourceName,
      resourceNamePlural,
      resourceNameKebab,
      apiVersion,
      resourceNameCamel
    };

    const controllerTemplatePath = path.join(__dirname, '..', '..', 'templates', 'resource', 'Controller.java.ejs');
    await renderAndWrite(controllerTemplatePath, controllerPath, controllerContext);

    spinner.succeed(chalk.green('✨ Resource generated successfully!'));

    // Display generated components
    console.log(chalk.blue('\n📦 Generated files:'));
    console.log(chalk.gray(`  └── ${moduleName}/`));
    console.log(chalk.gray('      ├── application/'));
    console.log(chalk.gray('      │   ├── commands/'));
    useCases.filter(u => u.type === 'command').forEach(u => {
      console.log(chalk.gray(`      │   │   └── ${u.name}Command.java`));
    });
    console.log(chalk.gray('      │   ├── queries/'));
    useCases.filter(u => u.type === 'query').forEach(u => {
      console.log(chalk.gray(`      │   │   └── ${u.name}Query.java`));
    });
    console.log(chalk.gray('      │   ├── usecases/'));
    useCases.forEach(u => {
      const suffix = u.type === 'command' ? 'CommandHandler' : 'QueryHandler';
      console.log(chalk.gray(`      │   │   └── ${u.name}${suffix}.java`));
    });
    console.log(chalk.gray('      │   └── dtos/'));
    useCases.filter(u => u.type === 'query').forEach(u => {
      console.log(chalk.gray(`      │   │   └── ${u.name}ResponseDto.java`));
    });
    console.log(chalk.gray('      └── infrastructure/'));
    console.log(chalk.gray('          └── rest/'));
    console.log(chalk.gray('              └── controllers/'));
    console.log(chalk.gray(`                  └── ${resourceName}/`));
    console.log(chalk.gray(`                      └── ${apiVersion}/`));
    console.log(chalk.gray(`                          └── ${resourceName}Controller.java`));

    console.log(chalk.blue('\n📝 CRUD Endpoints:'));
    console.log(chalk.gray(`  POST   /api/${apiVersion}/${resourceNameKebab}         - Create ${resourceName}`));
    console.log(chalk.gray(`  GET    /api/${apiVersion}/${resourceNameKebab}/{id}    - Get ${resourceName} by ID`));
    console.log(chalk.gray(`  GET    /api/${apiVersion}/${resourceNameKebab}         - Get all ${resourceNamePlural}`));
    console.log(chalk.gray(`  PUT    /api/${apiVersion}/${resourceNameKebab}/{id}    - Update ${resourceName}`));
    console.log(chalk.gray(`  DELETE /api/${apiVersion}/${resourceNameKebab}/{id}    - Delete ${resourceName}`));

    console.log(chalk.yellow('\n⚠️  Next steps:'));
    console.log(chalk.gray('  1. Add fields to Command and Query records'));
    console.log(chalk.gray('  2. Implement business logic in handlers'));
    console.log(chalk.gray('  3. Add validation annotations to Commands'));
    console.log(chalk.gray('  4. Define response fields in ResponseDtos'));
    console.log(chalk.gray('  5. Inject dependencies in handlers'));

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate resource'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

module.exports = generateResourceCommand;
