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

  const spinner = ora('Generating Kafka listener...').start();

  try {
    const listenerPath = path.join(
      projectDir,
      'src',
      'main',
      'java',
      packagePath,
      moduleName,
      'infrastructure',
      'kafkaListener',
      'KafkaController.java'
    );

    const listenerExists = await fs.pathExists(listenerPath);

    if (!listenerExists) {
      // First time: Create new KafkaController class with first topic
      spinner.text = 'Creating KafkaController class...';
      
      const firstTopic = selectedTopics[0];
      const firstContext = buildTopicContext(packageName, moduleName, firstTopic, topics);
      
      const templatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-listener', 'KafkaController.java.ejs');
      await renderAndWrite(templatePath, listenerPath, firstContext);

      // Add remaining topics as additional methods
      for (let i = 1; i < selectedTopics.length; i++) {
        spinner.text = `Adding listener for ${selectedTopics[i]}...`;
        const topicContext = buildTopicContext(packageName, moduleName, selectedTopics[i], topics);
        await addListenerMethod(listenerPath, topicContext);
      }

    } else {
      // Update existing KafkaController class
      spinner.text = 'Updating existing KafkaController class...';
      
      for (const topicKey of selectedTopics) {
        const topicContext = buildTopicContext(packageName, moduleName, topicKey, topics);
        await addListenerMethod(listenerPath, topicContext);
      }
    }

    spinner.succeed(chalk.green(`✨ Kafka listener ${listenerExists ? 'updated' : 'generated'} successfully!`));

    // Display generated components
    console.log(chalk.blue('\n📦 Generated/Updated components:'));
    console.log(chalk.gray(`  └── ${moduleName}/infrastructure/kafkaListener/KafkaController.java`));
    
    console.log(chalk.blue('\n📝 Listener methods added:'));
    selectedTopics.forEach(topic => {
      const methodName = generateMethodName(topic);
      console.log(chalk.gray(`  ├── ${methodName}() - listening to topic: ${topic}`));
    });

    console.log(chalk.yellow('\n⚠️  Next steps:'));
    console.log(chalk.gray('  1. Implement event processing logic in listener methods'));
    console.log(chalk.gray('  2. Consider creating use cases to handle events via UseCaseMediator'));
    console.log(chalk.gray('  3. Test your listeners with Kafka producer'));

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

  // Generate method name: user-created → handleUserCreatedListener
  const methodName = generateMethodName(topicKey);
  
  // Generate variable name: user-created → usercreatedTopic
  const topicVariableName = toCamelCase(topicKey.replace(/-/g, ''));

  return {
    packageName,
    moduleName,
    topicNameKebab: topicKey,
    topicValue,
    topicSpringProperty: `\${topics.${topicKey}}`,
    topicVariableName,
    methodName
  };
}

/**
 * Generate method name from topic key
 * Example: user-created → handleUserCreatedListener
 */
function generateMethodName(topicKey) {
  const pascalCase = toPascalCase(topicKey);
  return `handle${pascalCase}Listener`;
}

/**
 * Add a listener method to existing KafkaListener class
 */
async function addListenerMethod(listenerPath, context) {
  let content = await fs.readFile(listenerPath, 'utf-8');

  // Check if method already exists
  if (content.includes(`void ${context.methodName}(`)) {
    console.log(chalk.yellow(`   ⚠ Method ${context.methodName}() already exists, skipping...`));
    return;
  }

  // Add @Value field if not exists
  if (!content.includes(`private String ${context.topicVariableName}Topic;`)) {
    content = await addValueField(content, context);
  }

  // Add listener method before closing brace
  const methodTemplatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-listener', 'ListenerMethod.java.ejs');
  const methodContent = await renderTemplate(methodTemplatePath, context);

  // Find last closing brace
  const lastBraceIndex = content.lastIndexOf('}');
  if (lastBraceIndex === -1) {
    throw new Error('Could not find closing brace in KafkaController class');
  }

  // Insert method before closing brace
  content = content.slice(0, lastBraceIndex) + methodContent + '\n}\n';

  await fs.writeFile(listenerPath, content, 'utf-8');
}

/**
 * Add @Value field to KafkaController class
 */
async function addValueField(content, context) {
  const valueFieldTemplatePath = path.join(__dirname, '..', '..', 'templates', 'kafka-listener', 'ValueField.java.ejs');
  const valueFieldContent = await renderTemplate(valueFieldTemplatePath, context);

  // Find existing @Value fields
  const valueFieldPattern = /(@Value\([^)]+\)\s*\n\s*private\s+String\s+\w+Topic;\s*\n)/g;
  const valueFields = [...content.matchAll(valueFieldPattern)];

  if (valueFields.length > 0) {
    // Add after last @Value field
    const lastField = valueFields[valueFields.length - 1];
    const insertPos = lastField.index + lastField[0].length;
    return content.slice(0, insertPos) + valueFieldContent + content.slice(insertPos);
  } else {
    // Add after UseCaseMediator field declaration
    const fieldPattern = /(private\s+final\s+UseCaseMediator\s+useCaseMediator;\s*\n)/;
    const fieldMatch = content.match(fieldPattern);
    
    if (fieldMatch) {
      const insertPos = fieldMatch.index + fieldMatch[0].length;
      return content.slice(0, insertPos) + '\n' + valueFieldContent + content.slice(insertPos);
    }
  }

  return content;
}

module.exports = generateKafkaListenerCommand;
