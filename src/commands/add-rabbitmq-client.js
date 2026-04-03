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

async function addRabbitMQClientCommand() {
  const projectDir = process.cwd();
  
  // Validate we're in an eva4j project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  const configManager = new ConfigManager(projectDir);

  // Check if rabbitmq is already installed
  if (await configManager.featureExists('rabbitmq')) {
    console.error(chalk.red('❌ RabbitMQ client is already installed in this project'));
    console.log(chalk.gray('\nRabbitMQ dependencies and configuration already exist.'));
    process.exit(1);
  }

  // Mutual exclusivity: only one broker per project
  if (await configManager.featureExists('kafka')) {
    console.error(chalk.red('❌ Kafka client is already installed in this project'));
    console.log(chalk.gray('\nOnly one message broker is allowed per project.'));
    console.log(chalk.gray('Remove Kafka first if you want to switch to RabbitMQ.'));
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

  const spinner = ora('Adding RabbitMQ client support...').start();

  try {
    const context = {
      packageName,
      packagePath,
      projectName,
      groupId,
      artifactId,
      rabbitmqVersion: defaults.rabbitmqVersion
    };

    // 1. Add dependencies to build.gradle
    spinner.text = 'Adding RabbitMQ dependencies to build.gradle...';
    await addRabbitMQDependencies(projectDir);

    // 2. Generate rabbitmq.yaml files for all environments
    spinner.text = 'Generating RabbitMQ configuration files...';
    await generateRabbitMQConfigFiles(projectDir, context);

    // 3. Add rabbitmq.yaml imports to application-*.yaml files
    spinner.text = 'Updating application configuration files...';
    await addRabbitMQImports(projectDir);

    // 4. Generate RabbitMQConfig.java
    spinner.text = 'Generating RabbitMQConfig class...';
    await generateRabbitMQConfigClass(projectDir, context);

    // 5. Update docker-compose.yaml if it exists
    spinner.text = 'Updating docker-compose.yaml...';
    await updateDockerCompose(projectDir, context);

    // 6. Save feature to configuration
    await configManager.addFeature('rabbitmq');

    spinner.succeed(chalk.green('RabbitMQ client support added successfully! ✨'));

    console.log(chalk.blue('\n📦 Added components:'));
    console.log(chalk.gray('  ├── build.gradle (RabbitMQ dependencies)'));
    console.log(chalk.gray('  ├── docker-compose.yaml (RabbitMQ server)'));
    console.log(chalk.gray('  ├── src/main/resources/parameters/'));
    console.log(chalk.gray('  │   ├── local/rabbitmq.yaml'));
    console.log(chalk.gray('  │   ├── develop/rabbitmq.yaml'));
    console.log(chalk.gray('  │   ├── test/rabbitmq.yaml'));
    console.log(chalk.gray('  │   └── production/rabbitmq.yaml'));
    console.log(chalk.gray('  └── shared/configurations/rabbitmqConfig/RabbitMQConfig.java'));
    
    console.log(chalk.blue('\n✅ RabbitMQ client configured successfully!'));
    console.log(chalk.white('\n   AMQP Host: localhost:5672'));
    console.log(chalk.white(`   Virtual Host: /`));
    console.log(chalk.white('   Management UI: http://localhost:15672'));
    console.log(chalk.gray('\n   Run "docker-compose up -d" to start RabbitMQ'));
    console.log(chalk.gray('   Update rabbitmq.yaml files to customize connection per environment'));
    console.log();

  } catch (error) {
    spinner.fail(chalk.red('Failed to add RabbitMQ client support'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

/**
 * Add RabbitMQ dependencies to build.gradle
 */
async function addRabbitMQDependencies(projectDir) {
  const buildGradlePath = path.join(projectDir, 'build.gradle');
  let buildGradleContent = await fs.readFile(buildGradlePath, 'utf-8');

  // Check if dependencies already exist
  if (buildGradleContent.includes('spring-boot-starter-amqp')) {
    return; // Already added
  }

  // Find the dependencies block and add RabbitMQ dependencies
  const dependenciesMatch = buildGradleContent.match(/(dependencies\s*\{[^}]*)(implementation 'org\.springframework\.modulith:spring-modulith-starter-core'[^\n]*\n)/s);
  
  if (!dependenciesMatch) {
    throw new Error('Could not find dependencies block in build.gradle');
  }

  const rabbitDependencies = `\n\t// RabbitMQ\n\timplementation 'org.springframework.boot:spring-boot-starter-amqp'\n\ttestImplementation 'org.springframework.amqp:spring-rabbit-test'\n\n\t`;

  buildGradleContent = buildGradleContent.replace(
    dependenciesMatch[0],
    dependenciesMatch[1] + dependenciesMatch[2] + rabbitDependencies
  );

  await fs.writeFile(buildGradlePath, buildGradleContent, 'utf-8');
}

/**
 * Generate rabbitmq.yaml configuration files for all environments
 */
async function generateRabbitMQConfigFiles(projectDir, context) {
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'base', 'resources', 'parameters');
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const outputPath = path.join(projectDir, 'src', 'main', 'resources', 'parameters', env, 'rabbitmq.yaml');
    const templateFile = path.join(templatePath, env, 'rabbitmq.yaml.ejs');
    
    await renderAndWrite(templateFile, outputPath, context);
  }
}

/**
 * Add rabbitmq.yaml imports to application-*.yaml files
 */
async function addRabbitMQImports(projectDir) {
  const resourcesDir = path.join(projectDir, 'src', 'main', 'resources');
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const appYmlPath = path.join(resourcesDir, `application-${env}.yaml`);
    
    if (await fs.pathExists(appYmlPath)) {
      let content = await fs.readFile(appYmlPath, 'utf-8');
      
      // Check if rabbitmq.yaml import already exists
      if (content.includes('rabbitmq.yaml')) {
        continue;
      }

      // Add rabbitmq.yaml import after existing imports
      const importPattern = /(spring:\s*\n\s*config:\s*\n\s*import:\s*\n(?:\s*-\s*"[^"]+"\s*\n)*)/;
      
      if (importPattern.test(content)) {
        content = content.replace(
          importPattern,
          `$1      - "classpath:parameters/${env}/rabbitmq.yaml"\n`
        );
      } else {
        // If no imports section exists, add it
        content = `spring:\n  config:\n    import:\n      - "classpath:parameters/${env}/rabbitmq.yaml"\n\n` + content;
      }

      await fs.writeFile(appYmlPath, content, 'utf-8');
    }
  }
}

/**
 * Generate RabbitMQConfig.java class
 */
async function generateRabbitMQConfigClass(projectDir, context) {
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'shared', 'configurations', 'rabbitmqConfig', 'RabbitMQConfig.java.ejs');
  const outputPath = path.join(projectDir, 'src', 'main', 'java', context.packagePath, 'shared', 'infrastructure', 'configurations', 'rabbitmqConfig', 'RabbitMQConfig.java');
  
  await renderAndWrite(templatePath, outputPath, context);
}

/**
 * Update docker-compose.yaml to add RabbitMQ services
 */
async function updateDockerCompose(projectDir, context) {
  const dockerComposePath = path.join(projectDir, 'docker-compose.yaml');
  
  // Check if docker-compose.yaml exists
  if (!(await fs.pathExists(dockerComposePath))) {
    return; // No docker-compose to update
  }

  let dockerComposeContent = await fs.readFile(dockerComposePath, 'utf-8');
  
  // Check if RabbitMQ services already exist
  if (dockerComposeContent.includes('rabbitmq:')) {
    return; // RabbitMQ already configured
  }

  // Parse existing docker-compose.yaml
  const dockerComposeObj = yaml.load(dockerComposeContent);
  
  // Ensure services section exists
  if (!dockerComposeObj.services) {
    dockerComposeObj.services = {};
  }

  // Read and render RabbitMQ services template
  const rabbitTemplateContent = await renderTemplate(
    path.join(__dirname, '..', '..', 'templates', 'base', 'docker', 'rabbitmq-services.yaml.ejs'),
    context
  );
  
  // Parse the rendered RabbitMQ services
  const rabbitServices = yaml.load(rabbitTemplateContent);
  
  // Merge RabbitMQ services into existing docker-compose
  Object.assign(dockerComposeObj.services, rabbitServices);
  
  // Write updated docker-compose.yaml
  const updatedYaml = yaml.dump(dockerComposeObj, {
    indent: 2,
    lineWidth: -1,
    noRefs: true
  });
  
  await fs.writeFile(dockerComposePath, updatedYaml, 'utf-8');
}

module.exports = addRabbitMQClientCommand;
