const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toPackagePath } = require('../utils/naming');
const { renderAndWrite, renderTemplate } = require('../utils/template-engine');

const TEMPORAL_SDK_VERSION = '1.24.1';

async function addTemporalClientCommand() {
  const projectDir = process.cwd();

  // Validate we're in an eva4j project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  // Check if temporal is already installed
  const configManager = new ConfigManager(projectDir);
  if (await configManager.featureExists('temporal')) {
    console.error(chalk.red('❌ Temporal client is already installed in this project'));
    console.log(chalk.gray('\nTemporal dependencies and configuration already exist.'));
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

  const spinner = ora('Adding Temporal client support...').start();

  try {
    const context = {
      packageName,
      packagePath,
      projectName,
      groupId,
      artifactId
    };

    // 1. Add dependency to build.gradle
    spinner.text = 'Adding Temporal dependency to build.gradle...';
    await addTemporalDependency(projectDir);

    // 2. Generate temporal.yaml files for all environments
    spinner.text = 'Generating Temporal configuration files...';
    await generateTemporalConfigFiles(projectDir, context);

    // 3. Add temporal.yaml imports to application-*.yaml files
    spinner.text = 'Updating application configuration files...';
    await addTemporalImports(projectDir);

    // 4. Generate activity marker interfaces
    spinner.text = 'Generating activity interfaces...';
    await generateActivityInterfaces(projectDir, context);

    // 5. Generate TemporalConfig.java
    spinner.text = 'Generating TemporalConfig class...';
    await generateTemporalConfigClass(projectDir, context);

    // 6. Update docker-compose.yaml if it exists
    spinner.text = 'Updating docker-compose.yaml...';
    await updateDockerCompose(projectDir, context);

    // 7. Save feature to configuration
    await configManager.addFeature('temporal');

    spinner.succeed(chalk.green('Temporal client support added successfully! ✨'));

    console.log(chalk.blue('\n📦 Added components:'));
    console.log(chalk.gray('  ├── build.gradle (io.temporal:temporal-sdk:' + TEMPORAL_SDK_VERSION + ')'));
    console.log(chalk.gray('  ├── docker-compose.yaml (Temporal cluster)'));
    console.log(chalk.gray('  ├── src/main/resources/parameters/'));
    console.log(chalk.gray('  │   ├── local/temporal.yaml'));
    console.log(chalk.gray('  │   ├── develop/temporal.yaml'));
    console.log(chalk.gray('  │   ├── test/temporal.yaml'));
    console.log(chalk.gray('  │   └── production/temporal.yaml'));
    console.log(chalk.gray('  ├── shared/domain/interfaces/HeavyActivity.java'));
    console.log(chalk.gray('  ├── shared/domain/interfaces/LightActivity.java'));
    console.log(chalk.gray('  └── shared/infrastructure/configurations/temporalConfig/TemporalConfig.java'));

    console.log(chalk.blue('\n✅ Temporal client configured successfully!'));
    console.log(chalk.white('\n   Service URL:  localhost:7233'));
    console.log(chalk.white('   Namespace:    default'));
    console.log(chalk.white('   Temporal UI:  http://localhost:8088'));
    console.log(chalk.yellow('\n   ⚠️  Register your workflow implementation types in TemporalConfig.java'));
    console.log(chalk.gray('   Run "docker-compose up -d" to start the Temporal cluster'));
    console.log(chalk.gray('   Update temporal.yaml files to customize service URLs per environment'));
    console.log();

  } catch (error) {
    spinner.fail(chalk.red('Failed to add Temporal client support'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

/**
 * Add Temporal SDK dependency to build.gradle
 */
async function addTemporalDependency(projectDir) {
  const buildGradlePath = path.join(projectDir, 'build.gradle');
  let buildGradleContent = await fs.readFile(buildGradlePath, 'utf-8');

  // Check if dependency already exists
  if (buildGradleContent.includes('temporal-sdk')) {
    return; // Already added
  }

  // Find the dependencies block and add Temporal dependency after spring-modulith-starter-core
  const dependenciesMatch = buildGradleContent.match(
    /(dependencies\s*\{[^}]*)(implementation 'org\.springframework\.modulith:spring-modulith-starter-core'[^\n]*\n)/s
  );

  if (!dependenciesMatch) {
    throw new Error('Could not find dependencies block in build.gradle');
  }

  const temporalDependency = `\n\t// Temporal\n\timplementation 'io.temporal:temporal-sdk:${TEMPORAL_SDK_VERSION}'\n\n\t`;

  buildGradleContent = buildGradleContent.replace(
    dependenciesMatch[0],
    dependenciesMatch[1] + dependenciesMatch[2] + temporalDependency
  );

  await fs.writeFile(buildGradlePath, buildGradleContent, 'utf-8');
}

/**
 * Generate temporal.yaml configuration files for all environments
 */
async function generateTemporalConfigFiles(projectDir, context) {
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'base', 'resources', 'parameters');
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const outputPath = path.join(projectDir, 'src', 'main', 'resources', 'parameters', env, 'temporal.yaml');
    const templateFile = path.join(templatePath, env, 'temporal.yaml.ejs');

    await renderAndWrite(templateFile, outputPath, context);
  }
}

/**
 * Add temporal.yaml imports to application-*.yaml files
 */
async function addTemporalImports(projectDir) {
  const resourcesDir = path.join(projectDir, 'src', 'main', 'resources');
  const environments = ['local', 'develop', 'test', 'production'];

  for (const env of environments) {
    const appYmlPath = path.join(resourcesDir, `application-${env}.yaml`);

    if (await fs.pathExists(appYmlPath)) {
      let content = await fs.readFile(appYmlPath, 'utf-8');

      // Check if temporal.yaml import already exists
      if (content.includes('temporal.yaml')) {
        continue;
      }

      // Add temporal.yaml import after existing imports
      const importPattern = /(spring:\s*\n\s*config:\s*\n\s*import:\s*\n(?:\s*-\s*"[^"]+"\s*\n)*)/;

      if (importPattern.test(content)) {
        content = content.replace(
          importPattern,
          `$1      - "classpath:parameters/${env}/temporal.yaml"\n`
        );
      } else {
        // If no imports section exists, add it
        content = `spring:\n  config:\n    import:\n      - "classpath:parameters/${env}/temporal.yaml"\n\n` + content;
      }

      await fs.writeFile(appYmlPath, content, 'utf-8');
    }
  }
}

/**
 * Generate HeavyActivity and LightActivity marker interfaces
 */
async function generateActivityInterfaces(projectDir, context) {
  const interfacesTemplateDir = path.join(__dirname, '..', '..', 'templates', 'shared', 'interfaces');
  const interfacesOutputDir = path.join(
    projectDir, 'src', 'main', 'java', context.packagePath, 'shared', 'domain', 'interfaces'
  );

  const interfaces = ['HeavyActivity', 'LightActivity'];

  for (const iface of interfaces) {
    const templateFile = path.join(interfacesTemplateDir, `${iface}.java.ejs`);
    const outputFile = path.join(interfacesOutputDir, `${iface}.java`);
    await renderAndWrite(templateFile, outputFile, context);
  }
}

/**
 * Generate TemporalConfig.java class
 */
async function generateTemporalConfigClass(projectDir, context) {
  const templatePath = path.join(
    __dirname, '..', '..', 'templates', 'shared', 'configurations', 'temporalConfig', 'TemporalConfig.java.ejs'
  );
  const outputPath = path.join(
    projectDir, 'src', 'main', 'java', context.packagePath,
    'shared', 'infrastructure', 'configurations', 'temporalConfig', 'TemporalConfig.java'
  );

  await renderAndWrite(templatePath, outputPath, context);
}

/**
 * Update docker-compose.yaml to add Temporal services
 */
async function updateDockerCompose(projectDir, context) {
  const dockerComposePath = path.join(projectDir, 'docker-compose.yaml');

  // Check if docker-compose.yaml exists
  if (!(await fs.pathExists(dockerComposePath))) {
    return; // No docker-compose to update
  }

  let dockerComposeContent = await fs.readFile(dockerComposePath, 'utf-8');

  // Check if Temporal services already exist
  if (dockerComposeContent.includes('temporal:') || dockerComposeContent.includes('temporalio')) {
    return; // Temporal already configured
  }

  // Parse existing docker-compose.yaml
  const dockerComposeObj = yaml.load(dockerComposeContent);

  // Ensure services section exists
  if (!dockerComposeObj.services) {
    dockerComposeObj.services = {};
  }

  // Render Temporal services template
  const temporalTemplateContent = await renderTemplate(
    path.join(__dirname, '..', '..', 'templates', 'base', 'docker', 'temporal-services.yaml.ejs'),
    context
  );

  // Parse the rendered Temporal services
  const temporalServices = yaml.load(temporalTemplateContent);

  // Merge Temporal services into existing docker-compose
  Object.assign(dockerComposeObj.services, temporalServices);

  // Write updated docker-compose.yaml
  const updatedYaml = yaml.dump(dockerComposeObj, {
    indent: 2,
    lineWidth: -1,
    noRefs: true
  });

  await fs.writeFile(dockerComposePath, updatedYaml, 'utf-8');
}

module.exports = addTemporalClientCommand;
