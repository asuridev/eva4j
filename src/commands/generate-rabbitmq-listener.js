const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toPackagePath, toPascalCase, toCamelCase, toKebabCase } = require('../utils/naming');
const { renderAndWrite, renderTemplate } = require('../utils/template-engine');

/**
 * Generate RabbitMQ listener methods in a module's infrastructure
 * @param {string} moduleName - Name of the module
 */
async function generateRabbitMQListenerCommand(moduleName) {
  const projectDir = process.cwd();

  // Validate eva4j project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('   Run this command from the root of an eva4j project'));
    process.exit(1);
  }

  // Check if RabbitMQ is installed
  const configManager = new ConfigManager(projectDir);
  if (!(await configManager.featureExists('rabbitmq'))) {
    console.error(chalk.red('❌ RabbitMQ client is not installed in this project'));
    console.error(chalk.gray('   Run: eva4j add rabbitmq-client'));
    process.exit(1);
  }

  // Load project configuration
  const projectConfig = await configManager.loadProjectConfig();
  const { packageName, projectName } = projectConfig;
  const packagePath = toPackagePath(packageName);

  // Normalise module name to camelCase
  moduleName = toCamelCase(moduleName);

  // Validate module exists
  if (!(await configManager.moduleExists(moduleName))) {
    console.error(chalk.red(`❌ Module '${moduleName}' not found in project`));
    console.error(chalk.gray('   Available modules:'));
    const modules = projectConfig.modules || [];
    modules.forEach(mod => console.error(chalk.gray(`   - ${mod}`)));
    process.exit(1);
  }

  // Read available queues from rabbitmq.yaml
  const queues = await getAvailableQueues(projectDir);
  
  if (queues.length === 0) {
    console.error(chalk.red('❌ No queues found in rabbitmq.yaml'));
    console.error(chalk.gray('   Add queues using: eva4j generate rabbitmq-event <module> <event-name>'));
    process.exit(1);
  }

  // Prompt for queue selection (multiple)
  const { selectedQueues } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedQueues',
      message: 'Select queues to listen to (use space to select, enter to confirm):',
      choices: queues.map(q => ({
        name: `${q.key} (${q.value})`,
        value: q.key,
        checked: false
      })),
      validate: (answer) => {
        if (answer.length === 0) {
          return 'You must select at least one queue';
        }
        return true;
      }
    }
  ]);

  const spinner = ora('Generating RabbitMQ listeners...').start();

  try {
    const generatedListeners = [];

    for (const queueKey of selectedQueues) {
      const listenerContext = buildQueueContext(packageName, moduleName, queueKey, queues);
      
      const listenerPath = path.join(
        projectDir,
        'src',
        'main',
        'java',
        packagePath,
        moduleName,
        'infrastructure',
        'rabbitListener',
        `${listenerContext.listenerClassName}.java`
      );

      // Check if listener already exists
      if (await fs.pathExists(listenerPath)) {
        console.log(chalk.yellow(`   ⚠ ${listenerContext.listenerClassName}.java already exists, skipping...`));
        continue;
      }

      spinner.text = `Generating ${listenerContext.listenerClassName}...`;
      
      const templatePath = path.join(__dirname, '..', '..', 'templates', 'rabbitmq-listener', 'RabbitListenerSimple.java.ejs');
      await renderAndWrite(templatePath, listenerPath, listenerContext);
      
      generatedListeners.push(listenerContext.listenerClassName);
    }

    if (generatedListeners.length === 0) {
      spinner.warn(chalk.yellow('No new listeners were generated (all already exist)'));
    } else {
      spinner.succeed(chalk.green(`✨ ${generatedListeners.length} RabbitMQ listener(s) generated successfully!`));
    }

    // Display generated components
    console.log(chalk.blue('\n📦 Generated components:'));
    generatedListeners.forEach(className => {
      console.log(chalk.gray(`  ├── ${moduleName}/infrastructure/rabbitListener/${className}.java`));
    });
    
    if (generatedListeners.length > 0) {
      console.log(chalk.blue('\n✅ Listeners configured:'));
      selectedQueues.forEach(queue => {
        const className = generateListenerClassName(queue, moduleName);
        console.log(chalk.gray(`  ├── ${className} - listening to: ${queue}`));
      });

      console.log(chalk.yellow('\n💡 Next steps:'));
      console.log(chalk.gray('  1. Implement event processing logic in each listener\'s handle() method'));
      console.log(chalk.gray('  2. Consider creating use cases to handle events via UseCaseMediator'));
      console.log(chalk.gray('  3. Test your listeners with RabbitMQ producer'));
    }

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate RabbitMQ listener'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Read available queues from rabbitmq.yaml
 */
async function getAvailableQueues(projectDir) {
  const rabbitYmlPath = path.join(projectDir, 'src', 'main', 'resources', 'parameters', 'local', 'rabbitmq.yaml');
  
  if (!(await fs.pathExists(rabbitYmlPath))) {
    return [];
  }

  const rabbitContent = await fs.readFile(rabbitYmlPath, 'utf8');
  const rabbitConfig = yaml.load(rabbitContent);

  if (!rabbitConfig.queues || Object.keys(rabbitConfig.queues).length === 0) {
    return [];
  }

  return Object.entries(rabbitConfig.queues).map(([key, value]) => ({
    key,
    value
  }));
}

/**
 * Build context object for a queue
 */
function buildQueueContext(packageName, moduleName, queueKey, allQueues) {
  const queue = allQueues.find(q => q.key === queueKey);
  const topicValue = queue.value;

  const listenerClassName = generateListenerClassName(queueKey, moduleName);
  const listenerBeanName = toCamelCase(listenerClassName);
  const topicVariableName = toCamelCase(queueKey);

  return {
    packageName,
    moduleName,
    topicNameKebab: queueKey,
    topicValue,
    topicSpringProperty: `\${queues.${queueKey}}`,
    topicVariableName,
    listenerClassName,
    listenerBeanName
  };
}

/**
 * Generate listener class name from queue key and module name
 * Example: order-placed + notification → NotificationOrderPlacedListener
 */
function generateListenerClassName(queueKey, moduleName) {
  const modulePrefix = toPascalCase(moduleName);
  const topicName = toPascalCase(queueKey);
  return `${modulePrefix}${topicName}Listener`;
}

module.exports = generateRabbitMQListenerCommand;
