const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const inquirer = require('inquirer');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toPackagePath, toCamelCase, toKebabCase } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');
const { parseDomainYaml, generateEntityImports } = require('../utils/yaml-to-entity');
const SharedGenerator = require('../generators/shared-generator');

async function generateEntitiesCommand(moduleName) {
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

  // Validate module exists
  if (!(await configManager.moduleExists(moduleName))) {
    console.error(chalk.red(`❌ Module '${moduleName}' not found`));
    console.error(chalk.gray('Create the module first using: eva4j add module ' + moduleName));
    process.exit(1);
  }

  // Path to domain.yaml in module root
  const moduleBasePath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName);
  const domainYamlPath = path.join(moduleBasePath, 'domain.yaml');

  // Check if domain.yaml exists
  if (!(await fs.pathExists(domainYamlPath))) {
    console.error(chalk.red(`❌ domain.yaml not found in module '${moduleName}'`));
    console.error(chalk.gray(`Expected location: ${path.relative(projectDir, domainYamlPath)}`));
    console.error(chalk.gray('\nCreate a domain.yaml file in the module root with your aggregate definitions'));
    process.exit(1);
  }

  const spinner = ora('Parsing domain.yaml...').start();

  try {
    // Parse domain.yaml
    const { aggregates, allEnums } = await parseDomainYaml(domainYamlPath, packageName, moduleName);
    
    spinner.succeed(chalk.green(`Found ${aggregates.length} aggregate(s) and ${allEnums.length} enum(s)`));
    
    // Check if any entity has auditable: true
    const hasAuditableEntities = aggregates.some(agg => 
      agg.rootEntity.auditable || agg.secondaryEntities.some(e => e.auditable)
    );
    
    // Generate AuditableEntity if needed
    if (hasAuditableEntities) {
      const sharedBasePath = path.join(projectDir, 'src', 'main', 'java', packagePath, 'shared');
      const sharedGenerator = new SharedGenerator({ packageName, packagePath });
      await sharedGenerator.generateAuditableEntity(sharedBasePath);
    }
    
    console.log(chalk.blue('\n📦 Aggregates to generate:'));
    aggregates.forEach(agg => {
      console.log(chalk.gray(`  ├── ${agg.name} (Root: ${agg.rootEntity.name})`));
      agg.secondaryEntities.forEach(entity => {
        console.log(chalk.gray(`  │   ├── ${entity.name}`));
      });
      agg.valueObjects.forEach(vo => {
        console.log(chalk.gray(`  │   └── ${vo.name} (VO)`));
      });
    });
    console.log();

    spinner.start('Generating files...');

    const generatedFiles = [];

    // Generate enums
    for (const enumDef of allEnums) {
      const context = {
        packageName,
        moduleName,
        name: enumDef.name,
        values: enumDef.values
      };

      const templatePath = path.join(__dirname, '..', '..', 'templates', 'aggregate', 'Enum.java.ejs');
      const outputPath = path.join(
        moduleBasePath,
        'domain', 'models', 'enums',
        `${enumDef.name}.java`
      );

      await renderAndWrite(templatePath, outputPath, context);
      generatedFiles.push({ type: 'Enum', name: enumDef.name, path: path.relative(projectDir, outputPath) });
    }

    // Generate aggregates
    for (const aggregate of aggregates) {
      const { name: aggregateName, rootEntity, secondaryEntities, valueObjects } = aggregate;

      // 1. Generate Domain Aggregate Root
      const rootDomainContext = {
        packageName,
        moduleName,
        name: rootEntity.name,
        fields: rootEntity.fields,
        relationships: rootEntity.relationships,
        imports: rootEntity.imports,
        valueObjects,
        aggregateMethods: aggregate.aggregateMethods,
        auditable: rootEntity.auditable
      };

      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'AggregateRoot.java.ejs'),
        path.join(moduleBasePath, 'domain', 'models', 'entities', `${rootEntity.name}.java`),
        rootDomainContext
      );
      generatedFiles.push({ type: 'Domain Entity', name: rootEntity.name, path: `${moduleName}/domain/models/entities/${rootEntity.name}.java` });

      // 2. Generate JPA Aggregate Root
      const rootJpaContext = {
        packageName,
        moduleName,
        name: rootEntity.name,
        tableName: rootEntity.tableName,
        fields: rootEntity.fields,
        relationships: rootEntity.relationships,
        imports: generateEntityImports(rootEntity.fields, rootEntity.relationships, rootEntity.enums, allEnums, packageName, moduleName, false),
        valueObjects,
        enums: rootEntity.enums,
        auditable: rootEntity.auditable
      };

      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'JpaAggregateRoot.java.ejs'),
        path.join(moduleBasePath, 'infrastructure', 'database', 'entities', `${rootEntity.name}Jpa.java`),
        rootJpaContext
      );
      generatedFiles.push({ type: 'JPA Entity', name: `${rootEntity.name}Jpa`, path: `${moduleName}/infrastructure/database/entities/${rootEntity.name}Jpa.java` });

      // 3. Generate Secondary Entities (Domain + JPA)
      for (const entity of secondaryEntities) {
        // Domain Entity
        const entityDomainContext = {
          packageName,
          moduleName,
          name: entity.name,
          fields: entity.fields,
          relationships: entity.relationships,
          imports: entity.imports,
          valueObjects,
          auditable: entity.auditable
        };

        await renderAndWrite(
          path.join(__dirname, '..', '..', 'templates', 'aggregate', 'DomainEntity.java.ejs'),
          path.join(moduleBasePath, 'domain', 'models', 'entities', `${entity.name}.java`),
          entityDomainContext
        );
        generatedFiles.push({ type: 'Domain Entity', name: entity.name, path: `${moduleName}/domain/models/entities/${entity.name}.java` });

        // JPA Entity
        const entityJpaContext = {
          packageName,
          moduleName,
          name: entity.name,
          tableName: entity.tableName,
          fields: entity.fields,
          relationships: entity.relationships,
          imports: generateEntityImports(entity.fields, entity.relationships, entity.enums, allEnums, packageName, moduleName, false),
          valueObjects,
          enums: entity.enums,
          auditable: entity.auditable
        };

        await renderAndWrite(
          path.join(__dirname, '..', '..', 'templates', 'aggregate', 'JpaEntity.java.ejs'),
          path.join(moduleBasePath, 'infrastructure', 'database', 'entities', `${entity.name}Jpa.java`),
          entityJpaContext
        );
        generatedFiles.push({ type: 'JPA Entity', name: `${entity.name}Jpa`, path: `${moduleName}/infrastructure/database/entities/${entity.name}Jpa.java` });
      }

      // 4. Generate Value Objects (Domain + JPA)
      for (const vo of valueObjects) {
        // Domain Value Object
        const voDomainContext = {
          packageName,
          moduleName,
          name: vo.name,
          fields: vo.fields,
          methods: vo.methods,
          imports: vo.imports
        };

        await renderAndWrite(
          path.join(__dirname, '..', '..', 'templates', 'aggregate', 'DomainValueObject.java.ejs'),
          path.join(moduleBasePath, 'domain', 'models', 'valueObjects', `${vo.name}.java`),
          voDomainContext
        );
        generatedFiles.push({ type: 'Domain VO', name: vo.name, path: `${moduleName}/domain/models/valueObjects/${vo.name}.java` });

        // JPA Value Object
        const voJpaContext = {
          packageName,
          moduleName,
          name: vo.name,
          fields: vo.fields,
          imports: vo.imports
        };

        await renderAndWrite(
          path.join(__dirname, '..', '..', 'templates', 'aggregate', 'JpaValueObject.java.ejs'),
          path.join(moduleBasePath, 'infrastructure', 'database', 'valueObjects', `${vo.name}Jpa.java`),
          voJpaContext
        );
        generatedFiles.push({ type: 'JPA VO', name: `${vo.name}Jpa`, path: `${moduleName}/infrastructure/database/valueObjects/${vo.name}Jpa.java` });
      }

      // 5. Generate Mapper
      const mapperContext = {
        packageName,
        moduleName,
        aggregateName,
        rootEntity,
        secondaryEntities,
        valueObjects
      };

      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'AggregateMapper.java.ejs'),
        path.join(moduleBasePath, 'infrastructure', 'database', 'mappers', `${aggregateName}Mapper.java`),
        mapperContext
      );
      generatedFiles.push({ type: 'Mapper', name: `${aggregateName}Mapper`, path: `${moduleName}/infrastructure/database/mappers/${aggregateName}Mapper.java` });

      // 6. Generate Repository Interface
      const repoContext = {
        packageName,
        moduleName,
        rootEntity
      };

      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'AggregateRepository.java.ejs'),
        path.join(moduleBasePath, 'domain', 'repositories', `${rootEntity.name}Repository.java`),
        repoContext
      );
      generatedFiles.push({ type: 'Repository', name: `${rootEntity.name}Repository`, path: `${moduleName}/domain/repositories/${rootEntity.name}Repository.java` });

      // 7. Generate JPA Repository Interface
      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'JpaRepository.java.ejs'),
        path.join(moduleBasePath, 'infrastructure', 'database', 'repositories', `${rootEntity.name}JpaRepository.java`),
        repoContext
      );
      generatedFiles.push({ type: 'JPA Repository', name: `${rootEntity.name}JpaRepository`, path: `${moduleName}/infrastructure/database/repositories/${rootEntity.name}JpaRepository.java` });

      // 8. Generate Repository Implementation
      const repoImplContext = {
        packageName,
        moduleName,
        aggregateName,
        rootEntity
      };

      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'AggregateRepositoryImpl.java.ejs'),
        path.join(moduleBasePath, 'infrastructure', 'database', 'repositories', `${rootEntity.name}RepositoryImpl.java`),
        repoImplContext
      );
      generatedFiles.push({ type: 'Repository Impl', name: `${rootEntity.name}RepositoryImpl`, path: `${moduleName}/infrastructure/database/repositories/${rootEntity.name}RepositoryImpl.java` });
    }

    spinner.succeed(chalk.green(`Generated ${generatedFiles.length} files! ✨`));

    console.log(chalk.blue('\n📦 Generated files:'));
    const groupedFiles = generatedFiles.reduce((acc, file) => {
      if (!acc[file.type]) acc[file.type] = [];
      acc[file.type].push(file);
      return acc;
    }, {});

    Object.keys(groupedFiles).forEach(type => {
      console.log(chalk.gray(`\n  ${type}:`));
      groupedFiles[type].forEach(file => {
        console.log(chalk.gray(`    ├── ${file.name}`));
      });
    });

    console.log(chalk.blue('\n✅ All files generated successfully!'));
    console.log(chalk.white(`\n   Module: ${moduleName}`));
    console.log(chalk.white(`   Aggregates: ${aggregates.length}`));
    console.log(chalk.white(`   Total files: ${generatedFiles.length}`));
    console.log();

    // Ask user if they want to generate CRUD resources
    const { generateCrud } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'generateCrud',
        message: 'Do you want to generate CRUD resources for aggregate roots?',
        default: true
      }
    ]);

    if (generateCrud) {
      // Ask for API version
      const { apiVersion } = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiVersion',
          message: 'Enter API version for REST endpoints:',
          default: 'v1',
          validate: (input) => {
            if (!input || input.trim() === '') {
              return 'API version cannot be empty';
            }
            return true;
          }
        }
      ]);

      spinner.start('Generating CRUD resources...');

      // Generate CRUD for each aggregate root
      for (const aggregate of aggregates) {
        await generateCrudResources(
          aggregate,
          moduleName,
          moduleBasePath,
          packageName,
          apiVersion,
          generatedFiles
        );
      }

      spinner.succeed(chalk.green('CRUD resources generated! ✨'));
      
      console.log(chalk.blue('\n📄 Generated CRUD files:'));
      const crudFiles = generatedFiles.filter(f => 
        f.type.includes('Command') || 
        f.type.includes('Query') || 
        f.type.includes('Handler') || 
        f.type.includes('DTO') || 
        f.type.includes('Controller') ||
        f.type.includes('Mapper')
      );
      
      const groupedCrudFiles = crudFiles.reduce((acc, file) => {
        if (!acc[file.type]) acc[file.type] = [];
        acc[file.type].push(file);
        return acc;
      }, {});

      Object.keys(groupedCrudFiles).forEach(type => {
        console.log(chalk.gray(`\n  ${type}:`));
        groupedCrudFiles[type].forEach(file => {
          console.log(chalk.gray(`    ├── ${file.name}`));
        });
      });

      console.log(chalk.blue(`\n✅ Total CRUD files: ${crudFiles.length}`));
    }

    console.log();

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate entities'));
    console.error(chalk.red('\n❌ Error:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

/**
 * Generate CRUD resources for an aggregate root
 */
async function generateCrudResources(aggregate, moduleName, moduleBasePath, packageName, apiVersion, generatedFiles) {
  const { name: aggregateName, rootEntity, secondaryEntities } = aggregate;
  const templatesDir = path.join(__dirname, '..', '..', 'templates', 'crud');
  
  // Get ID field and type
  const idField = rootEntity.fields[0];
  const idType = idField.javaType;
  
  // Filter command fields (exclude id, createdAt, updatedAt)
  const commandFields = rootEntity.fields.filter(f => 
    f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt'
  );
  
  // Check if has OneToMany relationships (items)
  const oneToManyRels = rootEntity.relationships.filter(r => r.type === 'OneToMany' && !r.isInverse);
  const hasItems = oneToManyRels.length > 0;
  const itemEntityName = hasItems ? oneToManyRels[0].target : null;
  const itemEntity = hasItems ? secondaryEntities.find(e => e.name === itemEntityName) : null;
  const itemFields = itemEntity ? itemEntity.fields.filter(f => 
    f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt'
  ) : [];
  
  // Detect if has value objects or enums
  const hasValueObjects = rootEntity.fields.some(f => f.isValueObject);
  const hasEnums = rootEntity.enums && rootEntity.enums.length > 0;
  
  // Resource naming
  const resourceNameCamel = toCamelCase(aggregateName);
  const resourceNameKebab = toKebabCase(aggregateName);
  
  // Base context for all templates
  const baseContext = {
    packageName,
    moduleName,
    aggregateName,
    rootEntity,
    secondaryEntities,
    idType,
    commandFields,
    hasItems,
    itemEntityName,
    itemFields,
    hasValueObjects,
    hasEnums,
    imports: rootEntity.imports,
    apiVersion,
    resourceNameCamel,
    resourceNameKebab
  };
  
  // 1. Generate ResponseMapper
  await renderAndWrite(
    path.join(templatesDir, 'ResponseMapper.java.ejs'),
    path.join(moduleBasePath, 'application', 'mappers', `${aggregateName}ResponseMapper.java`),
    baseContext
  );
  generatedFiles.push({ type: 'Application Mapper', name: `${aggregateName}ResponseMapper`, path: `${moduleName}/application/mappers/${aggregateName}ResponseMapper.java` });
  
  // 2. Generate Commands
  await renderAndWrite(
    path.join(templatesDir, 'CreateCommand.java.ejs'),
    path.join(moduleBasePath, 'application', 'commands', `Create${aggregateName}Command.java`),
    baseContext
  );
  generatedFiles.push({ type: 'Command', name: `Create${aggregateName}Command`, path: `${moduleName}/application/commands/Create${aggregateName}Command.java` });
  
  await renderAndWrite(
    path.join(templatesDir, 'DeleteCommand.java.ejs'),
    path.join(moduleBasePath, 'application', 'commands', `Delete${aggregateName}Command.java`),
    baseContext
  );
  generatedFiles.push({ type: 'Command', name: `Delete${aggregateName}Command`, path: `${moduleName}/application/commands/Delete${aggregateName}Command.java` });
  
  // 3. Generate Queries
  await renderAndWrite(
    path.join(templatesDir, 'GetQuery.java.ejs'),
    path.join(moduleBasePath, 'application', 'queries', `Get${aggregateName}Query.java`),
    baseContext
  );
  generatedFiles.push({ type: 'Query', name: `Get${aggregateName}Query`, path: `${moduleName}/application/queries/Get${aggregateName}Query.java` });
  
  await renderAndWrite(
    path.join(templatesDir, 'ListQuery.java.ejs'),
    path.join(moduleBasePath, 'application', 'queries', `FindAll${aggregateName}sQuery.java`),
    baseContext
  );
  generatedFiles.push({ type: 'Query', name: `FindAll${aggregateName}sQuery`, path: `${moduleName}/application/queries/FindAll${aggregateName}sQuery.java` });
  
  // 4. Generate Handlers
  await renderAndWrite(
    path.join(templatesDir, 'CreateCommandHandler.java.ejs'),
    path.join(moduleBasePath, 'application', 'usecases', `Create${aggregateName}CommandHandler.java`),
    baseContext
  );
  generatedFiles.push({ type: 'Handler', name: `Create${aggregateName}CommandHandler`, path: `${moduleName}/application/usecases/Create${aggregateName}CommandHandler.java` });
  
  await renderAndWrite(
    path.join(templatesDir, 'GetQueryHandler.java.ejs'),
    path.join(moduleBasePath, 'application', 'usecases', `Get${aggregateName}QueryHandler.java`),
    baseContext
  );
  generatedFiles.push({ type: 'Handler', name: `Get${aggregateName}QueryHandler`, path: `${moduleName}/application/usecases/Get${aggregateName}QueryHandler.java` });
  
  await renderAndWrite(
    path.join(templatesDir, 'ListQueryHandler.java.ejs'),
    path.join(moduleBasePath, 'application', 'usecases', `FindAll${aggregateName}sQueryHandler.java`),
    baseContext
  );
  generatedFiles.push({ type: 'Handler', name: `FindAll${aggregateName}sQueryHandler`, path: `${moduleName}/application/usecases/FindAll${aggregateName}sQueryHandler.java` });
  
  await renderAndWrite(
    path.join(templatesDir, 'DeleteCommandHandler.java.ejs'),
    path.join(moduleBasePath, 'application', 'usecases', `Delete${aggregateName}CommandHandler.java`),
    baseContext
  );
  generatedFiles.push({ type: 'Handler', name: `Delete${aggregateName}CommandHandler`, path: `${moduleName}/application/usecases/Delete${aggregateName}CommandHandler.java` });
  
  // 5. Generate DTOs
  const responseDtoContext = {
    ...baseContext,
    allFields: rootEntity.fields,
    relationships: oneToManyRels
  };
  
  await renderAndWrite(
    path.join(templatesDir, 'ResponseDto.java.ejs'),
    path.join(moduleBasePath, 'application', 'dtos', `${aggregateName}ResponseDto.java`),
    responseDtoContext
  );
  generatedFiles.push({ type: 'DTO', name: `${aggregateName}ResponseDto`, path: `${moduleName}/application/dtos/${aggregateName}ResponseDto.java` });
  
  // Generate secondary entity DTOs
  for (const entity of secondaryEntities) {
    const entityDtoContext = {
      packageName,
      moduleName,
      entityName: entity.name,
      fields: entity.fields,
      hasValueObjects: entity.fields.some(f => f.isValueObject),
      hasEnums: entity.enums && entity.enums.length > 0,
      imports: entity.imports
    };
    
    await renderAndWrite(
      path.join(templatesDir, 'SecondaryEntityDto.java.ejs'),
      path.join(moduleBasePath, 'application', 'dtos', `${entity.name}Dto.java`),
      entityDtoContext
    );
    generatedFiles.push({ type: 'DTO', name: `${entity.name}Dto`, path: `${moduleName}/application/dtos/${entity.name}Dto.java` });
  }
  
  // Generate CreateItemDto for ALL secondary entities (not just first OneToMany)
  console.log(`[DEBUG] Generating Create DTOs for ${secondaryEntities.length} secondary entities`);
  for (const entity of secondaryEntities) {
    console.log(`[DEBUG] Generating CreateItemDto for entity: ${entity.name}`);
    const createFields = entity.fields.filter(f => 
      f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt'
    );
    
    const createItemDtoContext = {
      packageName,
      moduleName,
      entityName: entity.name,
      fields: createFields,
      hasValueObjects: entity.fields.some(f => f.isValueObject),
      hasEnums: entity.enums && entity.enums.length > 0,
      imports: entity.imports
    };
    
    await renderAndWrite(
      path.join(templatesDir, 'CreateItemDto.java.ejs'),
      path.join(moduleBasePath, 'application', 'dtos', `Create${entity.name}Dto.java`),
      createItemDtoContext
    );
    generatedFiles.push({ type: 'DTO', name: `Create${entity.name}Dto`, path: `${moduleName}/application/dtos/Create${entity.name}Dto.java` });
  }
  
  // 6. Generate Controller
  await renderAndWrite(
    path.join(templatesDir, 'Controller.java.ejs'),
    path.join(moduleBasePath, 'infrastructure', 'rest', 'controllers', resourceNameCamel, apiVersion, `${aggregateName}Controller.java`),
    baseContext
  );
  generatedFiles.push({ type: 'Controller', name: `${aggregateName}Controller`, path: `${moduleName}/infrastructure/rest/controllers/${resourceNameCamel}/${apiVersion}/${aggregateName}Controller.java` });
}

module.exports = generateEntitiesCommand;
