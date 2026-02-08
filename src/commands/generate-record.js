const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const inquirer = require('inquirer');
const clipboardy = require('clipboardy');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toPackagePath, toPascalCase } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');
const { parseJsonToRecords } = require('../utils/json-to-java');

async function generateRecordCommand(options = {}) {
  const projectDir = process.cwd();
  
  // Validate we're in an eva4j project
  if (!(await isEva4jProject(projectDir))) {
    console.error(chalk.red('❌ Not in an eva4j project directory'));
    console.error(chalk.gray('Run this command inside a project created with eva4j'));
    process.exit(1);
  }

  // Load project configuration
  const configManager = new ConfigManager(projectDir);
  const projectConfig = await configManager.loadProjectConfig();
  
  if (!projectConfig) {
    console.error(chalk.red('❌ Could not load project configuration'));
    console.error(chalk.gray('Make sure .eva4j.json exists in the project root'));
    process.exit(1);
  }

  const { packageName, artifactId } = projectConfig;
  const packagePath = toPackagePath(packageName);

  let jsonData;
  let jsonString;

  try {
    // Read JSON from clipboard or options
    if (options.json) {
      jsonString = options.json;
      jsonData = JSON.parse(jsonString);
    } else {
      const spinner = ora('Reading JSON from clipboard...').start();
      try {
        jsonString = await clipboardy.read();
        jsonData = JSON.parse(jsonString);
        spinner.succeed(chalk.green('JSON loaded from clipboard'));
      } catch (error) {
        spinner.fail(chalk.red('Failed to read or parse JSON from clipboard'));
        console.error(chalk.red('\n❌ Error:'), error.message);
        console.error(chalk.gray('\nMake sure you have valid JSON in your clipboard'));
        console.error(chalk.gray('Or use --json option to provide JSON directly'));
        process.exit(1);
      }
    }

    // Show JSON preview
    console.log(chalk.blue('\n📋 JSON Preview:'));
    console.log(chalk.gray(JSON.stringify(jsonData, null, 2)));
    console.log();

    // Get available modules
    const modules = projectConfig.modules || [];
    if (modules.length === 0) {
      console.error(chalk.red('❌ No modules found in project'));
      console.error(chalk.gray('Create a module first using: eva4j add module <name>'));
      process.exit(1);
    }

    // Interactive prompts
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'recordName',
        message: 'Enter the name for the main record:',
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Record name is required';
          }
          if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(input)) {
            return 'Record name must start with a letter and contain only letters, numbers, hyphens, or underscores';
          }
          return true;
        }
      },
      {
        type: 'list',
        name: 'moduleName',
        message: 'Select the target module:',
        choices: modules.map(m => m.name)
      },
      {
        type: 'list',
        name: 'targetFolder',
        message: 'Select the target folder:',
        choices: [
          { name: 'DTOs (application/dtos)', value: 'dtos' },
          { name: 'Commands (application/commands)', value: 'commands' },
          { name: 'Queries (application/queries)', value: 'queries' },
          { name: 'Events (application/events)', value: 'events' }
        ]
      }
    ]);

    const { recordName, moduleName, targetFolder } = answers;

    // Validate module exists in filesystem
    const modulePath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName);
    if (!(await fs.pathExists(modulePath))) {
      console.error(chalk.red(`❌ Module '${moduleName}' not found in filesystem`));
      process.exit(1);
    }

    const spinner = ora('Parsing JSON and generating records...').start();

    try {
      // Determine suffix based on target folder
      const suffixMap = {
        'dtos': 'Dto',
        'commands': 'Command',
        'queries': 'Query',
        'events': 'Event'
      };
      const suffix = suffixMap[targetFolder] || '';
      
      // Parse JSON to records
      const { mainRecord, nestedRecords, allRecords } = parseJsonToRecords(jsonData, recordName, suffix);

      spinner.text = 'Generating record files...';

      // Show what will be generated
      console.log();
      spinner.info(chalk.blue(`\n📦 Records to be generated (${allRecords.length}):`));
      allRecords.forEach((record, index) => {
        const isMain = index === 0;
        const icon = isMain ? '📌' : '  ├──';
        console.log(chalk.gray(`${icon} ${record.name}.java`));
      });
      console.log();

      // Ask for generation mode if there are nested records
      let generationMode = 'separated';
      if (nestedRecords.length > 0) {
        const modeAnswer = await inquirer.prompt([
          {
            type: 'list',
            name: 'generationMode',
            message: 'Select generation mode:',
            choices: [
              {
                name: 'Separate files (one file per record)',
                value: 'separated'
              },
              {
                name: 'Nested structure (single file with inner records)',
                value: 'nested'
              }
            ],
            default: 'separated'
          }
        ]);
        generationMode = modeAnswer.generationMode;
      }

      spinner.start('Generating files...');

      // Generate all records
      const generatedFiles = [];
      
      if (generationMode === 'nested') {
        // Nested mode: Generate single file with inner records
        // Merge all imports from main record and nested records
        const allImports = new Set([
          ...mainRecord.imports,
          ...nestedRecords.flatMap(nr => nr.imports)
        ]);
        
        const context = {
          packageName,
          moduleName,
          recordName: mainRecord.name,
          targetFolder,
          fields: mainRecord.fields,
          imports: Array.from(allImports).sort(),
          jsonExample: mainRecord.jsonExample,
          nestedRecords: nestedRecords
        };

        const templatePath = path.join(__dirname, '..', '..', 'templates', 'record', 'NestedRecord.java.ejs');
        const outputPath = path.join(
          projectDir,
          'src', 'main', 'java', packagePath,
          moduleName, 'application', targetFolder,
          `${mainRecord.name}.java`
        );

        await renderAndWrite(templatePath, outputPath, context);
        generatedFiles.push({
          name: mainRecord.name,
          path: path.relative(projectDir, outputPath)
        });
      } else {
        // Separated mode: Generate one file per record (current behavior)
        for (const record of allRecords) {
          // Collect nested record names for imports
          const nestedRecordImports = record.fields
            .filter(f => f.isNestedRecord)
            .map(f => f.nestedRecordName)
            .filter((value, index, self) => self.indexOf(value) === index); // unique

          const context = {
            packageName,
            moduleName,
            recordName: record.name,
            targetFolder,
            fields: record.fields,
            imports: record.imports,
            jsonExample: record.jsonExample,
            hasNestedRecords: nestedRecordImports.length > 0,
            nestedRecordImports
          };

          const templatePath = path.join(__dirname, '..', '..', 'templates', 'record', 'Record.java.ejs');
          const outputPath = path.join(
            projectDir,
            'src', 'main', 'java', packagePath,
            moduleName, 'application', targetFolder,
            `${record.name}.java`
          );

          await renderAndWrite(templatePath, outputPath, context);
          generatedFiles.push({
            name: record.name,
            path: path.relative(projectDir, outputPath)
          });
        }
      }

      spinner.succeed(chalk.green('Records generated successfully! ✨'));

      console.log(chalk.blue('\n📦 Generated files:'));
      generatedFiles.forEach(file => {
        console.log(chalk.gray(`  ├── ${file.path}`));
      });

      console.log(chalk.blue('\n✅ All records created successfully!'));
      console.log(chalk.white(`\n   Module: ${moduleName}`));
      console.log(chalk.white(`   Location: application/${targetFolder}`));
      console.log(chalk.white(`   Main Record: ${mainRecord.name}`));
      if (nestedRecords.length > 0) {
        const mode = generationMode === 'nested' ? 'as inner records' : 'as separate files';
        console.log(chalk.white(`   Nested Records: ${nestedRecords.map(r => r.name).join(', ')} (${mode})`));
      }
      console.log();

    } catch (error) {
      spinner.fail(chalk.red('Failed to generate records'));
      throw error;
    }

  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

module.exports = generateRecordCommand;
