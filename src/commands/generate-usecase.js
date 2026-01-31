const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject, moduleExists } = require('../utils/validator');
const { toPackagePath, toPascalCase } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');

async function generateUsecaseCommand(moduleName, usecaseName) {
  const projectDir = process.cwd();
  
  // Validate we're in an eva4j project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  // Load project configuration
  const configManager = new ConfigManager(projectDir);
  const projectConfig = await configManager.loadProjectConfig();
  
  if (!projectConfig) {
    console.error(chalk.red('❌ Could not load project configuration'));
    console.error(chalk.gray('Make sure .eva4j.json exists in the project root'));
    process.exit(1);
  }

  const { packageName } = projectConfig;
  const packagePath = toPackagePath(packageName);

  // Validate module exists
  if (!(await configManager.moduleExists(moduleName))) {
    console.error(chalk.red(`❌ Module '${moduleName}' not found in project configuration`));
    console.error(chalk.gray('Create the module first using: eva4j add module <name>'));
    process.exit(1);
  }

  if (!(await moduleExists(projectDir, packagePath, moduleName))) {
    console.error(chalk.red(`❌ Module '${moduleName}' does not exist in filesystem`));
    process.exit(1);
  }

  // Prompt for use case name if not provided
  if (!usecaseName) {
    const nameAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'usecaseName',
        message: 'Enter use case name:',
        validate: (input) => {
          if (!input || input.trim() === '') {
            return 'Use case name cannot be empty';
          }
          return true;
        }
      }
    ]);
    usecaseName = nameAnswer.usecaseName;
  }

  // Normalize usecase name to PascalCase
  const normalizedUsecaseName = toPascalCase(usecaseName);

  // Prompt for use case type
  const { usecaseType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'usecaseType',
      message: 'Select use case type:',
      choices: [
        { name: 'Command (Write operation)', value: 'command' },
        { name: 'Query (Read operation)', value: 'query' }
      ]
    }
  ]);

  const moduleBasePath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName);

  // Check if files already exist
  if (usecaseType === 'command') {
    const commandPath = path.join(moduleBasePath, 'application', 'commands', `${normalizedUsecaseName}Command.java`);
    const handlerPath = path.join(moduleBasePath, 'application', 'usecases', `${normalizedUsecaseName}CommandHandler.java`);
    
    if (await fs.pathExists(commandPath)) {
      console.error(chalk.red(`❌ Command already exists: ${normalizedUsecaseName}Command.java`));
      process.exit(1);
    }
    if (await fs.pathExists(handlerPath)) {
      console.error(chalk.red(`❌ Handler already exists: ${normalizedUsecaseName}CommandHandler.java`));
      process.exit(1);
    }
  } else {
    const dtoPath = path.join(moduleBasePath, 'application', 'dtos', `${normalizedUsecaseName}ResponseDto.java`);
    const queryPath = path.join(moduleBasePath, 'application', 'queries', `${normalizedUsecaseName}Query.java`);
    const handlerPath = path.join(moduleBasePath, 'application', 'usecases', `${normalizedUsecaseName}QueryHandler.java`);
    
    if (await fs.pathExists(dtoPath)) {
      console.error(chalk.red(`❌ Response DTO already exists: ${normalizedUsecaseName}ResponseDto.java`));
      process.exit(1);
    }
    if (await fs.pathExists(queryPath)) {
      console.error(chalk.red(`❌ Query already exists: ${normalizedUsecaseName}Query.java`));
      process.exit(1);
    }
    if (await fs.pathExists(handlerPath)) {
      console.error(chalk.red(`❌ Handler already exists: ${normalizedUsecaseName}QueryHandler.java`));
      process.exit(1);
    }
  }

  const spinner = ora(`Generating ${usecaseType} use case...`).start();

  try {
    const context = {
      packageName,
      moduleName,
      usecaseName: normalizedUsecaseName,
      isFindAll: require('../utils/naming').isAllTypeQuery(normalizedUsecaseName)
    };

    if (usecaseType === 'command') {
      await generateCommand(projectDir, moduleBasePath, context);
      
      spinner.succeed(chalk.green('Command use case generated successfully! ✨'));
      
      console.log(chalk.blue('\n📦 Generated files:'));
      console.log(chalk.gray(`  ├── application/commands/${normalizedUsecaseName}Command.java`));
      console.log(chalk.gray(`  └── application/usecases/${normalizedUsecaseName}CommandHandler.java`));
    } else {
      await generateQuery(projectDir, moduleBasePath, context);
      
      spinner.succeed(chalk.green('Query use case generated successfully! ✨'));
      
      console.log(chalk.blue('\n📦 Generated files:'));
      console.log(chalk.gray(`  ├── application/dtos/${normalizedUsecaseName}ResponseDto.java`));
      console.log(chalk.gray(`  ├── application/queries/${normalizedUsecaseName}Query.java`));
      console.log(chalk.gray(`  └── application/usecases/${normalizedUsecaseName}QueryHandler.java`));
    }

    console.log(chalk.blue('\n✅ Use case created successfully!'));
    console.log(chalk.white(`\n   Type: ${usecaseType}`));
    console.log(chalk.white(`   Module: ${moduleName}`));
    console.log(chalk.white(`   Name: ${normalizedUsecaseName}`));
    console.log();

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate use case'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

/**
 * Generate Command files (record and handler)
 */
async function generateCommand(projectDir, moduleBasePath, context) {
  const templatesDir = path.join(__dirname, '..', '..', 'templates', 'usecase', 'command');
  
  // Generate Command record
  const commandTemplate = path.join(templatesDir, 'Command.java.ejs');
  const commandOutput = path.join(moduleBasePath, 'application', 'commands', `${context.usecaseName}Command.java`);
  await renderAndWrite(commandTemplate, commandOutput, context);

  // Generate CommandHandler class
  const handlerTemplate = path.join(templatesDir, 'CommandHandler.java.ejs');
  const handlerOutput = path.join(moduleBasePath, 'application', 'usecases', `${context.usecaseName}CommandHandler.java`);
  await renderAndWrite(handlerTemplate, handlerOutput, context);
}

/**
 * Generate Query files (DTO, record, and handler)
 */
async function generateQuery(projectDir, moduleBasePath, context) {
  const templatesDir = path.join(__dirname, '..', '..', 'templates', 'usecase', 'query');
  
  // Generate Response DTO
  const dtoTemplate = path.join(templatesDir, 'ResponseDto.java.ejs');
  const dtoOutput = path.join(moduleBasePath, 'application', 'dtos', `${context.usecaseName}ResponseDto.java`);
  await renderAndWrite(dtoTemplate, dtoOutput, context);

  // Generate Query record
  const queryTemplate = path.join(templatesDir, 'Query.java.ejs');
  const queryOutput = path.join(moduleBasePath, 'application', 'queries', `${context.usecaseName}Query.java`);
  await renderAndWrite(queryTemplate, queryOutput, context);

  // Generate QueryHandler class
  const handlerTemplate = path.join(templatesDir, 'QueryHandler.java.ejs');
  const handlerOutput = path.join(moduleBasePath, 'application', 'usecases', `${context.usecaseName}QueryHandler.java`);
  await renderAndWrite(handlerTemplate, handlerOutput, context);
}

module.exports = generateUsecaseCommand;
