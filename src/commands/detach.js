const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const BaseGenerator = require('../generators/base-generator');
const { buildBaseContext } = require('../utils/context-builder');
const { validateModuleName, isEva4jProject, moduleExists } = require('../utils/validator');
const { toPackagePath, toPascalCase, getApplicationClassName } = require('../utils/naming');
const ConfigManager = require('../utils/config-manager');
const defaults = require('../../config/defaults.json');

/**
 * Detach a module from the monolith and create a standalone microservice
 */
async function detachCommand(moduleName, options) {
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
  
  const { packageName, packagePath: parentPackagePath } = projectConfig;
  const packagePath = toPackagePath(packageName);
  
  // Prompt for module name if not provided
  if (!moduleName) {
    const nameAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'moduleName',
        message: 'Enter module name to detach:',
        validate: (input) => {
          const validation = validateModuleName(input);
          if (validation !== true) {
            return validation;
          }
          return true;
        }
      }
    ]);
    moduleName = nameAnswer.moduleName;
  }
  
  // Validate module exists
  const moduleDir = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName);
  if (!(await fs.pathExists(moduleDir))) {
    console.error(chalk.red(`❌ Module "${moduleName}" not found`));
    console.error(chalk.gray(`Expected location: src/main/java/${packagePath}/${moduleName}`));
    process.exit(1);
  }
  
  // Check if module is registered in config
  const moduleConfig = projectConfig.modules?.find(m => m.name === moduleName);
  if (!moduleConfig) {
    console.error(chalk.yellow(`⚠️  Module "${moduleName}" not found in .eva4j.json`));
    const continueAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continue',
        message: 'Continue anyway?',
        default: false
      }
    ]);
    if (!continueAnswer.continue) {
      process.exit(0);
    }
  }
  
  // Determine new project name and path
  const newProjectName = `${moduleName}_msvc`;
  const parentDir = path.dirname(projectDir);
  const newProjectDir = path.join(parentDir, newProjectName);
  
  // Check if destination already exists
  if (await fs.pathExists(newProjectDir)) {
    console.error(chalk.red(`❌ Destination directory already exists: ${newProjectName}`));
    console.error(chalk.gray('Please remove or rename the existing directory'));
    process.exit(1);
  }
  
  // Get current server port and increment
  const applicationYml = await fs.readFile(
    path.join(projectDir, 'src', 'main', 'resources', 'application.yaml'),
    'utf-8'
  );
  const portMatch = applicationYml.match(/port:\s*(\d+)/);
  const parentPort = portMatch ? parseInt(portMatch[1]) : 8040;
  const newPort = parentPort + 1;
  
  // Check if shared module exists (needed for copying)
  const sharedDir = path.join(projectDir, 'src', 'main', 'java', packagePath, 'shared');
  if (!(await fs.pathExists(sharedDir))) {
    console.error(chalk.red('❌ Shared module not found'));
    console.error(chalk.gray('The project must have a shared module to detach a module'));
    process.exit(1);
  }
  
  // Show confirmation prompt
  console.log(chalk.blue('\n📦 Module Detachment Summary:'));
  console.log(chalk.gray('─────────────────────────────────────'));
  console.log(chalk.white(`  Module:           ${moduleName}`));
  console.log(chalk.white(`  New Project:      ${newProjectName}`));
  console.log(chalk.white(`  Location:         ${newProjectDir}`));
  console.log(chalk.white(`  Package:          ${packageName}.${moduleName}`));
  console.log(chalk.white(`  Parent Port:      ${parentPort}`));
  console.log(chalk.white(`  New Port:         ${newPort}`));
  console.log(chalk.white(`  Database:         ${projectConfig.groupId || 'Same as parent'}`));
  console.log(chalk.gray('─────────────────────────────────────'));
  
  const confirmAnswer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Proceed with module detachment?',
      default: false
    }
  ]);
  
  if (!confirmAnswer.confirm) {
    console.log(chalk.gray('Detachment cancelled'));
    process.exit(0);
  }
  
  const spinner = ora('Detaching module...').start();
  
  try {
    // Step 1: Create new project directory
    await fs.ensureDir(newProjectDir);
    
    // Step 2: Build context for new project
    // Use database type from parent project config
    const databaseType = projectConfig.databaseType || 'h2';
    const databaseName = newProjectName.replace(/-/g, '_');
    
    const dbConfig = {
      h2: {
        driver: 'com.h2.database:h2',
        driverClass: 'org.h2.Driver',
        url: `jdbc:h2:mem:${databaseName}`,
        username: 'sa',
        password: '',
        hibernateDialect: 'org.hibernate.dialect.H2Dialect',
        testcontainer: 'h2'
      },
      postgresql: {
        driver: 'org.postgresql:postgresql',
        driverClass: 'org.postgresql.Driver',
        url: `jdbc:postgresql://localhost:5432/${databaseName}`,
        username: 'postgres',
        password: 'postgres',
        hibernateDialect: 'org.hibernate.dialect.PostgreSQLDialect',
        testcontainer: 'postgresql'
      },
      mysql: {
        driver: 'com.mysql:mysql-connector-j',
        driverClass: 'com.mysql.cj.jdbc.Driver',
        url: `jdbc:mysql://localhost:3306/${databaseName}`,
        username: 'root',
        password: 'root',
        hibernateDialect: 'org.hibernate.dialect.MySQLDialect',
        testcontainer: 'mysql'
      }
    };
    
    const dbSettings = dbConfig[databaseType];
    
    const detachedContext = {
      ...projectConfig,
      projectName: newProjectName,
      artifactId: moduleName,
      packagePath: toPackagePath(packageName),
      moduleName: moduleName,
      serverPort: newPort,
      applicationClassName: getApplicationClassName(newProjectName),
      version: '1.0.0',
      author: projectConfig.author || 'Eva4j',
      createdDate: new Date().toISOString().split('T')[0],
      dependencyManagementVersion: defaults.dependencyManagementVersion,
      springCloudVersion: projectConfig.springCloudVersion || defaults.springCloudVersion,
      gradleVersion: defaults.gradleVersion,
      license: 'MIT',
      description: `Detached microservice: ${newProjectName}`,
      contextPath: '/',
      isDetached: true,
      // Database configuration
      databaseType,
      databaseName,
      databaseDriver: dbSettings.driver,
      databaseDriverClass: dbSettings.driverClass,
      databaseUrl: dbSettings.url,
      databaseUsername: dbSettings.username,
      databasePassword: dbSettings.password,
      hibernateDialect: dbSettings.hibernateDialect,
      databaseTestcontainer: dbSettings.testcontainer,
      ddlAuto: 'update',
      showSql: true,
      loggingLevel: 'INFO',
      features: {
        enableScheduling: false,
        enableAsync: false,
        includeSwagger: true,
        includeDocker: true,
        includeLombok: true,
        includeDevtools: true,
        includeActuator: true,
        includeAudit: projectConfig.dependencies?.includes('data-jpa'),
        hasKafka: projectConfig.features?.includes('kafka') || false
      },
      testing: defaults.testing
    };
    
    spinner.text = 'Generating base project structure...';
    
    // Step 3: Generate base project using BaseGenerator
    await generateDetachedProject(newProjectDir, detachedContext);
    
    spinner.text = 'Copying module files...';
    
    // Step 4: Copy module directory
    const newModuleDir = path.join(newProjectDir, 'src', 'main', 'java', packagePath, moduleName);
    await fs.copy(moduleDir, newModuleDir);
    
    spinner.text = 'Merging shared components...';
    
    // Step 5: Merge shared/domain into module/domain
    await mergeSharedComponents(
      sharedDir,
      newModuleDir,
      packageName,
      moduleName
    );
    
    spinner.text = 'Updating package references...';
    
    // Step 6: Update all imports in module files
    await updatePackageReferences(
      newModuleDir,
      packageName,
      moduleName
    );
    
    spinner.text = 'Cleaning up...';
    
    // Step 7: Remove package-info.java files
    await removePackageInfoFiles(newModuleDir);
    
    // Step 8: Copy test files if they exist
    const testModuleDir = path.join(projectDir, 'src', 'test', 'java', packagePath, moduleName);
    if (await fs.pathExists(testModuleDir)) {
      const newTestModuleDir = path.join(newProjectDir, 'src', 'test', 'java', packagePath, moduleName);
      await fs.copy(testModuleDir, newTestModuleDir);
      await updatePackageReferences(newTestModuleDir, packageName, moduleName);
    }
    
    // Step 9: Create detached project configuration
    const detachedConfigManager = new ConfigManager(newProjectDir);
    await detachedConfigManager.saveProjectConfig({
      ...detachedContext,
      modules: [{
        name: moduleName,
        hasSoftDelete: moduleConfig?.hasSoftDelete ?? true,
        hasAudit: moduleConfig?.hasAudit ?? true,
        createdAt: new Date().toISOString()
      }]
    });
    
    spinner.text = 'Copying environment configurations...';
    
    // Step 10: Copy environment profile files from parent resources
    await copyEnvironmentProfiles(projectDir, newProjectDir, packageName, moduleName);
    
    spinner.succeed(chalk.green('✅ Module detached successfully! ✨'));
    
    // Display success message
    console.log(chalk.blue('\n📦 Detached Microservice Created:'));
    console.log(chalk.gray('─────────────────────────────────────'));
    console.log(chalk.white(`  Project:          ${newProjectName}`));
    console.log(chalk.white(`  Location:         ${newProjectDir}`));
    console.log(chalk.white(`  Port:             ${newPort}`));
    console.log(chalk.gray('─────────────────────────────────────'));
    console.log(chalk.blue('\n🚀 Next Steps:'));
    console.log(chalk.white(`  1. cd ${newProjectName}`));
    console.log(chalk.white(`  2. ./gradlew build`));
    console.log(chalk.white(`  3. ./gradlew bootRun`));
    console.log(chalk.gray('\n  The microservice will run on port ' + newPort));
    
  } catch (error) {
    spinner.fail(chalk.red('Failed to detach module'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

/**
 * Generate base project structure for detached microservice
 */
async function generateDetachedProject(projectDir, context) {
  const generator = new BaseGenerator(context);
  generator.projectDir = projectDir;
  await generator.generate();
}

/**
 * Transform shared file content by replacing package declarations and imports
 */
function transformSharedFileContent(content, packageName, moduleName) {
  let transformed = content;
  
  // Replace package declaration for domain files
  // package com.example.shared.domain -> package com.example.{moduleName}.domain
  const packageDomainPattern = new RegExp(
    `^package\\s+${packageName.replace(/\./g, '\\.')}\\.shared\\.domain`,
    'gm'
  );
  transformed = transformed.replace(packageDomainPattern, `package ${packageName}.${moduleName}.domain`);
  
  // Replace package declaration for infrastructure files
  // package com.example.shared.infrastructure -> package com.example.{moduleName}.infrastructure
  const packageInfraPattern = new RegExp(
    `^package\\s+${packageName.replace(/\./g, '\\.')}\\.shared\\.infrastructure`,
    'gm'
  );
  transformed = transformed.replace(packageInfraPattern, `package ${packageName}.${moduleName}.infrastructure`);
  
  // Replace import statements for domain
  const importDomainPattern = new RegExp(
    `${packageName.replace(/\./g, '\\.')}\\.shared\\.domain\\.`,
    'g'
  );
  transformed = transformed.replace(importDomainPattern, `${packageName}.${moduleName}.domain.`);
  
  // Replace import statements for infrastructure
  const importInfraPattern = new RegExp(
    `${packageName.replace(/\./g, '\\.')}\\.shared\\.infrastructure\\.`,
    'g'
  );
  transformed = transformed.replace(importInfraPattern, `${packageName}.${moduleName}.infrastructure.`);
  
  return transformed;
}

/**
 * Merge shared components into module structure
 */
async function mergeSharedComponents(sharedDir, moduleDir, packageName, moduleName) {
  // Merge shared/domain/* into module/domain/
  const sharedDomainDir = path.join(sharedDir, 'domain');
  if (await fs.pathExists(sharedDomainDir)) {
    const domainEntries = await fs.readdir(sharedDomainDir);
    for (const entry of domainEntries) {
      const sourcePath = path.join(sharedDomainDir, entry);
      const stat = await fs.stat(sourcePath);
      
      if (stat.isDirectory()) {
        // Copy and transform subdirectories (annotations, interfaces, customExceptions, etc.)
        const destPath = path.join(moduleDir, 'domain', entry);
        await copyAndTransformDirectory(sourcePath, destPath, packageName, moduleName);
      } else if (stat.isFile() && entry.endsWith('.java')) {
        // Copy and transform individual .java files (AuditableEntity.java, etc.)
        const destPath = path.join(moduleDir, 'domain', entry);
        if (!(await fs.pathExists(destPath))) {
          const content = await fs.readFile(sourcePath, 'utf-8');
          const transformed = transformSharedFileContent(content, packageName, moduleName);
          await fs.ensureDir(path.dirname(destPath));
          await fs.writeFile(destPath, transformed, 'utf-8');
        }
      }
    }
  }
  
  // Merge shared/infrastructure/* into module/infrastructure/
  const sharedInfraDir = path.join(sharedDir, 'infrastructure');
  if (await fs.pathExists(sharedInfraDir)) {
    const infraEntries = await fs.readdir(sharedInfraDir);
    for (const entry of infraEntries) {
      const sourcePath = path.join(sharedInfraDir, entry);
      const stat = await fs.stat(sourcePath);
      
      if (stat.isDirectory()) {
        // Copy and transform subdirectories
        const destPath = path.join(moduleDir, 'infrastructure', entry);
        await copyAndTransformDirectory(sourcePath, destPath, packageName, moduleName);
      } else if (stat.isFile() && entry.endsWith('.java')) {
        // Copy and transform individual .java files
        const destPath = path.join(moduleDir, 'infrastructure', entry);
        if (!(await fs.pathExists(destPath))) {
          const content = await fs.readFile(sourcePath, 'utf-8');
          const transformed = transformSharedFileContent(content, packageName, moduleName);
          await fs.ensureDir(path.dirname(destPath));
          await fs.writeFile(destPath, transformed, 'utf-8');
        }
      }
    }
  }
}

/**
 * Copy directory recursively and transform Java files
 */
async function copyAndTransformDirectory(sourceDir, destDir, packageName, moduleName) {
  await fs.ensureDir(destDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    
    if (entry.isDirectory()) {
      await copyAndTransformDirectory(sourcePath, destPath, packageName, moduleName);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.java') && !(await fs.pathExists(destPath))) {
        // Transform .java files
        const content = await fs.readFile(sourcePath, 'utf-8');
        const transformed = transformSharedFileContent(content, packageName, moduleName);
        await fs.writeFile(destPath, transformed, 'utf-8');
      } else if (!(await fs.pathExists(destPath))) {
        // Copy other files as-is
        await fs.copy(sourcePath, destPath);
      }
    }
  }
}

/**
 * Update package references in all Java files
 */
async function updatePackageReferences(directory, packageName, moduleName) {
  const javaFiles = await findJavaFiles(directory);
  
  for (const file of javaFiles) {
    let content = await fs.readFile(file, 'utf-8');
    let modified = false;
    
    // Replace package declarations for domain
    const packageDomainPattern = new RegExp(
      `^package\\s+${packageName.replace(/\./g, '\\.')}\\.shared\\.domain`,
      'gm'
    );
    if (packageDomainPattern.test(content)) {
      content = content.replace(packageDomainPattern, `package ${packageName}.${moduleName}.domain`);
      modified = true;
    }
    
    // Replace package declarations for infrastructure
    const packageInfraPattern = new RegExp(
      `^package\\s+${packageName.replace(/\./g, '\\.')}\\.shared\\.infrastructure`,
      'gm'
    );
    if (packageInfraPattern.test(content)) {
      content = content.replace(packageInfraPattern, `package ${packageName}.${moduleName}.infrastructure`);
      modified = true;
    }
    
    // Replace shared.domain.* imports with moduleName.domain.*
    const domainPattern = new RegExp(`${packageName.replace(/\./g, '\\.')}\\.shared\\.domain\\.`, 'g');
    if (domainPattern.test(content)) {
      content = content.replace(domainPattern, `${packageName}.${moduleName}.domain.`);
      modified = true;
    }
    
    // Replace shared.infrastructure.* imports with moduleName.infrastructure.*
    const infraPattern = new RegExp(`${packageName.replace(/\./g, '\\.')}\\.shared\\.infrastructure\\.`, 'g');
    if (infraPattern.test(content)) {
      content = content.replace(infraPattern, `${packageName}.${moduleName}.infrastructure.`);
      modified = true;
    }
    
    if (modified) {
      await fs.writeFile(file, content, 'utf-8');
    }
  }
}

/**
 * Remove all package-info.java files
 */
async function removePackageInfoFiles(directory) {
  const packageInfoFiles = await findPackageInfoFiles(directory);
  
  for (const file of packageInfoFiles) {
    await fs.remove(file);
  }
}

/**
 * Find all Java files recursively
 */
async function findJavaFiles(dir) {
  const files = [];
  
  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        files.push(fullPath);
      }
    }
  }
  
  await walk(dir);
  return files;
}

/**
 * Find all package-info.java files recursively
 */
async function findPackageInfoFiles(dir) {
  const files = [];
  
  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name === 'package-info.java') {
        files.push(fullPath);
      }
    }
  }
  
  await walk(dir);
  return files;
}

/**
 * Copy environment profile files from parent to detached project
 */
async function copyEnvironmentProfiles(parentDir, newProjectDir, packageName, moduleName) {
  const parentResourcesDir = path.join(parentDir, 'src', 'main', 'resources');
  const newResourcesDir = path.join(newProjectDir, 'src', 'main', 'resources');
  
  // Copy environment profile files
  const profileFiles = [
    'application-develop.yaml',
    'application-local.yaml',
    'application-production.yaml',
    'application-test.yaml'
  ];
  
  for (const file of profileFiles) {
    const sourcePath = path.join(parentResourcesDir, file);
    if (await fs.pathExists(sourcePath)) {
      await fs.copy(sourcePath, path.join(newResourcesDir, file));
    }
  }
  
  // Copy parameters folder if it exists
  const parametersDir = path.join(parentResourcesDir, 'parameters');
  if (await fs.pathExists(parametersDir)) {
    await fs.copy(parametersDir, path.join(newResourcesDir, 'parameters'));
    
    // Update package references in kafka.yaml files
    await updateKafkaConfigReferences(newResourcesDir, packageName, moduleName);
  }
}

/**
 * Update package references in kafka.yaml files
 */
async function updateKafkaConfigReferences(resourcesDir, packageName, moduleName) {
  const environments = ['local', 'develop', 'test', 'production'];
  
  for (const env of environments) {
    const kafkaYmlPath = path.join(resourcesDir, 'parameters', env, 'kafka.yaml');
    
    if (await fs.pathExists(kafkaYmlPath)) {
      let content = await fs.readFile(kafkaYmlPath, 'utf-8');
      
      // Replace .shared.infrastructure. with .{moduleName}.infrastructure.
      const pattern = new RegExp(`${packageName}\\.shared\\.infrastructure\\.`, 'g');
      content = content.replace(pattern, `${packageName}.${moduleName}.infrastructure.`);
      
      await fs.writeFile(kafkaYmlPath, content, 'utf-8');
    }
  }
}

module.exports = detachCommand;
