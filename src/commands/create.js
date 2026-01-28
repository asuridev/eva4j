const inquirer = require('inquirer');
const ora = require('ora');
const chalk = require('chalk');
const BaseGenerator = require('../generators/base-generator');
const { buildBaseContext } = require('../utils/context-builder');
const { validateProjectName, validateGroupId } = require('../utils/validator');
const defaults = require('../../config/defaults.json');

async function createCommand(projectName, options) {
  console.log(chalk.blue.bold('\n🚀 Creating new Spring Boot project with eva4j\n'));
  
  // Gather project information
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'artifactId',
      message: 'Project artifact ID:',
      default: projectName,
      validate: validateProjectName
    },
    {
      type: 'input',
      name: 'groupId',
      message: 'Group ID:',
      default: 'com.example',
      validate: validateGroupId
    },
    {
      type: 'list',
      name: 'javaVersion',
      message: 'Java version:',
      choices: [21, 22, 23],
      default: 21
    },
    {
      type: 'input',
      name: 'springBootVersion',
      message: 'Spring Boot version:',
      default: defaults.springBootVersion
    },
    {
      type: 'list',
      name: 'databaseType',
      message: 'Database type:',
      choices: ['postgresql', 'mysql', 'h2'],
      default: 'postgresql'
    },
    {
      type: 'input',
      name: 'author',
      message: 'Author name:',
      default: 'Developer'
    }
  ]);
  
  // Set all required dependencies
  answers.dependencies = ['web', 'data-jpa', 'security', 'validation', 'actuator'];
  
  // Build context
  const context = buildBaseContext(answers);
  
  // Generate project
  const spinner = ora('Generating project structure...').start();
  
  try {
    const generator = new BaseGenerator(context);
    await generator.generate();
    
    spinner.succeed(chalk.green('Project created successfully! ✨'));
    
    console.log(chalk.blue('\n📦 Project structure:'));
    console.log(chalk.gray(`  ${context.artifactId}/`));
    console.log(chalk.gray(`    ├── src/main/java/${context.packagePath.replace(/\//g, '.')}`));
    console.log(chalk.gray(`    │   ├── ${context.applicationClassName}.java`));
    console.log(chalk.gray(`    │   └── common/`));
    console.log(chalk.gray(`    ├── build.gradle`));
    console.log(chalk.gray(`    └── README.md`));
    
    console.log(chalk.blue('\n🚀 Next steps:'));
    console.log(chalk.white(`  cd ${context.artifactId}`));
    console.log(chalk.white(`  eva4j add module user    # Add your first module`));
    console.log(chalk.white(`  ./gradlew bootRun        # Run the application`));
    console.log();
    
  } catch (error) {
    spinner.fail(chalk.red('Failed to create project'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

module.exports = createCommand;
