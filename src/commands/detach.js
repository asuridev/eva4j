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
      springdocVersion: projectConfig.springdocVersion || defaults.springdocVersion,
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
    
    spinner.text = 'Copying Gradle wrapper...';
    
    // Step 4: Copy Gradle wrapper from parent project
    await copyGradleWrapper(projectDir, newProjectDir);
    
    spinner.text = 'Copying module files...';
    
    // Step 5: Copy module directory
    const newModuleDir = path.join(newProjectDir, 'src', 'main', 'java', packagePath, moduleName);
    await fs.copy(moduleDir, newModuleDir);
    
    spinner.text = 'Merging shared components...';
    
    // Step 6: Merge shared/domain into module/domain (filtering modulith-only components)
    await mergeSharedComponents(
      sharedDir,
      newModuleDir,
      packageName,
      moduleName
    );
    
    spinner.text = 'Updating package references...';
    
    // Step 7: Update all imports in module files
    await updatePackageReferences(
      newModuleDir,
      packageName,
      moduleName
    );
    
    spinner.text = 'Cleaning up...';
    
    // Step 8: Remove package-info.java files
    await removePackageInfoFiles(newModuleDir);
    
    // Step 9: Copy test files if they exist
    const testModuleDir = path.join(projectDir, 'src', 'test', 'java', packagePath, moduleName);
    if (await fs.pathExists(testModuleDir)) {
      const newTestModuleDir = path.join(newProjectDir, 'src', 'test', 'java', packagePath, moduleName);
      await fs.copy(testModuleDir, newTestModuleDir);
      await updatePackageReferences(newTestModuleDir, packageName, moduleName);
    }
    
    // Step 10: Create detached project configuration
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
    
    // Step 11: Copy parameter files from parent (kafka.yaml, urls.yaml, etc.)
    await copyParameterFiles(projectDir, newProjectDir, packageName, moduleName);
    
    // Step 12: Copy domain.yaml specification if it exists
    await copyDomainYaml(projectDir, newProjectDir, moduleName);
    
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
  
  // Replace package declaration for application files
  // package com.example.shared.application -> package com.example.{moduleName}.application
  const packageApplicationPattern = new RegExp(
    `^package\\s+${packageName.replace(/\./g, '\\.')}\\.shared\\.application`,
    'gm'
  );
  transformed = transformed.replace(packageApplicationPattern, `package ${packageName}.${moduleName}.application`);
  
  // Replace import statements for application
  const importApplicationPattern = new RegExp(
    `${packageName.replace(/\./g, '\\.')}\\.shared\\.application\\.`,
    'g'
  );
  transformed = transformed.replace(importApplicationPattern, `${packageName}.${moduleName}.application.`);
  
  return transformed;
}

/**
 * Directories that are specific to Spring Modulith (modular monolith)
 * and should NOT be copied when detaching to a standalone microservice.
 */
const MODULITH_ONLY_DIRS = new Set([
  'eventPublicationConfig',  // Spring Modulith event_publication table
  'mockEvent',               // In-memory event surrogate for mock mode
]);

/**
 * Files specific to Spring Modulith that should be skipped during merge.
 */
const MODULITH_ONLY_FILES = new Set([
  'package-info.java',  // Contains @ApplicationModule(type = OPEN)
]);

/**
 * Merge shared components into module structure, filtering out modulith-only components.
 */
async function mergeSharedComponents(sharedDir, moduleDir, packageName, moduleName) {
  const layers = ['domain', 'infrastructure', 'application'];

  for (const layer of layers) {
    const sharedLayerDir = path.join(sharedDir, layer);
    if (!(await fs.pathExists(sharedLayerDir))) continue;

    const entries = await fs.readdir(sharedLayerDir);
    for (const entry of entries) {
      const sourcePath = path.join(sharedLayerDir, entry);
      const stat = await fs.stat(sourcePath);

      if (stat.isDirectory()) {
        if (MODULITH_ONLY_DIRS.has(entry)) continue;
        const destPath = path.join(moduleDir, layer, entry);
        await copyAndTransformDirectory(sourcePath, destPath, packageName, moduleName);
      } else if (stat.isFile() && entry.endsWith('.java')) {
        if (MODULITH_ONLY_FILES.has(entry)) continue;
        const destPath = path.join(moduleDir, layer, entry);
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
    
    // Replace package declarations for application
    const packageApplicationPattern = new RegExp(
      `^package\\s+${packageName.replace(/\./g, '\\.')}\\.shared\\.application`,
      'gm'
    );
    if (packageApplicationPattern.test(content)) {
      content = content.replace(packageApplicationPattern, `package ${packageName}.${moduleName}.application`);
      modified = true;
    }
    
    // Replace shared.application.* imports with moduleName.application.*
    const applicationPattern = new RegExp(`${packageName.replace(/\./g, '\\.')}\\.shared\\.application\\.`, 'g');
    if (applicationPattern.test(content)) {
      content = content.replace(applicationPattern, `${packageName}.${moduleName}.application.`);
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
 * Copy Gradle wrapper files from parent project to detached project.
 * Includes gradlew, gradlew.bat, and gradle/wrapper/ directory.
 */
async function copyGradleWrapper(parentDir, newProjectDir) {
  const wrapperFiles = ['gradlew', 'gradlew.bat'];
  for (const file of wrapperFiles) {
    const src = path.join(parentDir, file);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(newProjectDir, file));
    }
  }

  const wrapperDir = path.join(parentDir, 'gradle', 'wrapper');
  if (await fs.pathExists(wrapperDir)) {
    await fs.copy(wrapperDir, path.join(newProjectDir, 'gradle', 'wrapper'));
  }
}

/**
 * Copy parameter files (kafka.yaml, urls.yaml, etc.) from parent to detached project.
 * Updates package references from shared to module name.
 * Adds missing imports to application-{env}.yaml files.
 */
async function copyParameterFiles(parentDir, newProjectDir, packageName, moduleName) {
  const parentParametersDir = path.join(parentDir, 'src', 'main', 'resources', 'parameters');
  const newParametersDir = path.join(newProjectDir, 'src', 'main', 'resources', 'parameters');

  if (!(await fs.pathExists(parentParametersDir))) return;

  await fs.copy(parentParametersDir, newParametersDir);

  // Update package references in yaml config files (kafka.yaml, urls.yaml, etc.)
  const environments = ['local', 'develop', 'test', 'production'];
  const sharedPattern = new RegExp(
    `${packageName.replace(/\./g, '\\.')}\\.shared\\.infrastructure\\.`,
    'g'
  );

  // Base config files that BaseGenerator already imports (db.yaml, cors.yaml)
  const baseImports = new Set(['db.yaml', 'cors.yaml']);

  for (const env of environments) {
    const envDir = path.join(newParametersDir, env);
    if (!(await fs.pathExists(envDir))) continue;

    const files = await fs.readdir(envDir);
    const extraImports = [];

    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

      // Update package references
      const filePath = path.join(envDir, file);
      let content = await fs.readFile(filePath, 'utf-8');
      if (sharedPattern.test(content)) {
        content = content.replace(sharedPattern, `${packageName}.${moduleName}.infrastructure.`);
        await fs.writeFile(filePath, content, 'utf-8');
      }
      sharedPattern.lastIndex = 0;

      // Collect extra parameter files that need imports
      if (!baseImports.has(file)) {
        extraImports.push(`classpath:parameters/${env}/${file}`);
      }
    }

    // Add missing imports to application-{env}.yaml
    if (extraImports.length > 0) {
      await addMissingImports(newProjectDir, env, extraImports);
    }
  }
}

/**
 * Add missing classpath imports to an application-{env}.yaml file.
 */
async function addMissingImports(projectDir, env, imports) {
  const appYmlPath = path.join(projectDir, 'src', 'main', 'resources', `application-${env}.yaml`);
  if (!(await fs.pathExists(appYmlPath))) return;

  let content = await fs.readFile(appYmlPath, 'utf-8');

  const linesToAdd = imports.filter(imp => !content.includes(imp));
  if (linesToAdd.length === 0) return;

  // Append after existing import entries
  const importPattern = /(spring:\s*\n\s*config:\s*\n\s*import:\s*\n(?:\s*-\s*"[^"]+"\s*\n)*)/;
  if (importPattern.test(content)) {
    const suffix = linesToAdd.map(imp => `      - "${imp}"`).join('\n') + '\n';
    content = content.replace(importPattern, `$1${suffix}`);
  }

  await fs.writeFile(appYmlPath, content, 'utf-8');
}

/**
 * Copy domain.yaml specification for the module if it exists.
 * Looks in system/{moduleName}.yaml and domain.yaml at project root.
 */
async function copyDomainYaml(parentDir, newProjectDir, moduleName) {
  // Try system/{moduleName}.yaml first (multi-module system layout)
  const systemYaml = path.join(parentDir, 'system', `${moduleName}.yaml`);
  if (await fs.pathExists(systemYaml)) {
    await fs.ensureDir(path.join(newProjectDir, 'system'));
    await fs.copy(systemYaml, path.join(newProjectDir, 'system', `${moduleName}.yaml`));
    return;
  }

  // Fallback: domain.yaml at project root (single-module layout)
  const domainYaml = path.join(parentDir, 'domain.yaml');
  if (await fs.pathExists(domainYaml)) {
    await fs.copy(domainYaml, path.join(newProjectDir, 'domain.yaml'));
  }
}

module.exports = detachCommand;
