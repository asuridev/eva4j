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
 * Generate Kafka listener methods in a module's infrastructure
 * @param {string} moduleName - Name of the module
 */
async function generateKafkaListenerCommand(moduleName) {
  const projectDir = process.cwd();

  // Validate eva4j project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('   Run this command from the root of an eva4j project'));
    process.exit(1);
  }

  // Check if Kafka is installed
  const configManager = new ConfigManager(projectDir);
  if (!(await configManager.featureExists('kafka'))) {
    console.error(chalk.red('❌ Kafka client is not installed in this project'));
    console.error(chalk.gray('   Run: eva4j add kafka-client'));
    process.exit(1);
  }

  // Load project configuration
  const projectConfig = await configManager.loadProjectConfig();
  const { packageName, projectName } = projectConfig;
  const packagePath = toPackagePath(packageName);

  // Validate module exists
  if (!(await configManager.moduleExists(moduleName))) {
    console.error(chalk.red(`❌ Module '${moduleName}' not found in project`));
    console.error(chalk.gray('   Available modules:'));
    const modules = projectConfig.modules || [];
    modules.forEach(mod => console.error(chalk.gray(`   - ${mod}`)));
    process.exit(1);
  }

  // Read available topics from kafka.yaml
  const topics = await getAvailableTopics(projectDir);
  
  if (topics.length === 0) {
    console.error(chalk.red('❌ No topics found in kafka.yaml'));
    console.error(chalk.gray('   Add topics using: eva4j generate kafka-event <module> <event-name>'));
    process.exit(1);
  }

  // Prompt for topic selection (multiple)
  const { selectedTopics } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedTopics',
      message: 'Select topics to listen to (use space to select, enter to confirm):',
      choices: topics.map(t => ({
        name: `${t.key} (${t.value})`,
        value: t.key,
        checked: false
      })),
      validate: (answer) => {
        if (answer.length === 0) {
          return 'You must select at least one topic';
        }
        return true;
      }
    }
  ]);

  const spinner = ora('Generating Kafka listeners...').start();

  try {
    const generatedListeners = [];

    // Generate individual listener class for each topic
    for (const topicKey of selectedTopics) {
      const topicContext = buildTopicContext(packageName, moduleName, topicKey, topics);
      
      const listenerPath = path.join(
        projectDir,
        'src',
        'main',
        'java',
        packagePath,
        moduleName,
        'infrastructure',
        'kafkaListener',
        `${topicContext.listenerClassName}.java`
      );

      // Check if listener already exists
      if (await fs.pathExists(listenerPath)) {
        console.log(chalk.yellow(`   ⚠ ${topicContext.listenerClassName}.java already exists, skipping...`));
        continue;
      }

      spinner.text = `Generating ${topicContext.listenerClassName}...`;
      
      const templatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-listener', 'KafkaListenerClass.java.ejs');
      await renderAndWrite(templatePath, listenerPath, topicContext);
      
      generatedListeners.push(topicContext.listenerClassName);
    }

    if (generatedListeners.length === 0) {
      spinner.warn(chalk.yellow('No new listeners were generated (all already exist)'));
    } else {
      spinner.succeed(chalk.green(`✨ ${generatedListeners.length} Kafka listener(s) generated successfully!`));
    }

    // Display generated components
    console.log(chalk.blue('\n📦 Generated components:'));
    generatedListeners.forEach(className => {
      console.log(chalk.gray(`  ├── ${moduleName}/infrastructure/kafkaListener/${className}.java`));
    });
    
    if (generatedListeners.length > 0) {
      console.log(chalk.blue('\n✅ Listeners configured:'));
      selectedTopics.forEach(topic => {
        const className = generateListenerClassName(topic, moduleName);
        console.log(chalk.gray(`  ├── ${className} - listening to: ${topic}`));
      });

      console.log(chalk.yellow('\n💡 Next steps:'));
      console.log(chalk.gray('  1. Implement event processing logic in each listener\'s handle() method'));
      console.log(chalk.gray('  2. Consider creating use cases to handle events via UseCaseMediator'));
      console.log(chalk.gray('  3. Test your listeners with Kafka producer'));
      console.log(chalk.gray('\n  Each listener class follows the Open/Closed principle'));
      console.log(chalk.gray('  Add new listeners without modifying existing ones!'));
    }

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate Kafka listener'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Read available topics from kafka.yaml
 */
async function getAvailableTopics(projectDir) {
  const kafkaYmlPath = path.join(projectDir, 'src', 'main', 'resources', 'parameters', 'local', 'kafka.yaml');
  
  if (!(await fs.pathExists(kafkaYmlPath))) {
    return [];
  }

  const kafkaContent = await fs.readFile(kafkaYmlPath, 'utf8');
  const kafkaConfig = yaml.load(kafkaContent);

  if (!kafkaConfig.topics || Object.keys(kafkaConfig.topics).length === 0) {
    return [];
  }

  return Object.entries(kafkaConfig.topics).map(([key, value]) => ({
    key,
    value
  }));
}

/**
 * Build context object for a topic
 */
function buildTopicContext(packageName, moduleName, topicKey, allTopics) {
  const topic = allTopics.find(t => t.key === topicKey);
  const topicValue = topic.value;

  // Generate class name: user-created + user module → UserUserCreatedListener
  const listenerClassName = generateListenerClassName(topicKey, moduleName);
  
  // Generate bean name: UserUserCreatedListener → userUserCreatedListener
  const listenerBeanName = toCamelCase(listenerClassName);
  
  // Generate method name: user-created → handleUserCreatedListener
  const methodName = generateMethodName(topicKey);
  
  // Generate variable name: user-created → userCreatedTopic
  const topicVariableName = toCamelCase(topicKey);

  return {
    packageName,
    moduleName,
    topicNameKebab: topicKey,
    topicValue,
    topicSpringProperty: `\${topics.${topicKey}}`,
    topicVariableName,
    methodName,
    listenerClassName,
    listenerBeanName
  };
}

/**
 * Generate listener class name from topic key and module name
 * Example: user-created + notification → NotificationUserCreatedListener
 */
function generateListenerClassName(topicKey, moduleName) {
  const modulePrefix = toPascalCase(moduleName);
  const topicName = toPascalCase(topicKey);
  return `${modulePrefix}${topicName}Listener`;
}

/**
 * Generate method name from topic key
 * Example: user-created → handleUserCreatedListener
 */
function generateMethodName(topicKey) {
  const pascalCase = toPascalCase(topicKey);
  return `handle${pascalCase}Listener`;
}

module.exports = generateKafkaListenerCommand;
