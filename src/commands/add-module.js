const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const SharedGenerator = require('../generators/shared-generator');
const ModuleGenerator = require('../generators/module-generator');
const { buildModuleContext } = require('../utils/context-builder');
const { validateModuleName, isEva4jProject, moduleExists } = require('../utils/validator');
const { toPackagePath } = require('../utils/naming');
const ConfigManager = require('../utils/config-manager');

async function addModuleCommand(moduleName, options) {
  const projectDir = process.cwd();
  
  // Validate we're in a Spring Boot project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in a Spring Boot project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }
  
  // Read build.gradle to get project info
  const buildGradle = await fs.readFile(path.join(projectDir, 'build.gradle'), 'utf-8');
  const groupMatch = buildGradle.match(/group\s*=\s*['"](.+)['"]/);
  const packageMatch = buildGradle.match(/package\s+([a-z.]+)/);
  
  if (!groupMatch) {
    console.error(chalk.red('❌ Could not determine project package'));
    process.exit(1);
  }
  
  // Extract package info from Application.java
  const srcJavaDir = path.join(projectDir, 'src', 'main', 'java');
  const javaFiles = await findJavaFiles(srcJavaDir);
  let packageName = '';
  
  for (const file of javaFiles) {
    if (file.includes('Application.java')) {
      const content = await fs.readFile(file, 'utf-8');
      const pkgMatch = content.match(/package\s+([a-zA-Z0-9_.]+);/);
      if (pkgMatch) {
        packageName = pkgMatch[1];
        break;
      }
    }
  }
  
  if (!packageName) {
    console.error(chalk.red('❌ Could not determine project package'));
    process.exit(1);
  }
  
  const packagePath = toPackagePath(packageName);
  
  // Validate module name
  const validation = validateModuleName(moduleName);
  if (validation !== true) {
    console.error(chalk.red(`❌ ${validation}`));
    process.exit(1);
  }
  
  // Check if module already exists (filesystem check)
  if (await moduleExists(projectDir, packagePath, moduleName)) {
    console.error(chalk.red(`❌ Module '${moduleName}' already exists`));
    process.exit(1);
  }
  
  // Check ConfigManager for module tracking
  const configManager = new ConfigManager(projectDir);
  let projectName = 'Project';
  
  if (await configManager.exists()) {
    if (await configManager.moduleExists(moduleName)) {
      console.error(chalk.red(`❌ Module '${moduleName}' is already registered`));
      process.exit(1);
    }
    // Load project config to get projectName
    const projectConfig = await configManager.loadProjectConfig();
    if (projectConfig && projectConfig.projectName) {
      projectName = projectConfig.projectName;
    }
  }
  
  // Prompt for module options
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'hasSoftDelete',
      message: 'Enable soft delete?',
      default: true
    },
    {
      type: 'confirm',
      name: 'hasAudit',
      message: 'Enable audit fields (createdAt, updatedAt)?',
      default: true
    }
  ]);
  
  const baseContext = {
    packageName,
    packagePath,
    projectName,
    groupId: groupMatch[1]
  };
  
  const moduleContext = buildModuleContext(baseContext, moduleName, answers);
  
  try {
    // Check if shared module needs to be generated
    const needsShared = await SharedGenerator.needsSharedModule(projectDir, packagePath);
    
    if (needsShared) {
      console.log(chalk.blue('\n📦 First module! Creating shared module...\n'));
      const sharedSpinner = ora('Generating shared module...').start();
      
      const sharedGenerator = new SharedGenerator(moduleContext);
      await sharedGenerator.generate();
      
      sharedSpinner.succeed(chalk.green('Shared module created ✨'));
      
      console.log(chalk.gray('  └── shared/'));
      console.log(chalk.gray('      ├── domain/ (BaseEntity, AuditableEntity, SoftDeletableEntity)'));
      console.log(chalk.gray('      ├── dto/ (ApiResponse, PageResponse, ErrorDetail)'));
      console.log(chalk.gray('      ├── enums/ (Status, Currency, ErrorCode)'));
      console.log(chalk.gray('      └── constants/'));
      console.log();
    }
    
    // Generate module
    const moduleSpinner = ora(`Generating ${moduleName} module...`).start();
    
    const moduleGenerator = new ModuleGenerator(moduleContext);
    await moduleGenerator.generate();
    
    moduleSpinner.succeed(chalk.green(`Module '${moduleName}' created successfully! ✨`));
    
    console.log(chalk.blue(`\n📦 Module structure:`));
    console.log(chalk.gray(`  └── ${moduleName}/`));
    console.log(chalk.gray(`      ├── package-info.java (@ApplicationModule)`));
    console.log(chalk.gray(`      ├── application/`));
    console.log(chalk.gray(`      │   ├── commands/ (write operations)`));
    console.log(chalk.gray(`      │   ├── dtos/ (data transfer objects)`));
    console.log(chalk.gray(`      │   ├── mappers/ (entity-dto conversions)`));
    console.log(chalk.gray(`      │   ├── events/ (domain events)`));
    console.log(chalk.gray(`      │   ├── ports/ (interfaces)`));
    console.log(chalk.gray(`      │   ├── queries/ (read operations)`));
    console.log(chalk.gray(`      │   └── usecases/ (application logic)`));
    console.log(chalk.gray(`      ├── domain/`));
    console.log(chalk.gray(`      │   ├── models/`));
    console.log(chalk.gray(`      │   │   ├── entities/`));
    console.log(chalk.gray(`      │   │   └── valueObjects/`));
    console.log(chalk.gray(`      │   ├── repositories/ (domain interfaces)`));
    console.log(chalk.gray(`      │   └── services/ (domain services)`));
    console.log(chalk.gray(`      └── infrastructure/`));
    console.log(chalk.gray(`          ├── adapters/ (external adapters)`));
    console.log(chalk.gray(`          ├── database/ (repository implementations)`));
    console.log(chalk.gray(`          └── rest/`));
    console.log(chalk.gray(`              ├── controllers/ (REST controllers)`));
    console.log(chalk.gray(`              └── validators/ (request validators)`));
    
    console.log(chalk.blue('\n✅ Module created successfully!'));
    console.log(chalk.white(`\n   Module: ${moduleName}`));
    console.log(chalk.gray(`   Package: ${moduleContext.packageName}.${moduleName}`));
    
    // Save module to configuration
    if (await configManager.exists()) {
      await configManager.addModule(moduleName, {
        hasSoftDelete: answers.hasSoftDelete,
        hasAudit: answers.hasAudit
      });
      console.log(chalk.gray('   Configuration saved to .eva4j.json'));
    }
    console.log();
    
  } catch (error) {
    console.error(chalk.red('\n❌ Failed to create module'));
    console.error(chalk.red(error.message));
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

async function findJavaFiles(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await findJavaFiles(fullPath, files);
    } else if (entry.name.endsWith('.java')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

module.exports = addModuleCommand;
