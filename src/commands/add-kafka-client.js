const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toPackagePath } = require('../utils/naming');
const { renderAndWrite, renderTemplate } = require('../utils/template-engine');
const defaults = require('../../config/defaults.json');

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

  const { packageName, projectName, groupId, artifactId } = projectConfig;
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
      groupId,
      artifactId,
      kafkaConfluentVersion: defaults.kafkaConfluentVersion
    };

    // 1. Add dependencies to build.gradle
    spinner.text = 'Adding Kafka dependencies to build.gradle...';
    await addKafkaDependencies(projectDir);

    // 2. Generate kafka.yaml files for all environments
    spinner.text = 'Generating Kafka configuration files...';
    await generateKafkaConfigFiles(projectDir, context);

    // 3. Add kafka.yaml imports to application-*.yaml files
    spinner.text = 'Updating application configuration files...';
    await addKafkaImports(projectDir);

    // 4. Generate KafkaConfig.java
    spinner.text = 'Generating KafkaConfig class...';
    await generateKafkaConfigClass(projectDir, context);

    // 5. Update docker-compose.yaml if it exists
    spinner.text = 'Updating docker-compose.yaml...';
    await updateDockerCompose(projectDir, context);

    // 6. Save feature to configuration
    await configManager.addFeature('kafka');

    spinner.succeed(chalk.green('Kafka client support added successfully! ✨'));

    console.log(chalk.blue('\n📦 Added components:'));
    console.log(chalk.gray('  ├── build.gradle (Kafka dependencies)'));
    console.log(chalk.gray('  ├── docker-compose.yaml (Kafka cluster)'));
    console.log(chalk.gray('  ├── src/main/resources/parameters/'));
    console.log(chalk.gray('  │   ├── local/kafka.yaml'));
    console.log(chalk.gray('  │   ├── develop/kafka.yaml'));
    console.log(chalk.gray('  │   ├── test/kafka.yaml'));
    console.log(chalk.gray('  │   └── production/kafka.yaml'));
    console.log(chalk.gray('  └── shared/configurations/kafkaConfig/KafkaConfig.java'));
    
    console.log(chalk.blue('\n✅ Kafka client configured successfully!'));
    console.log(chalk.white('\n   Bootstrap Servers: localhost:9092'));
    console.log(chalk.white(`   Consumer Group: ${projectName}-api-group`));
    console.log(chalk.white('   Kafka UI: http://localhost:8080'));
    console.log(chalk.gray('\n   Run "docker-compose up -d" to start the Kafka cluster'));
    console.log(chalk.gray('   Update kafka.yaml files to customize broker URLs per environment'));
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
 * Generate kafka.yaml configuration files for all environments
 */
async function generateKafkaConfigFiles(projectDir, context) {
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'base', 'resources', 'parameters');
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const outputPath = path.join(projectDir, 'src', 'main', 'resources', 'parameters', env, 'kafka.yaml');
    const templateFile = path.join(templatePath, env, 'kafka.yaml.ejs');
    
    await renderAndWrite(templateFile, outputPath, context);
  }
}

/**
 * Add kafka.yaml imports to application-*.yaml files
 */
async function addKafkaImports(projectDir) {
  const resourcesDir = path.join(projectDir, 'src', 'main', 'resources');
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const appYmlPath = path.join(resourcesDir, `application-${env}.yaml`);
    
    if (await fs.pathExists(appYmlPath)) {
      let content = await fs.readFile(appYmlPath, 'utf-8');
      
      // Check if kafka.yaml import already exists
      if (content.includes('kafka.yaml')) {
        continue;
      }

      // Add kafka.yaml import after existing imports
      const importPattern = /(spring:\s*\n\s*config:\s*\n\s*import:\s*\n(?:\s*-\s*"[^"]+"\s*\n)*)/;
      
      if (importPattern.test(content)) {
        content = content.replace(
          importPattern,
          `$1      - "classpath:parameters/${env}/kafka.yaml"\n`
        );
      } else {
        // If no imports section exists, add it
        content = `spring:\n  config:\n    import:\n      - "classpath:parameters/${env}/kafka.yaml"\n\n` + content;
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

/**
 * Update docker-compose.yaml to add Kafka services
 */
async function updateDockerCompose(projectDir, context) {
  const dockerComposePath = path.join(projectDir, 'docker-compose.yaml');
  
  // Check if docker-compose.yaml exists
  if (!(await fs.pathExists(dockerComposePath))) {
    return; // No docker-compose to update
  }

  let dockerComposeContent = await fs.readFile(dockerComposePath, 'utf-8');
  
  // Check if Kafka services already exist
  if (dockerComposeContent.includes('kafka:') || dockerComposeContent.includes('zookeeper:')) {
    return; // Kafka already configured
  }

  // Parse existing docker-compose.yaml
  const dockerComposeObj = yaml.load(dockerComposeContent);
  
  // Ensure services section exists
  if (!dockerComposeObj.services) {
    dockerComposeObj.services = {};
  }

  // Read and render Kafka services template
  const kafkaTemplateContent = await renderTemplate(
    path.join(__dirname, '..', '..', 'templates', 'base', 'docker', 'kafka-services.yaml.ejs'),
    context
  );
  
  // Parse the rendered Kafka services
  const kafkaServices = yaml.load(kafkaTemplateContent);
  
  // Merge Kafka services into existing docker-compose
  Object.assign(dockerComposeObj.services, kafkaServices);
  
  // Write updated docker-compose.yaml
  const updatedYaml = yaml.dump(dockerComposeObj, {
    indent: 2,
    lineWidth: -1,
    noRefs: true
  });
  
  await fs.writeFile(dockerComposePath, updatedYaml, 'utf-8');
}

module.exports = addKafkaClientCommand;
