const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject, moduleExists } = require('../utils/validator');
const { toPackagePath, toPascalCase, toSnakeCase, toKebabCase } = require('../utils/naming');
const { renderAndWrite, renderTemplate } = require('../utils/template-engine');

async function generateKafkaEventCommand(eventName, moduleName) {
  const projectDir = process.cwd();
  
  // Validate we're in an eva4j project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  // Check if Kafka is installed
  const configManager = new ConfigManager(projectDir);
  if (!(await configManager.featureExists('kafka'))) {
    console.error(chalk.red('❌ Kafka client is not installed in this project'));
    console.error(chalk.gray('Install Kafka first using: eva4j add kafka-client'));
    process.exit(1);
  }

  // Load project configuration
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

  // Normalize event name to PascalCase
  const normalizedEventName = toPascalCase(eventName);
  const eventClassName = normalizedEventName.endsWith('Event') 
    ? normalizedEventName 
    : `${normalizedEventName}Event`;

  // Check if event already exists
  const eventPath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName, 'application', 'events', `${eventClassName}.java`);
  if (await fs.pathExists(eventPath)) {
    console.error(chalk.red(`❌ Event '${eventClassName}' already exists in module '${moduleName}'`));
    process.exit(1);
  }

  // Prompt for event configuration
  const answers = await inquirer.prompt([
    {
      type: 'number',
      name: 'partitions',
      message: 'Number of partitions:',
      default: 3,
      validate: (value) => {
        if (value < 1) return 'Partitions must be at least 1';
        return true;
      }
    },
    {
      type: 'number',
      name: 'replicas',
      message: 'Number of replicas:',
      default: 1,
      validate: (value) => {
        if (value < 1) return 'Replicas must be at least 1';
        return true;
      }
    }
  ]);

  const { partitions, replicas } = answers;

  const spinner = ora('Generating Kafka event...').start();

  try {
    // Generate property names
    const topicNameKebab = toKebabCase(eventName);
    const topicNameSnake = toSnakeCase(eventName).toUpperCase();
    const topicPropertyKey = topicNameKebab;
    const topicPropertyValue = topicNameSnake;
    const topicSpringProperty = `\${topics.${topicNameKebab}}`;

    const context = {
      packageName,
      moduleName,
      eventClassName,
      topicNameSnake,
      topicNameKebab,
      topicPropertyKey,
      topicPropertyValue,
      topicSpringProperty,
      partitions,
      replicas
    };

    // 1. Generate Event Record
    spinner.text = 'Generating event record...';
    await generateEventRecord(projectDir, packagePath, context);

    // 2. Update kafka.yml files
    spinner.text = 'Updating kafka.yml configuration...';
    await updateKafkaYml(projectDir, topicPropertyKey, topicPropertyValue);

    // 3. Create/Update MessageBroker interface
    spinner.text = 'Updating MessageBroker interface...';
    await createOrUpdateMessageBroker(projectDir, packagePath, context);

    // 4. Create/Update KafkaMessageBroker implementation
    spinner.text = 'Updating KafkaMessageBroker implementation...';
    await createOrUpdateKafkaMessageBroker(projectDir, packagePath, context);

    // 5. Update KafkaConfig with NewTopic bean
    spinner.text = 'Updating KafkaConfig...';
    await updateKafkaConfig(projectDir, packagePath, context);

    spinner.succeed(chalk.green('Kafka event generated successfully! ✨'));

    console.log(chalk.blue('\n📦 Generated/Updated components:'));
    console.log(chalk.gray(`  ├── ${moduleName}/application/events/${eventClassName}.java`));
    console.log(chalk.gray(`  ├── ${moduleName}/application/ports/MessageBroker.java`));
    console.log(chalk.gray(`  ├── ${moduleName}/infrastructure/adapters/kafkaMessageBroker/KafkaMessageBroker.java`));
    console.log(chalk.gray(`  ├── shared/configurations/kafkaConfig/KafkaConfig.java`));
    console.log(chalk.gray('  └── parameters/*/kafka.yml (all environments)'));
    
    console.log(chalk.blue('\n✅ Kafka event configured successfully!'));
    console.log(chalk.white(`\n   Event: ${eventClassName}`));
    console.log(chalk.white(`   Topic: ${topicPropertyValue} (${topicNameKebab})`));
    console.log(chalk.white(`   Partitions: ${partitions}`));
    console.log(chalk.white(`   Replicas: ${replicas}`));
    console.log(chalk.gray('\n   You can now inject MessageBroker in your services and call:'));
    console.log(chalk.gray(`   messageBroker.publish${eventClassName}(event);\n`));

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate Kafka event'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

/**
 * Generate Event Record
 */
async function generateEventRecord(projectDir, packagePath, context) {
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-event', 'Event.java.ejs');
  const outputPath = path.join(
    projectDir, 'src', 'main', 'java', packagePath, 
    context.moduleName, 'application', 'events', `${context.eventClassName}.java`
  );
  
  await renderAndWrite(templatePath, outputPath, context);
}

/**
 * Update kafka.yml files in all environments
 */
async function updateKafkaYml(projectDir, topicKey, topicValue) {
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const kafkaYmlPath = path.join(projectDir, 'src', 'main', 'resources', 'parameters', env, 'kafka.yml');
    
    if (!(await fs.pathExists(kafkaYmlPath))) {
      continue;
    }

    let kafkaContent = {};
    const existingContent = await fs.readFile(kafkaYmlPath, 'utf8');
    kafkaContent = yaml.load(existingContent) || {};

    // Initialize topics section if it doesn't exist
    if (!kafkaContent.topics) {
      kafkaContent.topics = {};
    }

    // Add new topic if it doesn't exist
    if (!kafkaContent.topics[topicKey]) {
      kafkaContent.topics[topicKey] = topicValue;

      // Write back to file
      const yamlContent = yaml.dump(kafkaContent, {
        indent: 2,
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false
      });

      await fs.writeFile(kafkaYmlPath, yamlContent, 'utf8');
    }
  }
}

/**
 * Create or update MessageBroker interface
 */
async function createOrUpdateMessageBroker(projectDir, packagePath, context) {
  const interfacePath = path.join(
    projectDir, 'src', 'main', 'java', packagePath,
    context.moduleName, 'application', 'ports', 'MessageBroker.java'
  );

  const methodName = `publish${context.eventClassName}`;

  if (await fs.pathExists(interfacePath)) {
    // Update existing interface
    let content = await fs.readFile(interfacePath, 'utf-8');

    // Check if method already exists
    if (content.includes(methodName)) {
      return; // Method already exists
    }

    // Check if import exists and add it if needed
    const importStatement = `import ${context.packageName}.${context.moduleName}.application.events.${context.eventClassName};`;
    if (!content.includes(importStatement)) {
      // Find the position after the package declaration
      const packageMatch = content.match(/(package\s+[\w.]+;\s*\n)/);
      if (packageMatch) {
        const insertPos = packageMatch.index + packageMatch[0].length;
        
        // Check if there are already imports
        const hasImports = /import\s+[\w.]+;/.test(content);
        
        if (hasImports) {
          // Find the position after the last import
          const imports = content.matchAll(/import\s+[\w.]+;\s*\n/g);
          let lastImportEnd = insertPos;
          for (const match of imports) {
            lastImportEnd = match.index + match[0].length;
          }
          // Insert the new import after the last import
          content = content.slice(0, lastImportEnd) + importStatement + '\n' + content.slice(lastImportEnd);
        } else {
          // No imports yet, add after package with blank line
          content = content.slice(0, insertPos) + '\n' + importStatement + '\n' + content.slice(insertPos);
        }
      }
    }

    // Generate method signature
    const templatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-event', 'MessageBrokerMethod.java.ejs');
    const methodSignature = await renderTemplate(templatePath, context);

    // Find the last closing brace and insert before it
    const lastBraceIndex = content.lastIndexOf('}');
    if (lastBraceIndex === -1) {
      throw new Error('Could not find closing brace in MessageBroker interface');
    }

    content = content.slice(0, lastBraceIndex) + '\n' + methodSignature + '\n}\n';
    await fs.writeFile(interfacePath, content, 'utf-8');
  } else {
    // Create new interface
    const templatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-event', 'MessageBroker.java.ejs');
    await renderAndWrite(templatePath, interfacePath, context);
  }
}

/**
 * Create or update KafkaMessageBroker implementation
 */
async function createOrUpdateKafkaMessageBroker(projectDir, packagePath, context) {
  const adapterPath = path.join(
    projectDir, 'src', 'main', 'java', packagePath,
    context.moduleName, 'infrastructure', 'adapters', 'kafkaMessageBroker', 'KafkaMessageBroker.java'
  );

  const methodName = `publish${context.eventClassName}`;

  if (await fs.pathExists(adapterPath)) {
    // Update existing implementation
    let content = await fs.readFile(adapterPath, 'utf-8');

    // Check if method already exists
    if (content.includes(methodName)) {
      return; // Method already exists
    }

    // Check if event import exists and add it if needed
    const eventImport = `import ${context.packageName}.${context.moduleName}.application.events.${context.eventClassName};`;
    if (!content.includes(eventImport)) {
      const packageMatch = content.match(/(package\s+[\w.]+;\s*\n)/);
      if (packageMatch) {
        const insertPos = packageMatch.index + packageMatch[0].length;
        const hasImports = /import\s+[\w.]+;/.test(content);
        
        if (hasImports) {
          const imports = content.matchAll(/import\s+[\w.]+;\s*\n/g);
          let lastImportEnd = insertPos;
          for (const match of imports) {
            lastImportEnd = match.index + match[0].length;
          }
          content = content.slice(0, lastImportEnd) + eventImport + '\n' + content.slice(lastImportEnd);
        } else {
          content = content.slice(0, insertPos) + '\n' + eventImport + '\n' + content.slice(insertPos);
        }
      }
    }

    // Check if EventEnvelope import exists
    const envelopeImport = `import ${context.packageName}.shared.eventEnvelope.EventEnvelope;`;
    if (!content.includes(envelopeImport)) {
      const packageMatch = content.match(/(package\s+[\w.]+;\s*\n)/);
      if (packageMatch) {
        const insertPos = packageMatch.index + packageMatch[0].length;
        const imports = content.matchAll(/import\s+[\w.]+;\s*\n/g);
        let lastImportEnd = insertPos;
        for (const match of imports) {
          lastImportEnd = match.index + match[0].length;
        }
        content = content.slice(0, lastImportEnd) + envelopeImport + '\n' + content.slice(lastImportEnd);
      }
    }

    // Check if @Value import exists
    const valueImport = 'import org.springframework.beans.factory.annotation.Value;';
    if (!content.includes(valueImport)) {
      const packageMatch = content.match(/(package\s+[\w.]+;\s*\n)/);
      if (packageMatch) {
        const insertPos = packageMatch.index + packageMatch[0].length;
        const imports = content.matchAll(/import\s+[\w.]+;\s*\n/g);
        let lastImportEnd = insertPos;
        for (const match of imports) {
          lastImportEnd = match.index + match[0].length;
        }
        content = content.slice(0, lastImportEnd) + valueImport + '\n' + content.slice(lastImportEnd);
      }
    }

    // Check if @Value field exists for this topic
    const valueFieldName = `${context.topicNameKebab.replace(/-/g, '')}Topic`;
    if (!content.includes(`private String ${valueFieldName};`)) {
      // Find the last @Value field and add after it, or after class declaration
      const valueFieldPattern = /(@Value\([^)]+\)\s*\n\s*private\s+String\s+\w+Topic;\s*\n)/g;
      const valueFields = [...content.matchAll(valueFieldPattern)];
      
      if (valueFields.length > 0) {
        // Add after the last @Value field
        const lastField = valueFields[valueFields.length - 1];
        const insertPos = lastField.index + lastField[0].length;
        content = content.slice(0, insertPos) + 
                  `\n  @Value("${context.topicSpringProperty}")\n  private String ${valueFieldName};\n` + 
                  content.slice(insertPos);
      } else {
        // Add after class declaration
        const classPattern = /(public\s+class\s+KafkaMessageBroker\s+implements\s+MessageBroker\s*\{\s*\n)/;
        const classMatch = content.match(classPattern);
        if (classMatch) {
          const insertPos = classMatch.index + classMatch[0].length;
          content = content.slice(0, insertPos) + 
                    `\n  @Value("${context.topicSpringProperty}")\n  private String ${valueFieldName};\n` + 
                    content.slice(insertPos);
        }
      }
    }

    // Generate method implementation
    const templatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-event', 'MessageBrokerImplMethod.java.ejs');
    const methodImpl = await renderTemplate(templatePath, { ...context, valueFieldName });

    // Find the last closing brace and insert before it
    const lastBraceIndex = content.lastIndexOf('}');
    if (lastBraceIndex === -1) {
      throw new Error('Could not find closing brace in KafkaMessageBroker class');
    }

    content = content.slice(0, lastBraceIndex) + '\n' + methodImpl + '\n}\n';
    await fs.writeFile(adapterPath, content, 'utf-8');
  } else {
    // Create new implementation
    const templatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-event', 'KafkaMessageBroker.java.ejs');
    await renderAndWrite(templatePath, adapterPath, context);
  }
}

/**
 * Update KafkaConfig with NewTopic bean
 */
async function updateKafkaConfig(projectDir, packagePath, context) {
  const configPath = path.join(
    projectDir, 'src', 'main', 'java', packagePath,
    'shared', 'configurations', 'kafkaConfig', 'KafkaConfig.java'
  );

  if (!(await fs.pathExists(configPath))) {
    throw new Error('KafkaConfig.java not found. Please install Kafka first using: eva4j add kafka-client');
  }

  let content = await fs.readFile(configPath, 'utf-8');

  const beanMethodName = `${context.topicNameKebab.replace(/-/g, '')}Topic`;

  // Check if bean already exists
  if (content.includes(`public NewTopic ${beanMethodName}(`)) {
    return; // Bean already exists
  }

  // Generate bean method
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-event', 'KafkaConfigBean.java.ejs');
  const valueFieldName = `${context.topicNameKebab.replace(/-/g, '')}Topic`;
  const beanMethod = await renderTemplate(templatePath, { ...context, beanMethodName, valueFieldName });

  // Find the last closing brace and insert before it
  const lastBraceIndex = content.lastIndexOf('}');
  if (lastBraceIndex === -1) {
    throw new Error('Could not find closing brace in KafkaConfig class');
  }

  content = content.slice(0, lastBraceIndex) + '\n' + beanMethod + '\n}\n';
  await fs.writeFile(configPath, content, 'utf-8');
}

module.exports = generateKafkaEventCommand;
