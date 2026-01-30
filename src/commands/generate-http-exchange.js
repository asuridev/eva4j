const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject, moduleExists } = require('../utils/validator');
const { toPackagePath, toPascalCase, toKebabCase, toCamelCase } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');

async function generateHttpExchangeCommand(moduleName, portName) {
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

  // Prompt for port name if not provided
  if (!portName) {
    const nameAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'portName',
        message: 'Enter port name:',
        validate: (input) => {
          if (!input || input.trim() === '') {
            return 'Port name cannot be empty';
          }
          return true;
        }
      }
    ]);
    portName = nameAnswer.portName;
  }

  // Normalize port name to PascalCase
  const normalizedPortName = toPascalCase(portName);

  const moduleBasePath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName);

  // Check if files already exist
  const portPath = path.join(moduleBasePath, 'application', 'ports', `${normalizedPortName}.java`);
  const adapterDir = path.join(moduleBasePath, 'infrastructure', 'adapters', toCamelCase(normalizedPortName));
  
  if (await fs.pathExists(portPath)) {
    console.error(chalk.red(`❌ Port already exists: ${normalizedPortName}.java`));
    process.exit(1);
  }
  if (await fs.pathExists(adapterDir)) {
    console.error(chalk.red(`❌ Adapter package already exists: ${toCamelCase(normalizedPortName)}/`));
    process.exit(1);
  }

  // Prompt for base URL
  const { baseUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Enter the base URL of the remote service:',
      default: 'http://localhost:8080',
      validate: (input) => {
        if (!input || input.trim() === '') {
          return 'Base URL is required';
        }
        try {
          new URL(input);
          return true;
        } catch (e) {
          return 'Please enter a valid URL (e.g., http://localhost:8080 or https://api.example.com)';
        }
      }
    }
  ]);

  const spinner = ora('Generating HTTP exchange adapter...').start();

  try {
    // Generate property name for base URL configuration with module prefix
    const baseUrlProperty = `${toKebabCase(moduleName)}.${toKebabCase(portName)}.base-url`;
    const feignClientName = `${toKebabCase(moduleName)}-${toKebabCase(portName)}`;

    const context = {
      packageName,
      moduleName,
      portName: normalizedPortName,
      portNameCamelCase: toCamelCase(normalizedPortName),
      baseUrl: baseUrl.trim(),
      baseUrlProperty,
      feignClientName
    };

    // Generate Port interface
    await generatePort(projectDir, moduleBasePath, context);

    // Generate Adapter (Feign Client)
    await generateAdapter(projectDir, moduleBasePath, context);

    // Create or update urls.yml configuration files
    const urlsConfigLocations = await createOrUpdateUrlsConfig(projectDir, baseUrlProperty, baseUrl.trim());

    // Ensure urls.yml is imported in all application-*.yml files
    await ensureUrlsImport(projectDir);

    spinner.succeed(chalk.green('HTTP exchange adapter generated successfully! ✨'));

    console.log(chalk.blue('\n📦 Generated files:'));
    console.log(chalk.gray(`  ├── application/ports/${normalizedPortName}.java`));
    console.log(chalk.gray(`  └── infrastructure/adapters/${toCamelCase(normalizedPortName)}/`));
    console.log(chalk.gray(`      ├── ${normalizedPortName}Adapter.java`));
    console.log(chalk.gray(`      ├── ${normalizedPortName}FeignClient.java`));
    console.log(chalk.gray(`      └── ${normalizedPortName}Config.java`));

    console.log(chalk.blue('\n⚙️  URL configuration added:'));
    console.log(chalk.white(`\n  Property: ${baseUrlProperty}`));
    console.log(chalk.white(`  Value: ${baseUrl}`));
    console.log(chalk.yellow(`\n  Configured in:`));
    urlsConfigLocations.forEach(location => {
      console.log(chalk.gray(`    • ${location}`));
    });

    console.log(chalk.blue('\n✅ HTTP exchange adapter created successfully!'));
    console.log(chalk.white(`\n   Port: ${normalizedPortName}`));
    console.log(chalk.white(`   Module: ${moduleName}`));
    console.log(chalk.white(`   Feign Client: ${feignClientName}`));
    console.log(chalk.gray('\n   ⚠️  Remember to customize endpoint paths and DTOs in generated files'));
    console.log();

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate HTTP exchange adapter'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

/**
 * Generate Port interface
 */
async function generatePort(projectDir, moduleBasePath, context) {
  const templatesDir = path.join(__dirname, '..', '..', 'templates', 'http-exchange');
  
  const portTemplate = path.join(templatesDir, 'Port.java.ejs');
  const portOutput = path.join(moduleBasePath, 'application', 'ports', `${context.portName}.java`);
  await renderAndWrite(portTemplate, portOutput, context);
}

/**
 * Generate Adapter (Feign Client interface)
 */
async function generateAdapter(projectDir, moduleBasePath, context) {
  const templatesDir = path.join(__dirname, '..', '..', 'templates', 'http-exchange');
  const adapterDir = path.join(moduleBasePath, 'infrastructure', 'adapters', context.portNameCamelCase);
  
  const adapterTemplate = path.join(templatesDir, 'Adapter.java.ejs');
  const adapterOutput = path.join(adapterDir, `${context.portName}Adapter.java`);
  await renderAndWrite(adapterTemplate, adapterOutput, context);

  const feignClientTemplate = path.join(templatesDir, 'FeignClient.java.ejs');
  const feignClientOutput = path.join(adapterDir, `${context.portName}FeignClient.java`);
  await renderAndWrite(feignClientTemplate, feignClientOutput, context);

  const configTemplate = path.join(templatesDir, 'Config.java.ejs');
  const configOutput = path.join(adapterDir, `${context.portName}Config.java`);
  await renderAndWrite(configTemplate, configOutput, context);
}

/**
 * Create or update urls.yml files in each environment directory
 * Returns array of locations where configuration was added
 */
async function createOrUpdateUrlsConfig(projectDir, propertyName, propertyValue) {
  const environments = ['local', 'develop', 'test', 'production'];
  const locations = [];

  for (const env of environments) {
    const parametersDir = path.join(projectDir, 'src', 'main', 'resources', 'parameters', env);
    const urlsFilePath = path.join(parametersDir, 'urls.yml');

    // Ensure directory exists
    await fs.ensureDir(parametersDir);

    let urlsContent = {};
    let fileExists = await fs.pathExists(urlsFilePath);

    if (fileExists) {
      // Load existing content
      const existingContent = await fs.readFile(urlsFilePath, 'utf8');
      urlsContent = yaml.load(existingContent) || {};
    }

    // Parse property name to extract module and port (format: module.port.base-url)
    const propertyParts = propertyName.split('.');
    const moduleKey = propertyParts[0];
    const portProperty = propertyParts.slice(1).join('.');

    // Initialize module object if it doesn't exist
    if (!urlsContent[moduleKey]) {
      urlsContent[moduleKey] = {};
    }

    // Check if property already exists within the module
    if (!urlsContent[moduleKey][portProperty]) {
      // Add new property under module
      urlsContent[moduleKey][portProperty] = propertyValue;

      // Write back to file
      const yamlContent = yaml.dump(urlsContent, {
        indent: 2,
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false
      });

      await fs.writeFile(urlsFilePath, yamlContent, 'utf8');

      // Record location
      const statusIndicator = fileExists ? '' : ' (created)';
      locations.push(`parameters/${env}/urls.yml${statusIndicator}`);
    } else {
      // Property already exists, skip
      locations.push(`parameters/${env}/urls.yml (already exists)`);
    }
  }

  return locations;
}

/**
 * Ensure urls.yml is imported in all application-*.yml files
 */
async function ensureUrlsImport(projectDir) {
  const environments = ['local', 'develop', 'test', 'production'];
  
  for (const env of environments) {
    const appConfigPath = path.join(projectDir, 'src', 'main', 'resources', `application-${env}.yml`);
    
    if (!(await fs.pathExists(appConfigPath))) {
      continue;
    }

    const content = await fs.readFile(appConfigPath, 'utf8');
    const config = yaml.load(content) || {};

    // Initialize spring.config.import if not exists
    if (!config.spring) {
      config.spring = {};
    }
    if (!config.spring.config) {
      config.spring.config = {};
    }
    if (!config.spring.config.import) {
      config.spring.config.import = [];
    }

    // Convert to array if string
    if (typeof config.spring.config.import === 'string') {
      config.spring.config.import = [config.spring.config.import];
    }

    // Check if urls.yml import already exists
    const urlsImportPath = `classpath:parameters/${env}/urls.yml`;
    if (!config.spring.config.import.includes(urlsImportPath)) {
      config.spring.config.import.push(urlsImportPath);

      // Write back to file
      const yamlContent = yaml.dump(config, {
        indent: 2,
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false
      });

      await fs.writeFile(appConfigPath, yamlContent, 'utf8');
    }
  }
}

module.exports = generateHttpExchangeCommand;
