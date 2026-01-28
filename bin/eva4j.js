#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const packageJson = require('../package.json');
const createCommand = require('../src/commands/create');
const addModuleCommand = require('../src/commands/add-module');
const infoCommand = require('../src/commands/info');

const program = new Command();

program
  .name('eva4j')
  .description(chalk.blue('CLI for generating Spring Boot projects with modular architecture'))
  .version(packageJson.version, '-v, --version', 'Output the current version');

// Create command
program
  .command('create <project-name>')
  .description('Create a new Spring Boot project')
  .action(async (projectName, options) => {
    try {
      await createCommand(projectName, options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Add module command
program
  .command('add <type> <name>')
  .description('Add components to the project (module)')
  .action(async (type, name, options) => {
    if (type !== 'module') {
      console.error(chalk.red(`❌ Unknown type: ${type}`));
      console.log(chalk.yellow('\nUsage: eva4j add module <module-name>'));
      console.log(chalk.gray('Example: eva4j add module user\n'));
      process.exit(1);
    }
    
    try {
      await addModuleCommand(name, options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Info command
program
  .command('info')
  .description('Display project information and configuration')
  .action(async (options) => {
    try {
      await infoCommand(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Help command
program.on('--help', () => {
  console.log('');
  console.log(chalk.blue('Examples:'));
  console.log(chalk.gray('  $ eva4j create my-project'));
  console.log(chalk.gray('  $ eva4j add module user'));
  console.log(chalk.gray('  $ eva4j add module product'));
  console.log(chalk.gray('  $ eva4j info'));
  console.log('');
  console.log(chalk.blue('For more information, visit:'));
  console.log(chalk.gray('  https://github.com/your-repo/eva4j'));
  console.log('');
});

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

program.parse(process.argv);
