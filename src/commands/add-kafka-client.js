const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toPackagePath } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');

async function addKafkaClientCommand() {
  const projectDir = process.cwd();
  
  // Validate we're in an eva4j project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  // Check if kafka is already installed
  const configManager = new ConfigManager(projectDir);
  if (await configManager.featureExists('kafka')) {
    console.error(chalk.red('❌ Kafka client is already installed in this project'));
    console.log(chalk.gray('\nKafka dependencies and configuration already exist.'));
    process.exit(1);
  }

  // Load project configuration
  const projectConfig = await configManager.loadProjectConfig();
  if (!projectConfig) {
    console.error(chalk.red('❌ Could not load project configuration'));
    console.error(chalk.gray('Make sure .eva4j.json exists in the project root'));
    process.exit(1);
  }

  const { packageName, projectName, groupId } = projectConfig;
  const packagePath = toPackagePath(packageName);

  // Check if shared module exists
  const sharedPath = path.join(projectDir, 'src', 'main', 'java', packagePath, 'shared');
  if (!(await fs.pathExists(sharedPath))) {
    console.error(chalk.red('❌ Shared module not found'));
    console.error(chalk.gray('Create at least one module first using: eva4j add module <name>'));
    process.exit(1);
  }

  const spinner = ora('Adding Kafka client support...').start();

  try {
    const context = {
      packageName,
      packagePath,
      projectName,
      groupId
    };

    // 1. Add dependencies to build.gradle
    spinner.text = 'Adding Kafka dependencies to build.gradle...';
    await addKafkaDependencies(projectDir);

    // 2. Generate kafka.yml files for all environments
    spinner.text = 'Generating Kafka configuration files...';
    await generateKafkaConfigFiles(projectDir, context);

    // 3. Add kafka.yml imports to application-*.yml files
    spinner.text = 'Updating application configuration files...';
    await addKafkaImports(projectDir);

    // 4. Generate KafkaConfig.java
    spinner.text = 'Generating KafkaConfig class...';
    await generateKafkaConfigClass(projectDir, context);

    // 5. Save feature to configuration
    await configManager.addFeature('kafka');

    spinner.succeed(chalk.green('Kafka client support added successfully! ✨'));

    console.log(chalk.blue('\n📦 Added components:'));
    console.log(chalk.gray('  ├── build.gradle (Kafka dependencies)'));
    console.log(chalk.gray('  ├── src/main/resources/parameters/'));
    console.log(chalk.gray('  │   ├── local/kafka.yml'));
    console.log(chalk.gray('  │   ├── develop/kafka.yml'));
    console.log(chalk.gray('  │   ├── test/kafka.yml'));
    console.log(chalk.gray('  │   └── production/kafka.yml'));
    console.log(chalk.gray('  └── shared/configurations/kafkaConfig/KafkaConfig.java'));
    
    console.log(chalk.blue('\n✅ Kafka client configured successfully!'));
    console.log(chalk.white('\n   Bootstrap Servers: localhost:9092'));
    console.log(chalk.white(`   Consumer Group: ${projectName}-api-group`));
    console.log(chalk.gray('\n   Update kafka.yml files to customize broker URLs per environment'));
    console.log();

  } catch (error) {
    spinner.fail(chalk.red('Failed to add Kafka client support'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

/**
 * Add Kafka dependencies to build.gradle
 */
async function addKafkaDependencies(projectDir) {
  const buildGradlePath = path.join(projectDir, 'build.gradle');
  let buildGradleContent = await fs.readFile(buildGradlePath, 'utf-8');

  // Check if dependencies already exist
  if (buildGradleContent.includes('spring-kafka')) {
    return; // Already added
  }

  // Find the dependencies block and add Kafka dependencies
  const dependenciesMatch = buildGradleContent.match(/(dependencies\s*\{[^}]*)(implementation 'org\.springframework\.modulith:spring-modulith-starter-core'[^\n]*\n)/s);
  
  if (!dependenciesMatch) {
    throw new Error('Could not find dependencies block in build.gradle');
  }

  const kafkaDependencies = `\n\t// Kafka\n\timplementation 'org.springframework.kafka:spring-kafka'\n\ttestImplementation 'org.springframework.kafka:spring-kafka-test'\n\n\t`;

  buildGradleContent = buildGradleContent.replace(
    dependenciesMatch[0],
    dependenciesMatch[1] + dependenciesMatch[2] + kafkaDependencies
  );

  await fs.writeFile(buildGradlePath, buildGradleContent, 'utf-8');
}

/**
 * Generate kafka.yml configuration files for all environments
 */
async function generateKafkaConfigFiles(projectDir, context) {
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'base', 'resources', 'parameters');
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const outputPath = path.join(projectDir, 'src', 'main', 'resources', 'parameters', env, 'kafka.yml');
    const templateFile = path.join(templatePath, env, 'kafka.yml.ejs');
    
    await renderAndWrite(templateFile, outputPath, context);
  }
}

/**
 * Add kafka.yml imports to application-*.yml files
 */
async function addKafkaImports(projectDir) {
  const resourcesDir = path.join(projectDir, 'src', 'main', 'resources');
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const appYmlPath = path.join(resourcesDir, `application-${env}.yml`);
    
    if (await fs.pathExists(appYmlPath)) {
      let content = await fs.readFile(appYmlPath, 'utf-8');
      
      // Check if kafka.yml import already exists
      if (content.includes('kafka.yml')) {
        continue;
      }

      // Add kafka.yml import after existing imports
      const importPattern = /(spring:\s*\n\s*config:\s*\n\s*import:\s*\n(?:\s*-\s*"[^"]+"\s*\n)*)/;
      
      if (importPattern.test(content)) {
        content = content.replace(
          importPattern,
          `$1      - "classpath:parameters/${env}/kafka.yml"\n`
        );
      } else {
        // If no imports section exists, add it
        content = `spring:\n  config:\n    import:\n      - "classpath:parameters/${env}/kafka.yml"\n\n` + content;
      }

      await fs.writeFile(appYmlPath, content, 'utf-8');
    }
  }
}

/**
 * Generate KafkaConfig.java class
 */
async function generateKafkaConfigClass(projectDir, context) {
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'shared', 'configurations', 'kafkaConfig', 'KafkaConfig.java.ejs');
  const outputPath = path.join(projectDir, 'src', 'main', 'java', context.packagePath, 'shared', 'infrastructure', 'configurations', 'kafkaConfig', 'KafkaConfig.java');
  
  await renderAndWrite(templatePath, outputPath, context);
}

module.exports = addKafkaClientCommand;
