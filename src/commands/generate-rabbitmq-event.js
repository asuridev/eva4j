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
const { generateEventRecord, createOrUpdateMessageBroker, updateDomainEventHandler } = require('./generate-kafka-event');

async function generateRabbitMQEventCommand(moduleName, eventName) {
  const projectDir = process.cwd();
  
  // Validate we're in an eva4j project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  // Check if RabbitMQ is installed
  const configManager = new ConfigManager(projectDir);
  if (!(await configManager.featureExists('rabbitmq'))) {
    console.error(chalk.red('❌ RabbitMQ client is not installed in this project'));
    console.error(chalk.gray('Install RabbitMQ first using: eva4j add rabbitmq-client'));
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

  // Normalise module name to camelCase
  moduleName = toCamelCase(moduleName);

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
    eventNames = [eventName];
  } else if (domainEventChoices.length > 0) {
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
        message: 'Select domain events to publish via RabbitMQ (space to select, enter to confirm):',
        choices: choicesWithAll,
        validate: (input) => input.length > 0 ? true : 'Select at least one event'
      }
    ]);

    if (selectedEvents.includes('__all__')) {
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

  const isBatch = eventNames.length > 1;
  const spinner = ora(`Generating ${isBatch ? `${eventNames.length} RabbitMQ events` : 'RabbitMQ event'}...`).start();
  const results = [];

  try {
    for (const name of eventNames) {
      const normalizedName = toPascalCase(name);
      const evtClassName = normalizedName.endsWith('IntegrationEvent') ? normalizedName : `${normalizedName}IntegrationEvent`;

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

      const selectedDomainEvent = domainEventMap[normalizedName] || null;
      const context = buildRabbitEventContext(packageName, moduleName, { name, fields: selectedDomainEvent ? selectedDomainEvent.fields : null });

      if (isBatch) spinner.text = `[${results.length + 1}/${eventNames.length}] Generating ${evtClassName}...`;

      await generateSingleRabbitEvent(projectDir, packagePath, context);
      results.push({ name: evtClassName, skipped: false, handlerUpdated: context._handlerUpdated });
    }

    const generated = results.filter(r => !r.skipped);
    spinner.succeed(chalk.green(`${isBatch ? `${generated.length} RabbitMQ events` : 'RabbitMQ event'} generated successfully! ✨`));

    const rabbitMessageBrokerClass = `${toPascalCase(moduleName)}RabbitMessageBroker`;
    console.log(chalk.blue('\n📦 Generated/Updated components:'));
    results.forEach((r) => {
      if (r.skipped) {
        console.log(chalk.yellow(`  ├── ${moduleName}/application/events/${r.name}.java (skipped — already exists)`));
      } else {
        console.log(chalk.gray(`  ├── ${moduleName}/application/events/${r.name}.java`));
      }
    });
    console.log(chalk.gray(`  ├── ${moduleName}/application/ports/MessageBroker.java`));
    console.log(chalk.gray(`  ├── ${moduleName}/infrastructure/adapters/rabbitmqMessageBroker/${rabbitMessageBrokerClass}.java`));
    console.log(chalk.gray(`  ├── shared/configurations/rabbitmqConfig/RabbitMQConfig.java`));
    if (results.some(r => r.handlerUpdated)) {
      console.log(chalk.gray(`  ├── ${moduleName}/application/usecases/*DomainEventHandler.java`));
    }
    console.log(chalk.gray('  └── parameters/*/rabbitmq.yaml (all environments)'));

    if (!isBatch && generated.length === 1) {
      const r = generated[0];
      const routingKey = toKebabCase(stripEventSuffix(eventNames[0])).replace(/-/g, '.');
      console.log(chalk.blue('\n✅ RabbitMQ event configured successfully!'));
      console.log(chalk.white(`\n   Event: ${r.name}`));
      console.log(chalk.white(`   Exchange: ${moduleName}.events`));
      console.log(chalk.white(`   Routing Key: ${routingKey}`));
      console.log(chalk.gray('\n   You can now inject MessageBroker in your services and call:'));
      console.log(chalk.gray(`   messageBroker.publish${r.name}(event);\n`));
    } else {
      console.log(chalk.blue('\n✅ All RabbitMQ events configured successfully!'));
      if (generated.length > 0) {
        console.log(chalk.gray('\n   Available MessageBroker methods:'));
        generated.forEach(r => console.log(chalk.gray(`   messageBroker.publish${r.name}(event);`)));
      }
      console.log('');
    }

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate RabbitMQ event'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

// ── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Strip the conventional Java 'Event' suffix from an event class name
 * before deriving the routing key / queue name.
 */
function stripEventSuffix(name) {
  return name.endsWith('Event') ? name.slice(0, -'Event'.length) : name;
}

/**
 * Build a RabbitMQ event generation context for a given domain event.
 * Parallel to buildKafkaEventContext in generate-kafka-event.js.
 *
 * @param {string} packageName
 * @param {string} moduleName
 * @param {{ name: string, topic?: string, fields: Array }} domainEvent
 * @returns {Object} context ready for generateSingleRabbitEvent()
 */
function buildRabbitEventContext(packageName, moduleName, domainEvent) {
  const normalizedName = toPascalCase(domainEvent.name);
  const integrationEventClassName = normalizedName.endsWith('IntegrationEvent')
    ? normalizedName
    : `${normalizedName}IntegrationEvent`;

  // Derive routing key and queue names from event name
  // OrderPlacedEvent → order-placed (kebab) → order.placed (routing key)
  const topicBase = domainEvent.topic
    ? domainEvent.topic.trim().toUpperCase().replace(/-/g, '_')
    : toSnakeCase(stripEventSuffix(domainEvent.name)).toUpperCase();
  const topicNameSnake = topicBase;
  const topicNameKebab = topicBase.toLowerCase().replace(/_/g, '-');
  const topicNameCamel = toCamelCase(topicNameKebab);
  const routingKey = topicNameKebab.replace(/-/g, '.');

  return {
    packageName,
    moduleName,
    modulePascalCase: toPascalCase(moduleName),
    moduleCamelCase: toCamelCase(moduleName),
    rabbitMessageBrokerClassName: `${toPascalCase(moduleName)}RabbitMessageBroker`,
    // Reuse kafkaMessageBrokerClassName for DomainEventHandler.ejs compatibility
    kafkaMessageBrokerClassName: `${toPascalCase(moduleName)}RabbitMessageBroker`,
    eventClassName: integrationEventClassName,
    topicNameSnake,
    topicNameKebab,
    topicNameCamel,
    topicPropertyKey: topicNameKebab,
    topicPropertyValue: topicNameSnake,
    topicSpringProperty: `\${routing-keys.${topicNameKebab}}`,
    routingKey,
    exchangeName: `${moduleName}.events`,
    queueName: `${moduleName}.${topicNameKebab}`,
    eventFields: domainEvent.fields || null
  };
}

/**
 * Run the full generation pipeline for a single RabbitMQ event.
 * Mutates context._handlerUpdated to signal whether the DomainEventHandler was wired.
 */
async function generateSingleRabbitEvent(projectDir, packagePath, context) {
  // 1. Integration Event record (reuse kafka-event template — broker-agnostic)
  await generateEventRecord(projectDir, packagePath, context);
  // 2. Update rabbitmq.yaml with exchange, queue, routing-key entries
  await updateRabbitMQYml(projectDir, context);
  // 3. MessageBroker port interface (reuse kafka-event — broker-agnostic)
  await createOrUpdateMessageBroker(projectDir, packagePath, context);
  // 4. RabbitMessageBroker adapter
  await createOrUpdateRabbitMessageBroker(projectDir, packagePath, context);
  // 5. RabbitMQConfig beans (exchange + queue + binding)
  await updateRabbitMQConfig(projectDir, packagePath, context);
  // 6. DomainEventHandler wiring (reuse kafka-event — broker-agnostic)
  context._handlerUpdated = await updateDomainEventHandler(projectDir, packagePath, context);
}

/**
 * Create or update the RabbitMQ MessageBroker adapter.
 * Creates a new file if not present; appends publish method otherwise.
 */
async function createOrUpdateRabbitMessageBroker(projectDir, packagePath, context) {
  const adapterPath = path.join(
    projectDir, 'src', 'main', 'java', packagePath,
    context.moduleName, 'infrastructure', 'adapters', 'rabbitmqMessageBroker',
    `${context.rabbitMessageBrokerClassName}.java`
  );

  const methodName = `publish${context.eventClassName}`;
  const rabbitTemplatesDir = path.join(__dirname, '..', '..', 'templates', 'rabbitmq-event');

  if (await fs.pathExists(adapterPath)) {
    let content = await fs.readFile(adapterPath, 'utf-8');

    // If this file is a mock implementation (from eva build --mock), replace it wholesale
    const isMockImpl = content.includes('ApplicationEventPublisher') && !content.includes('RabbitTemplate');
    if (isMockImpl) {
      await renderAndWrite(
        path.join(rabbitTemplatesDir, 'RabbitMessageBroker.java.ejs'),
        adapterPath,
        context
      );
      return;
    }

    // Check if method already exists
    if (content.includes(methodName)) {
      return;
    }

    // Inject event import if missing
    const eventImport = `import ${context.packageName}.${context.moduleName}.application.events.${context.eventClassName};`;
    if (!content.includes(eventImport)) {
      content = injectImportIntoFile(content, eventImport);
    }

    // Inject EventEnvelope import if missing
    const envelopeImport = `import ${context.packageName}.shared.infrastructure.eventEnvelope.EventEnvelope;`;
    if (!content.includes(envelopeImport)) {
      content = injectImportIntoFile(content, envelopeImport);
    }

    // Inject @Value import if missing
    const valueImport = 'import org.springframework.beans.factory.annotation.Value;';
    if (!content.includes(valueImport)) {
      content = injectImportIntoFile(content, valueImport);
    }

    // Check if @Value routing-key field exists for this event
    const valueFieldName = `${context.topicNameCamel}RoutingKey`;
    if (!content.includes(`private String ${valueFieldName};`)) {
      const valueFieldPattern = /(@Value\([^)]+\)\s*\n\s*private\s+String\s+\w+;\s*\n)/g;
      const valueFields = [...content.matchAll(valueFieldPattern)];
      
      if (valueFields.length > 0) {
        const lastField = valueFields[valueFields.length - 1];
        const insertPos = lastField.index + lastField[0].length;
        content = content.slice(0, insertPos) + 
                  `\n  @Value("\${routing-keys.${context.topicNameKebab}}")\n  private String ${valueFieldName};\n\n` + 
                  content.slice(insertPos);
      } else {
        const classPattern = /(public\s+class\s+\w+RabbitMessageBroker\s+implements\s+MessageBroker\s*\{\s*\n)/;
        const classMatch = content.match(classPattern);
        if (classMatch) {
          const insertPos = classMatch.index + classMatch[0].length;
          content = content.slice(0, insertPos) + 
                    `\n  @Value("\${routing-keys.${context.topicNameKebab}}")\n  private String ${valueFieldName};\n` + 
                    content.slice(insertPos);
        }
      }
    }

    // Generate method implementation
    const templatePath = path.join(rabbitTemplatesDir, 'RabbitMessageBrokerMethod.java.ejs');
    const methodImpl = await renderTemplate(templatePath, { ...context, valueFieldName });

    const lastBraceIndex = content.lastIndexOf('}');
    if (lastBraceIndex === -1) {
      throw new Error(`Could not find closing brace in ${context.rabbitMessageBrokerClassName} class`);
    }

    content = content.slice(0, lastBraceIndex) + '\n' + methodImpl + '\n}\n';
    await fs.writeFile(adapterPath, content, 'utf-8');
  } else {
    // Create new implementation
    await renderAndWrite(
      path.join(rabbitTemplatesDir, 'RabbitMessageBroker.java.ejs'),
      adapterPath,
      context
    );
  }
}

/**
 * Update RabbitMQConfig.java with exchange + queue + binding beans.
 * Exchange bean is emitted once per module; queue/binding beans are emitted per event.
 */
async function updateRabbitMQConfig(projectDir, packagePath, context) {
  const configPath = path.join(
    projectDir, 'src', 'main', 'java', packagePath,
    'shared', 'infrastructure', 'configurations', 'rabbitmqConfig', 'RabbitMQConfig.java'
  );

  if (!(await fs.pathExists(configPath))) {
    throw new Error('RabbitMQConfig.java not found. Please install RabbitMQ first using: eva4j add rabbitmq-client');
  }

  let content = await fs.readFile(configPath, 'utf-8');

  const beanMethodName = `${context.topicNameCamel}Topic`;

  // Check if queue bean already exists for this event
  if (content.includes(`public Queue ${beanMethodName}Queue(`)) {
    return; // Beans already exist
  }

  const templatesDir = path.join(__dirname, '..', '..', 'templates', 'rabbitmq-event');

  // ── Exchange bean — emit only once per module ──────────────────────────────
  const exchangeBeanName = `${context.moduleName}Exchange`;
  if (!content.includes(`public TopicExchange ${exchangeBeanName}(`)) {
    const exchangeSnippet = await renderTemplate(
      path.join(templatesDir, 'RabbitConfigExchange.java.ejs'),
      { moduleName: context.moduleName }
    );
    const lastBrace = content.lastIndexOf('}');
    if (lastBrace === -1) throw new Error('Could not find closing brace in RabbitMQConfig class');
    content = content.slice(0, lastBrace) + '\n' + exchangeSnippet + '\n}\n';
  }

  // ── Queue + Binding beans — emit per event ─────────────────────────────────
  const valueFieldName = `${context.topicNameCamel}Topic`;
  const queueBindingSnippet = await renderTemplate(
    path.join(templatesDir, 'RabbitConfigBean.java.ejs'),
    { ...context, beanMethodName, valueFieldName, moduleName: context.moduleName }
  );

  const lastBraceIndex = content.lastIndexOf('}');
  if (lastBraceIndex === -1) throw new Error('Could not find closing brace in RabbitMQConfig class');
  content = content.slice(0, lastBraceIndex) + '\n' + queueBindingSnippet + '\n}\n';

  await fs.writeFile(configPath, content, 'utf-8');
}

/**
 * Update rabbitmq.yaml files in all environments with exchange, queue, and routing-key entries.
 */
async function updateRabbitMQYml(projectDir, context) {
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const rabbitYmlPath = path.join(projectDir, 'src', 'main', 'resources', 'parameters', env, 'rabbitmq.yaml');
    
    if (!(await fs.pathExists(rabbitYmlPath))) {
      continue;
    }

    const existingContent = await fs.readFile(rabbitYmlPath, 'utf8');
    let rabbitContent = yaml.load(existingContent) || {};

    let changed = false;

    // Initialize sections if they don't exist
    if (!rabbitContent.exchanges) rabbitContent.exchanges = {};
    if (!rabbitContent.queues) rabbitContent.queues = {};
    if (!rabbitContent['routing-keys']) rabbitContent['routing-keys'] = {};

    // Add exchange if it doesn't exist
    if (!rabbitContent.exchanges[context.moduleName]) {
      rabbitContent.exchanges[context.moduleName] = context.exchangeName;
      changed = true;
    }

    // Add queue if it doesn't exist
    if (!rabbitContent.queues[context.topicPropertyKey]) {
      rabbitContent.queues[context.topicPropertyKey] = context.queueName;
      changed = true;
    }

    // Add routing key if it doesn't exist
    if (!rabbitContent['routing-keys'][context.topicPropertyKey]) {
      rabbitContent['routing-keys'][context.topicPropertyKey] = context.routingKey;
      changed = true;
    }

    if (changed) {
      const yamlContent = yaml.dump(rabbitContent, {
        indent: 2,
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false
      });
      await fs.writeFile(rabbitYmlPath, yamlContent, 'utf8');
    }
  }
}

/**
 * Update rabbitmq.yaml with a specific queue entry (for listeners/read models).
 * Simplified version that only registers a queue.
 */
async function updateRabbitMQYmlQueue(projectDir, queueKey, queueValue) {
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const rabbitYmlPath = path.join(projectDir, 'src', 'main', 'resources', 'parameters', env, 'rabbitmq.yaml');
    
    if (!(await fs.pathExists(rabbitYmlPath))) {
      continue;
    }

    const existingContent = await fs.readFile(rabbitYmlPath, 'utf8');
    let rabbitContent = yaml.load(existingContent) || {};

    if (!rabbitContent.queues) rabbitContent.queues = {};

    if (!rabbitContent.queues[queueKey]) {
      rabbitContent.queues[queueKey] = queueValue;

      const yamlContent = yaml.dump(rabbitContent, {
        indent: 2,
        lineWidth: -1,
        quotingType: '"',
        forceQuotes: false
      });
      await fs.writeFile(rabbitYmlPath, yamlContent, 'utf8');
    }
  }
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

module.exports = generateRabbitMQEventCommand;
module.exports.generateSingleRabbitEvent = generateSingleRabbitEvent;
module.exports.buildRabbitEventContext = buildRabbitEventContext;
module.exports.updateRabbitMQYml = updateRabbitMQYml;
module.exports.updateRabbitMQYmlQueue = updateRabbitMQYmlQueue;
module.exports.createOrUpdateRabbitMessageBroker = createOrUpdateRabbitMessageBroker;
module.exports.updateRabbitMQConfig = updateRabbitMQConfig;
