#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const packageJson = require('../package.json');
const createCommand = require('../src/commands/create');
const addModuleCommand = require('../src/commands/add-module');
const addKafkaClientCommand = require('../src/commands/add-kafka-client');
const generateUsecaseCommand = require('../src/commands/generate-usecase');
const generateHttpExchangeCommand = require('../src/commands/generate-http-exchange');
const generateKafkaEventCommand = require('../src/commands/generate-kafka-event');
const generateKafkaListenerCommand = require('../src/commands/generate-kafka-listener');
const generateResourceCommand = require('../src/commands/generate-resource');
const infoCommand = require('../src/commands/info');
const detachCommand = require('../src/commands/detach');

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
  .command('add <type> [name]')
  .description('Add components to the project. Use: module [name], kafka-client')
  .action(async (type, name, options) => {
    if (type === 'kafka-client') {
      try {
        await addKafkaClientCommand(options);
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
      return;
    }
    
    if (type !== 'module') {
      console.error(chalk.red(`❌ Unknown type: ${type}`));
      console.log(chalk.yellow('\nUsage:'));
      console.log(chalk.gray('  eva4j add module [module-name]  # Interactive or with name'));
      console.log(chalk.gray('  eva4j add kafka-client'));
      console.log(chalk.gray('\nExamples:'));
      console.log(chalk.gray('  eva4j add module user'));
      console.log(chalk.gray('  eva4j add module  # Will prompt for name\n'));
      process.exit(1);
    }
    
    try {
      await addModuleCommand(name, options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Generate command
program
  .command('generate <type> <module> [name]')
  .alias('g')
  .description('Generate components (usecase, http-exchange, kafka-event, kafka-listener, resource)')
  .action(async (type, module, name, options) => {
    if (type === 'usecase') {
      if (!module) {
        console.error(chalk.red('❌ Module name is required'));
        console.log(chalk.gray('Usage: eva4j generate usecase <module> [name]'));
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  eva4j generate usecase user create-user'));
        console.log(chalk.gray('  eva4j generate usecase user  # Will prompt for name\n'));
        process.exit(1);
      }
      try {
        await generateUsecaseCommand(module, name, options);
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
      return;
    }

    if (type === 'http-exchange') {
      if (!module) {
        console.error(chalk.red('❌ Module name is required'));
        console.log(chalk.gray('Usage: eva4j generate http-exchange <module> [port-name]'));
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  eva4j generate http-exchange user product-service'));
        console.log(chalk.gray('  eva4j generate http-exchange user  # Will prompt for port name\n'));
        process.exit(1);
      }
      try {
        await generateHttpExchangeCommand(module, name, options);
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
      return;
    }

    if (type === 'kafka-event') {
      if (!module) {
        console.error(chalk.red('❌ Module name is required'));
        console.log(chalk.gray('Usage: eva4j generate kafka-event <module> [event-name]'));
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  eva4j generate kafka-event user product-created'));
        console.log(chalk.gray('  eva4j generate kafka-event user  # Will prompt for event name\n'));
        process.exit(1);
      }
      try {
        await generateKafkaEventCommand(module, name, options);
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
      return;
    }

    if (type === 'kafka-listener') {
      if (!module) {
        console.error(chalk.red('❌ Module name is required'));
        console.log(chalk.gray('Usage: eva4j generate kafka-listener <module>'));
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  eva4j generate kafka-listener user'));
        console.log(chalk.gray('  eva4j g kafka-listener order\n'));
        process.exit(1);
      }
      try {
        await generateKafkaListenerCommand(module, options);
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
      return;
    }

    if (type === 'resource') {
      if (!module) {
        console.error(chalk.red('❌ Module name is required'));
        console.log(chalk.gray('Usage: eva4j generate resource <module>'));
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  eva4j generate resource user'));
        console.log(chalk.gray('  eva4j g resource product\n'));
        process.exit(1);
      }
      try {
        await generateResourceCommand(module, options);
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
      return;
    }

    console.error(chalk.red(`❌ Unknown type: ${type}`));
    console.log(chalk.yellow('\nUsage:'));
    console.log(chalk.gray('  eva4j generate usecase <name> <module>'));
    console.log(chalk.gray('  eva4j generate http-exchange <port-name> <module>'));
    console.log(chalk.gray('  eva4j generate kafka-event <event-name> <module>'));
    console.log(chalk.gray('  eva4j generate kafka-listener <module>'));
    console.log(chalk.gray('  eva4j generate resource <module>'));
    console.log(chalk.gray('\nExamples:'));
    console.log(chalk.gray('  eva4j generate usecase create-provider provider'));
    console.log(chalk.gray('  eva4j g http-exchange user-service-port user'));
    console.log(chalk.gray('  eva4j g kafka-event user-created user'));
    console.log(chalk.gray('  eva4j g kafka-listener user'));
    console.log(chalk.gray('  eva4j g resource product\n'));
    process.exit(1);
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

// Detach command
program
  .command('detach [module-name]')
  .description('Extract a module into a standalone microservice')
  .action(async (moduleName, options) => {
    try {
      await detachCommand(moduleName, options);
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
  console.log(chalk.gray('  $ eva4j add kafka-client'));
  console.log(chalk.gray('  $ eva4j generate usecase create-provider provider'));
  console.log(chalk.gray('  $ eva4j g usecase get-all-products product'));
  console.log(chalk.gray('  $ eva4j g http-exchange user-service-port user'));
  console.log(chalk.gray('  $ eva4j g kafka-event user-created user'));
  console.log(chalk.gray('  $ eva4j detach user'));
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
