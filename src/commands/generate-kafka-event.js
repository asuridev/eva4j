const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject, moduleExists } = require('../utils/validator');
const { toPackagePath, toPascalCase, toCamelCase, toSnakeCase, toKebabCase } = require('../utils/naming');
const { renderAndWrite, renderTemplate } = require('../utils/template-engine');
const { parseDomainYaml } = require('../utils/yaml-to-entity');

async function generateKafkaEventCommand(moduleName, eventName) {
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

  // Try to read domain events declared in domain.yaml for the module
  let domainEventChoices = [];
  let domainEventMap = {};
  const domainYamlPath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName, 'domain.yaml');
  if (await fs.pathExists(domainYamlPath)) {
    try {
      const parsed = await parseDomainYaml(domainYamlPath, packageName, moduleName);
      parsed.aggregates.forEach(agg => {
        (agg.domainEvents || []).forEach(event => {
          domainEventChoices.push({ name: `${event.name} (from ${agg.name} aggregate)`, value: event.name });
          domainEventMap[event.name] = event;
        });
      });
    } catch (_) {
      // domain.yaml may not be parseable yet — silently fall back to free text
    }
  }

  // ── Resolve list of event names to process ─────────────────────────────
  let eventNames = [];

  if (eventName) {
    // Provided via CLI arg → single event
    eventNames = [eventName];
  } else if (domainEventChoices.length > 0) {
    // Interactive multi-select from domain.yaml events
    const choicesWithAll = [
      { name: chalk.bold('★  All events'), value: '__all__' },
      new inquirer.Separator(),
      ...domainEventChoices,
      new inquirer.Separator(),
      { name: 'Custom name (free text)...', value: '__custom__' }
    ];

    const { selectedEvents } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedEvents',
        message: 'Select domain events to publish via Kafka (space to select, enter to confirm):',
        choices: choicesWithAll,
        validate: (input) => input.length > 0 ? true : 'Select at least one event'
      }
    ]);

    if (selectedEvents.includes('__all__')) {
      // Expand to every declared domain event
      eventNames = domainEventChoices.map(c => c.value);
    } else if (selectedEvents.includes('__custom__')) {
      const { customName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customName',
          message: 'Enter event name:',
          validate: (input) => input && input.trim() !== '' ? true : 'Event name cannot be empty'
        }
      ]);
      eventNames = [customName];
    } else {
      eventNames = selectedEvents;
    }
  } else {
    // No domain events in yaml → free-text fallback
    const nameAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'eventName',
        message: 'Enter event name:',
        validate: (input) => input && input.trim() !== '' ? true : 'Event name cannot be empty'
      }
    ]);
    eventNames = [nameAnswer.eventName];
  }

  // ── Shared configuration (applies to all selected events) ────────────────
  const answers = await inquirer.prompt([
    {
      type: 'number',
      name: 'partitions',
      message: 'Number of partitions:',
      default: 3,
      validate: (value) => value >= 1 ? true : 'Partitions must be at least 1'
    },
    {
      type: 'number',
      name: 'replicas',
      message: 'Number of replicas:',
      default: 1,
      validate: (value) => value >= 1 ? true : 'Replicas must be at least 1'
    }
  ]);

  const { partitions, replicas } = answers;
  const isBatch = eventNames.length > 1;
  const spinner = ora(`Generating ${isBatch ? `${eventNames.length} Kafka events` : 'Kafka event'}...`).start();
  const results = [];

  try {
    for (const name of eventNames) {
      const normalizedName = toPascalCase(name);
      const evtClassName = normalizedName.endsWith('Event') ? normalizedName : `${normalizedName}Event`;

      // In batch mode skip already-existing events; in single mode abort
      const evtPath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName, 'application', 'events', `${evtClassName}.java`);
      if (await fs.pathExists(evtPath)) {
        if (isBatch) {
          results.push({ name: evtClassName, skipped: true });
          continue;
        } else {
          spinner.fail();
          console.error(chalk.red(`❌ Event '${evtClassName}' already exists in module '${moduleName}'`));
          process.exit(1);
        }
      }

      const topicNameKebab = toKebabCase(name);
      const topicNameCamel = toCamelCase(name);
      const topicNameSnake = toSnakeCase(name).toUpperCase();
      const topicSpringProperty = `\${topics.${topicNameKebab}}`;
      const selectedDomainEvent = domainEventMap[normalizedName] || null;

      const context = {
        packageName,
        moduleName,
        modulePascalCase: toPascalCase(moduleName),
        moduleCamelCase: toCamelCase(moduleName),
        kafkaMessageBrokerClassName: `${toPascalCase(moduleName)}KafkaMessageBroker`,
        eventClassName: evtClassName,
        topicNameSnake,
        topicNameKebab,
        topicNameCamel,
        topicPropertyKey: topicNameKebab,
        topicPropertyValue: topicNameSnake,
        topicSpringProperty,
        partitions,
        replicas,
        eventFields: selectedDomainEvent ? selectedDomainEvent.fields : null
      };

      if (isBatch) spinner.text = `[${results.length + 1}/${eventNames.length}] Generating ${evtClassName}...`;

      await generateSingleKafkaEvent(projectDir, packagePath, context);
      results.push({ name: evtClassName, skipped: false, handlerUpdated: context._handlerUpdated });
    }

    const generated = results.filter(r => !r.skipped);
    spinner.succeed(chalk.green(`${isBatch ? `${generated.length} Kafka events` : 'Kafka event'} generated successfully! ✨`));

    const kafkaMessageBrokerClass = `${toPascalCase(moduleName)}KafkaMessageBroker`;
    console.log(chalk.blue('\n📦 Generated/Updated components:'));
    results.forEach((r) => {
      if (r.skipped) {
        console.log(chalk.yellow(`  ├── ${moduleName}/application/events/${r.name}.java (skipped — already exists)`));
      } else {
        console.log(chalk.gray(`  ├── ${moduleName}/application/events/${r.name}.java`));
      }
    });
    console.log(chalk.gray(`  ├── ${moduleName}/application/ports/MessageBroker.java`));
    console.log(chalk.gray(`  ├── ${moduleName}/infrastructure/adapters/kafkaMessageBroker/${kafkaMessageBrokerClass}.java`));
    console.log(chalk.gray(`  ├── shared/configurations/kafkaConfig/KafkaConfig.java`));
    if (results.some(r => r.handlerUpdated)) {
      console.log(chalk.gray(`  ├── ${moduleName}/application/usecases/*DomainEventHandler.java`));
    }
    console.log(chalk.gray('  └── parameters/*/kafka.yaml (all environments)'));

    if (!isBatch && generated.length === 1) {
      const r = generated[0];
      const topicSnake = toSnakeCase(eventNames[0]).toUpperCase();
      const topicKebab = toKebabCase(eventNames[0]);
      console.log(chalk.blue('\n✅ Kafka event configured successfully!'));
      console.log(chalk.white(`\n   Event: ${r.name}`));
      console.log(chalk.white(`   Topic: ${topicSnake} (${topicKebab})`));
      console.log(chalk.white(`   Partitions: ${partitions}`));
      console.log(chalk.white(`   Replicas: ${replicas}`));
      console.log(chalk.gray('\n   You can now inject MessageBroker in your services and call:'));
      console.log(chalk.gray(`   messageBroker.publish${r.name}(event);\n`));
    } else {
      console.log(chalk.blue('\n✅ All Kafka events configured successfully!'));
      console.log(chalk.white(`\n   Partitions: ${partitions}  |  Replicas: ${replicas}`));
      if (generated.length > 0) {
        console.log(chalk.gray('\n   Available MessageBroker methods:'));
        generated.forEach(r => console.log(chalk.gray(`   messageBroker.publish${r.name}(event);`)));
      }
      console.log('');
    }

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
 * Run the full generation pipeline for a single event.
 * Mutates context._handlerUpdated to signal whether the DomainEventHandler was wired.
 */
async function generateSingleKafkaEvent(projectDir, packagePath, context) {
  await generateEventRecord(projectDir, packagePath, context);
  await updateKafkaYml(projectDir, context.topicPropertyKey, context.topicPropertyValue);
  await createOrUpdateMessageBroker(projectDir, packagePath, context);
  await createOrUpdateKafkaMessageBroker(projectDir, packagePath, context);
  await updateKafkaConfig(projectDir, packagePath, context);
  context._handlerUpdated = await updateDomainEventHandler(projectDir, packagePath, context);
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
 * Update kafka.yaml files in all environments
 */
async function updateKafkaYml(projectDir, topicKey, topicValue) {
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const kafkaYmlPath = path.join(projectDir, 'src', 'main', 'resources', 'parameters', env, 'kafka.yaml');
    
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
    context.moduleName, 'infrastructure', 'adapters', 'kafkaMessageBroker', `${context.kafkaMessageBrokerClassName}.java`
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
    const envelopeImport = `import ${context.packageName}.shared.infrastructure.eventEnvelope.EventEnvelope;`;
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
    const valueFieldName = `${context.topicNameCamel}Topic`;
    if (!content.includes(`private String ${valueFieldName};`)) {
      // Find the last @Value field and add after it, or after class declaration
      const valueFieldPattern = /(@Value\([^)]+\)\s*\n\s*private\s+String\s+\w+Topic;\s*\n)/g;
      const valueFields = [...content.matchAll(valueFieldPattern)];
      
      if (valueFields.length > 0) {
        // Add after the last @Value field
        const lastField = valueFields[valueFields.length - 1];
        const insertPos = lastField.index + lastField[0].length;
        content = content.slice(0, insertPos) + 
                  `\n  @Value("${context.topicSpringProperty}")\n  private String ${valueFieldName};\n\n` + 
                  content.slice(insertPos);
      } else {
        // Add after class declaration
        const classPattern = /(public\s+class\s+\w+KafkaMessageBroker\s+implements\s+MessageBroker\s*\{\s*\n)/;
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
      throw new Error(`Could not find closing brace in ${context.kafkaMessageBrokerClassName} class`);
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
    'shared', 'infrastructure', 'configurations', 'kafkaConfig', 'KafkaConfig.java'
  );

  if (!(await fs.pathExists(configPath))) {
    throw new Error('KafkaConfig.java not found. Please install Kafka first using: eva4j add kafka-client');
  }

  let content = await fs.readFile(configPath, 'utf-8');

  const beanMethodName = `${context.topicNameCamel}Topic`;

  // Check if bean already exists
  if (content.includes(`public NewTopic ${beanMethodName}(`)) {
    return; // Bean already exists
  }

  // Generate bean method
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-event', 'KafkaConfigBean.java.ejs');
  const valueFieldName = `${context.topicNameCamel}Topic`;
  const beanMethod = await renderTemplate(templatePath, { ...context, beanMethodName, valueFieldName });

  // Find the last closing brace and insert before it
  const lastBraceIndex = content.lastIndexOf('}');
  if (lastBraceIndex === -1) {
    throw new Error('Could not find closing brace in KafkaConfig class');
  }

  content = content.slice(0, lastBraceIndex) + '\n' + beanMethod + '\n}\n';
  await fs.writeFile(configPath, content, 'utf-8');
}

/**
 * Update DomainEventHandler: inject MessageBroker dependency and replace TODO with real mapping call.
 * Returns true if the handler was found and updated, false if skipped.
 */
async function updateDomainEventHandler(projectDir, packagePath, context) {
  const handlerDir = path.join(
    projectDir, 'src', 'main', 'java', packagePath,
    context.moduleName, 'application', 'usecases'
  );

  if (!(await fs.pathExists(handlerDir))) {
    console.log(chalk.yellow(`\n   ⚠️  No usecases directory found — skipping handler update`));
    console.log(chalk.gray(`      Run 'eva4j g entities ${context.moduleName}' first to generate the DomainEventHandler`));
    return false;
  }

  const files = await fs.readdir(handlerDir);
  const handlerFile = files.find(f => f.endsWith('DomainEventHandler.java'));

  if (!handlerFile) {
    console.log(chalk.yellow(`\n   ⚠️  DomainEventHandler not found in ${context.moduleName}/application/usecases/ — skipping`));
    console.log(chalk.gray(`      Run 'eva4j g entities ${context.moduleName}' first`));
    return false;
  }

  const handlerPath = path.join(handlerDir, handlerFile);
  const handlerClassName = handlerFile.replace('.java', '');
  let content = await fs.readFile(handlerPath, 'utf-8');

  // Idempotency: bail if the publish call is already there
  if (content.includes(`publish${context.eventClassName}`)) {
    return false;
  }

  // Compute domain event name by stripping 'Event' suffix from eventClassName
  // e.g. OrderPlacedEvent → OrderPlaced
  const domainEventName = context.eventClassName.endsWith('Event')
    ? context.eventClassName.slice(0, -'Event'.length)
    : context.eventClassName;

  // Guard: the TODO comment must exist (generated by g entities)
  if (!content.includes(`// TODO: handle ${domainEventName}`)) {
    console.log(chalk.yellow(`\n   ⚠️  No TODO handler found for '${domainEventName}' in ${handlerFile} — skipping`));
    return false;
  }

  // 1. Inject import for the application-layer event record
  const eventImport = `import ${context.packageName}.${context.moduleName}.application.events.${context.eventClassName};`;
  if (!content.includes(eventImport)) {
    content = injectImportIntoFile(content, eventImport);
  }

  // 2. Inject import for the MessageBroker port
  const brokerImport = `import ${context.packageName}.${context.moduleName}.application.ports.MessageBroker;`;
  if (!content.includes(brokerImport)) {
    content = injectImportIntoFile(content, brokerImport);
  }

  // 3. Inject field + constructor if MessageBroker is not yet present
  if (!content.includes('private final MessageBroker messageBroker;')) {
    const classPattern = /(public\s+class\s+\w+DomainEventHandler\s*\{\s*\n)/;
    const classMatch = content.match(classPattern);
    if (classMatch) {
      const insertPos = classMatch.index + classMatch[0].length;
      const fieldAndCtor =
        `\n    private final MessageBroker messageBroker;\n` +
        `\n    public ${handlerClassName}(MessageBroker messageBroker) {\n` +
        `        this.messageBroker = messageBroker;\n` +
        `    }\n`;
      content = content.slice(0, insertPos) + fieldAndCtor + content.slice(insertPos);
    }
  }

  // 4. Render the mapping call and replace the TODO block
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-event', 'DomainEventHandlerMethod.ejs');
  const mappingLine = await renderTemplate(templatePath, { ...context, domainEventFields: context.eventFields });

  const todoRegex = new RegExp(
    `([ \\t]*\/\/ TODO: handle ${domainEventName}[^\\n]*\\n)(?:[ \\t]*\/\/[^\\n]*\\n)*`
  );
  content = content.replace(todoRegex, `        ${mappingLine.trim()}\n`);

  await fs.writeFile(handlerPath, content, 'utf-8');
  return true;
}

/**
 * Injects an import statement after the last existing import, or after the package declaration.
 */
function injectImportIntoFile(content, importStatement) {
  const packageMatch = content.match(/(package\s+[\w.]+;\s*\n)/);
  if (!packageMatch) return content;

  const hasImports = /import\s+[\w.]+;/.test(content);
  if (hasImports) {
    const imports = content.matchAll(/import\s+[\w.]+;\s*\n/g);
    let lastImportEnd = packageMatch.index + packageMatch[0].length;
    for (const match of imports) {
      lastImportEnd = match.index + match[0].length;
    }
    return content.slice(0, lastImportEnd) + importStatement + '\n' + content.slice(lastImportEnd);
  } else {
    const insertPos = packageMatch.index + packageMatch[0].length;
    return content.slice(0, insertPos) + '\n' + importStatement + '\n' + content.slice(insertPos);
  }
}

module.exports = generateKafkaEventCommand;
