const chalk = require('chalk');
const ConfigManager = require('../utils/config-manager');

async function infoCommand() {
  const configManager = new ConfigManager();
  
  if (!(await configManager.exists())) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }
  
  const config = await configManager.loadProjectConfig();
  
  if (!config) {
    console.error(chalk.red('❌ Could not load project configuration'));
    process.exit(1);
  }
  
  // Display project info
  console.log(chalk.blue.bold('\n📦 Eva4j Project Information\n'));
  
  console.log(chalk.white('Project Details:'));
  console.log(chalk.gray(`  Name:              ${config.projectName}`));
  console.log(chalk.gray(`  Group ID:          ${config.groupId}`));
  console.log(chalk.gray(`  Artifact ID:       ${config.artifactId}`));
  console.log(chalk.gray(`  Package:           ${config.packageName}`));
  
  console.log(chalk.white('\nVersions:'));
  console.log(chalk.gray(`  Java:              ${config.javaVersion}`));
  console.log(chalk.gray(`  Spring Boot:       ${config.springBootVersion}`));
  console.log(chalk.gray(`  Spring Modulith:   ${config.springModulithVersion}`));
  
  if (config.dependencies && config.dependencies.length > 0) {
    console.log(chalk.white('\nDependencies:'));
    config.dependencies.forEach(dep => {
      console.log(chalk.gray(`  • ${dep}`));
    });
  }
  
  if (config.modules && config.modules.length > 0) {
    console.log(chalk.white('\nModules:'));
    config.modules.forEach(module => {
      const features = [];
      if (module.hasSoftDelete) features.push('soft-delete');
      if (module.hasAudit) features.push('audit');
      
      const featureText = features.length > 0 ? chalk.gray(` (${features.join(', ')})`) : '';
      console.log(chalk.gray(`  • ${module.name}${featureText}`));
    });
  } else {
    console.log(chalk.white('\nModules:'));
    console.log(chalk.gray('  No modules added yet'));
  }
  
  console.log(chalk.white('\nTimestamps:'));
  console.log(chalk.gray(`  Created:           ${new Date(config.createdAt).toLocaleString()}`));
  console.log(chalk.gray(`  Last Updated:      ${new Date(config.updatedAt).toLocaleString()}`));
  
  console.log();
}

module.exports = infoCommand;
