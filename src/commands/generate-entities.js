const ora = require('ora');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const inquirer = require('inquirer');
const ConfigManager = require('../utils/config-manager');
const { isEva4jProject } = require('../utils/validator');
const { toPackagePath, toCamelCase, toKebabCase, toPascalCase, getApplicationClassName } = require('../utils/naming');
const { renderAndWrite } = require('../utils/template-engine');
const { parseDomainYaml, generateEntityImports, generateValidationImports } = require('../utils/yaml-to-entity');
const { createOrUpdateUrlsConfig, ensureUrlsImport } = require('./generate-http-exchange');
const SharedGenerator = require('../generators/shared-generator');
const ChecksumManager = require('../utils/checksum-manager');
const { getInstalledBroker, generateSingleKafkaEvent, buildKafkaEventContext, updateKafkaYml } = require('./generate-kafka-event');

// Maximum depth for recursive relationship traversal
const MAX_DEPTH = 5;

/**
 * Build a relationship graph for secondary entities
 * @param {Array} secondaryEntities - Array of secondary entities
 * @returns {Map} Map of entity name to its relationships info
 */
function buildRelationshipGraph(secondaryEntities) {
  const graph = new Map();
  
  secondaryEntities.forEach(entity => {
    const oneToManyRels = entity.relationships?.filter(r => 
      r.type === 'OneToMany' && !r.isInverse
    ) || [];
    
    graph.set(entity.name, {
      entity,
      children: oneToManyRels.map(r => r.target),
      relationships: oneToManyRels
    });
  });
  
  return graph;
}

/**
 * Enrich relationships recursively with nested relationship information
 * @param {Object} entity - The entity to enrich
 * @param {Array} secondaryEntities - All secondary entities
 * @param {number} depth - Current depth level
 * @param {Set} visited - Set of visited entity names to prevent cycles
 * @returns {Array} Enriched relationships with nested data
 */
function enrichRelationshipsRecursively(entity, secondaryEntities, depth = 0, visited = new Set()) {
  // Stop if max depth reached or entity already visited (cycle detection)
  if (depth >= MAX_DEPTH || visited.has(entity.name)) {
    if (depth >= MAX_DEPTH) {
      console.log(`[WARNING] Max depth ${MAX_DEPTH} reached for entity: ${entity.name}`);
    }
    if (visited.has(entity.name)) {
      console.log(`[WARNING] Cycle detected at entity: ${entity.name}, stopping recursion`);
    }
    return [];
  }
  
  // Mark entity as visited
  const newVisited = new Set(visited);
  newVisited.add(entity.name);
  
  const oneToManyRels = entity.relationships?.filter(r => 
    r.type === 'OneToMany' && !r.isInverse
  ) || [];
  
  return oneToManyRels.map(rel => {
    const targetEntity = secondaryEntities.find(e => e.name === rel.target);
    
    if (!targetEntity) {
      return {
        ...rel,
        depth,
        hasNestedRelationships: false,
        nestedRelationships: [],
        fields: []
      };
    }
    
    const targetFields = targetEntity.fields.filter(f => 
      f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' && f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.readOnly
    );
    
    // Recursively enrich nested OneToMany relationships
    const nestedRels = enrichRelationshipsRecursively(
      targetEntity, 
      secondaryEntities, 
      depth + 1, 
      newVisited
    );

    // Collect forward OneToOne relationships of this target entity (non-inverse)
    const oneToOneRelsOfTarget = (targetEntity.relationships || []).filter(r =>
      r.type === 'OneToOne' && !r.isInverse
    );
    const nestedOneToOneRelationships = oneToOneRelsOfTarget.map(otoRel => {
      const otoTarget = secondaryEntities.find(e => e.name === otoRel.target);
      const otoFields = otoTarget ? otoTarget.fields.filter(f =>
        f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' && f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.readOnly
      ) : [];
      return {
        targetEntityName: otoRel.target,
        fieldName: otoRel.fieldName,
        type: 'OneToOne',
        fields: otoFields,
        entity: otoTarget
      };
    });
    
    return {
      targetEntityName: rel.target,
      fieldName: rel.fieldName,
      type: rel.type,
      depth,
      fields: targetFields,
      entity: targetEntity,
      hasNestedRelationships: nestedRels.length > 0,
      nestedRelationships: nestedRels,
      nestedOneToOneRelationships
    };
  });
}

async function generateEntitiesCommand(moduleName, options = {}) {
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

  // Initialise checksum manager (safe mode by default — --force to overwrite)
  const checksumManager = new ChecksumManager(moduleBasePath);
  await checksumManager.load();
  const writeOptions = { force: options.force || false, checksumManager };

  const spinner = ora('Parsing domain.yaml...').start();

  try {
    // Parse domain.yaml
    const { aggregates, allEnums, endpoints, listeners, ports } = await parseDomainYaml(domainYamlPath, packageName, moduleName);
    
    spinner.succeed(chalk.green(`Found ${aggregates.length} aggregate(s) and ${allEnums.length} enum(s)`));
    
    // Check if any entity has auditable: true or audit.enabled
    const hasAuditableEntities = aggregates.some(agg => 
      agg.rootEntity.auditable || 
      (agg.rootEntity.audit && agg.rootEntity.audit.enabled) ||
      agg.secondaryEntities.some(e => e.auditable || (e.audit && e.audit.enabled))
    );
    
    // Check if any entity has trackUser enabled
    const hasTrackUserEntities = aggregates.some(agg =>
      (agg.rootEntity.audit && agg.rootEntity.audit.trackUser) ||
      agg.secondaryEntities.some(e => e.audit && e.audit.trackUser)
    );
    
    // Always generate PagedResponse shared DTO (used by all ListQueryHandlers)
    const sharedBasePath = path.join(projectDir, 'src', 'main', 'java', packagePath, 'shared');
    const sharedGenerator = new SharedGenerator({ packageName, packagePath });
    await sharedGenerator.generatePagedResponse(sharedBasePath);

    // Check if any aggregate declares domain events and generate shared DomainEvent base class
    const hasDomainEventsInModule = aggregates.some(agg => agg.domainEvents && agg.domainEvents.length > 0);
    if (hasDomainEventsInModule) {
      await sharedGenerator.generateDomainEvent(sharedBasePath);
    }

    // Detect installed message broker for auto-wiring integration events
    const broker = (hasDomainEventsInModule || (listeners && listeners.length > 0))
      ? await getInstalledBroker(configManager)
      : null;

    // Generate audit-related shared components if needed
    if (hasAuditableEntities || hasTrackUserEntities) {
      
      // Always generate base AuditableEntity if any audit is enabled
      if (hasAuditableEntities) {
        await sharedGenerator.generateAuditableEntity(sharedBasePath);
      }
      
      // Generate FullAuditableEntity and audit infrastructure if trackUser is enabled
      if (hasTrackUserEntities) {
        await sharedGenerator.generateFullAuditableEntity(sharedBasePath);
        await sharedGenerator.generateAuditComponents(sharedBasePath);
        await sharedGenerator.generateFilters(sharedBasePath, true); // Include UserContextFilter
      } else if (hasAuditableEntities) {
        // Just timestamp audit, no user context filter needed
        await sharedGenerator.generateFilters(sharedBasePath, false);
      }
    }

    // Regenerate Application.java to sync auditorAwareRef with current domain.yaml
    const applicationClassName = getApplicationClassName(artifactId);
    const applicationJavaPath = path.join(
      projectDir, 'src', 'main', 'java', packagePath,
      `${applicationClassName}.java`
    );
    const applicationTemplatePath = path.join(__dirname, '../../templates/base/application/Application.java.ejs');
    await renderAndWrite(applicationTemplatePath, applicationJavaPath, {
      packageName,
      projectName: projectConfig.projectName || artifactId,
      author: projectConfig.author || 'eva4j',
      version: projectConfig.version || '1.0.0',
      createdDate: projectConfig.createdAt ? projectConfig.createdAt.split('T')[0] : new Date().toISOString().split('T')[0],
      applicationClassName,
      hasTrackUser: hasTrackUserEntities,
      features: {
        enableScheduling: projectConfig.features?.enableScheduling || false,
        enableAsync: projectConfig.features?.enableAsync || false
      }
    }, writeOptions);
    
    console.log(chalk.blue('\n📦 Aggregates to generate:'));
    aggregates.forEach(agg => {
      console.log(chalk.gray(`  ├── ${agg.name} (Root: ${agg.rootEntity.name})`));
      agg.secondaryEntities.forEach(entity => {
        console.log(chalk.gray(`  │   ├── ${entity.name}`));
      });
      agg.valueObjects.forEach(vo => {
        console.log(chalk.gray(`  │   └── ${vo.name} (VO)`));
      });
      if (agg.domainEvents && agg.domainEvents.length > 0) {
        agg.domainEvents.forEach(event => {
          console.log(chalk.gray(`  │   └── ${event.name} (Event${event.kafka ? ' · kafka' : ''})`))
        });
      }
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
        values: enumDef.values,
        transitions: enumDef.transitions || null,
        initialValue: enumDef.initialValue || null
      };

      const templatePath = path.join(__dirname, '..', '..', 'templates', 'aggregate', 'Enum.java.ejs');
      const outputPath = path.join(
        moduleBasePath,
        'domain', 'models', 'enums',
        `${enumDef.name}.java`
      );

      await renderAndWrite(templatePath, outputPath, context, writeOptions);
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
        auditable: rootEntity.auditable,
        domainEvents: aggregate.domainEvents || [],
        triggeredEventsMap: aggregate.triggeredEventsMap || {}
      };

      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'AggregateRoot.java.ejs'),
        path.join(moduleBasePath, 'domain', 'models', 'entities', `${rootEntity.name}.java`),
        rootDomainContext,
        writeOptions
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
        enums: allEnums,
        auditable: rootEntity.auditable,
        audit: rootEntity.audit
      };

      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'JpaAggregateRoot.java.ejs'),
        path.join(moduleBasePath, 'infrastructure', 'database', 'entities', `${rootEntity.name}Jpa.java`),
        rootJpaContext,
        writeOptions
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
          entityDomainContext,
          writeOptions
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
          enums: allEnums,
          auditable: entity.auditable,
          audit: entity.audit
        };

        await renderAndWrite(
          path.join(__dirname, '..', '..', 'templates', 'aggregate', 'JpaEntity.java.ejs'),
          path.join(moduleBasePath, 'infrastructure', 'database', 'entities', `${entity.name}Jpa.java`),
          entityJpaContext,
          writeOptions
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
          voDomainContext,
          writeOptions
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
          voJpaContext,
          writeOptions
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
        mapperContext,
        writeOptions
      );
      generatedFiles.push({ type: 'Mapper', name: `${aggregateName}Mapper`, path: `${moduleName}/infrastructure/database/mappers/${aggregateName}Mapper.java` });

      // 6. Generate Repository Interface
      const repoContext = {
        packageName,
        moduleName,
        rootEntity,
        findByOps: []
      };

      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'AggregateRepository.java.ejs'),
        path.join(moduleBasePath, 'domain', 'repositories', `${rootEntity.name}Repository.java`),
        repoContext,
        writeOptions
      );
      generatedFiles.push({ type: 'Repository', name: `${rootEntity.name}Repository`, path: `${moduleName}/domain/repositories/${rootEntity.name}Repository.java` });

      // 7. Generate JPA Repository Interface
      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'JpaRepository.java.ejs'),
        path.join(moduleBasePath, 'infrastructure', 'database', 'repositories', `${rootEntity.name}JpaRepository.java`),
        repoContext,
        writeOptions
      );
      generatedFiles.push({ type: 'JPA Repository', name: `${rootEntity.name}JpaRepository`, path: `${moduleName}/infrastructure/database/repositories/${rootEntity.name}JpaRepository.java` });

      // 8. Generate Repository Implementation
      const repoImplContext = {
        packageName,
        moduleName,
        aggregateName,
        rootEntity,
        hasDomainEvents: (aggregate.domainEvents || []).length > 0,
        findByOps: []
      };

      await renderAndWrite(
        path.join(__dirname, '..', '..', 'templates', 'aggregate', 'AggregateRepositoryImpl.java.ejs'),
        path.join(moduleBasePath, 'infrastructure', 'database', 'repositories', `${rootEntity.name}RepositoryImpl.java`),
        repoImplContext,
        writeOptions
      );
      generatedFiles.push({ type: 'Repository Impl', name: `${rootEntity.name}RepositoryImpl`, path: `${moduleName}/infrastructure/database/repositories/${rootEntity.name}RepositoryImpl.java` });

      // 9. Generate Domain Events (if declared in domain.yaml)
      const aggregateDomainEvents = aggregate.domainEvents || [];
      if (aggregateDomainEvents.length > 0) {

        for (const event of aggregateDomainEvents) {
          const eventContext = {
            packageName,
            moduleName,
            aggregateName,
            name: event.name,
            fields: event.fields,
            kafka: event.kafka
          };
          await renderAndWrite(
            path.join(__dirname, '..', '..', 'templates', 'aggregate', 'DomainEventRecord.java.ejs'),
            path.join(moduleBasePath, 'domain', 'models', 'events', `${event.name}.java`),
            eventContext,
            writeOptions
          );
          generatedFiles.push({ type: 'Domain Event', name: event.name, path: `${moduleName}/domain/models/events/${event.name}.java` });
        }

        // Generate the bridge handler
        const handlerContext = {
          packageName,
          moduleName,
          aggregateName,
          domainEvents: aggregateDomainEvents.map(e => ({
            ...e,
            integrationEventClassName: `${e.name}IntegrationEvent`
          })),
          broker
        };
        await renderAndWrite(
          path.join(__dirname, '..', '..', 'templates', 'aggregate', 'DomainEventHandler.java.ejs'),
          path.join(moduleBasePath, 'application', 'usecases', `${aggregateName}DomainEventHandler.java`),
          handlerContext,
          writeOptions
        );
        generatedFiles.push({ type: 'Domain Event Handler', name: `${aggregateName}DomainEventHandler`, path: `${moduleName}/application/usecases/${aggregateName}DomainEventHandler.java` });

        // ── Auto-wire broker integration events ────────────────────────────────
        // When a message broker is installed, generate the complete integration
        // event layer (XIntegrationEvent record, MessageBroker port method,
        // KafkaMessageBroker impl method, topic config, KafkaConfig bean) for
        // every domain event declared in this aggregate.
        if (broker === 'kafka') {
          const STANDARD_EVENT_TYPES = new Set([
            'String','Integer','Long','Double','Float','Boolean',
            'BigDecimal','LocalDate','LocalDateTime','LocalTime','Instant','UUID'
          ]);
          for (const event of aggregateDomainEvents) {
            const kafkaCtx = buildKafkaEventContext(packageName, moduleName, event);
            await generateSingleKafkaEvent(projectDir, packagePath, kafkaCtx);
            generatedFiles.push({
              type: 'Integration Event',
              name: kafkaCtx.eventClassName,
              path: `${moduleName}/application/events/${kafkaCtx.eventClassName}.java`
            });

            // Generate stub records for custom collection element types
            // e.g. List<OrderItemSnapshot> → generate OrderItemSnapshot.java
            const customElementTypes = [...new Set(
              (event.fields || [])
                .filter(f => f.isCollection && f.collectionElementType && !STANDARD_EVENT_TYPES.has(f.collectionElementType))
                .map(f => f.collectionElementType)
            )];
            for (const typeName of customElementTypes) {
              const stubPath = path.join(moduleBasePath, 'domain', 'models', 'events', `${typeName}.java`);
              await renderAndWrite(
                path.join(__dirname, '..', '..', 'templates', 'aggregate', 'DomainEventSnapshot.java.ejs'),
                stubPath,
                { packageName, moduleName, name: typeName, fields: [] },
                { ...writeOptions, overwrite: false }
              );
              generatedFiles.push({
                type: 'Event Snapshot Type',
                name: typeName,
                path: `${moduleName}/domain/models/events/${typeName}.java`
              });
            }
          }
          generatedFiles.push({
            type: 'Integration Event',
            name: `${toPascalCase(moduleName)}KafkaMessageBroker (updated)`,
            path: `${moduleName}/infrastructure/adapters/kafkaMessageBroker/${toPascalCase(moduleName)}KafkaMessageBroker.java`
          });
          generatedFiles.push({
            type: 'Integration Event',
            name: 'MessageBroker (updated)',
            path: `${moduleName}/application/ports/MessageBroker.java`
          });
        }
      }
    }

    spinner.succeed(chalk.green(`Generated ${generatedFiles.length} files! ✨`));

    // ── Generate listeners (integration events CONSUMED from external producers) ──
    if (listeners && listeners.length > 0) {
      if (broker === 'kafka') {
        spinner.start(`Generating ${listeners.length} Kafka listener(s)...`);
        for (const listener of listeners) {
          // Validate topic presence (mandatory for standalone modules)
          if (!listener.topic) {
            spinner.warn(chalk.yellow(`⚠ listener '${listener.event}': topic is required when there is no system.yaml. Skipping.`));
            continue;
          }

          // Strip any prefix before the last dot (e.g. "test-eva.ORDER_PLACED" → "ORDER_PLACED")
          const topicRaw = listener.topic;
          const topicSuffix = topicRaw.includes('.') ? topicRaw.slice(topicRaw.lastIndexOf('.') + 1) : topicRaw;
          const topicKey = topicSuffix.toLowerCase().replace(/_/g, '-');
          const listenerContext = {
            packageName,
            moduleName,
            ...listener,
            topicConstant: topicRaw,
            topicSpringProperty: `\${topics.${topicKey}}`,
            topicVariableName: toCamelCase(topicSuffix.toLowerCase())
          };

          // 0. Nested type records (auxiliary value objects for object-typed fields)
          for (const nt of (listener.nestedTypes || [])) {
            const ntPath = path.join(
              moduleBasePath, 'application', 'events',
              `${nt.name}.java`
            );
            await renderAndWrite(
              path.join(__dirname, '..', '..', 'templates', 'kafka-listener', 'ListenerNestedType.java.ejs'),
              ntPath,
              { packageName, moduleName, name: nt.name, fields: nt.fields },
              writeOptions
            );
            generatedFiles.push({
              type: 'Listener Nested Type',
              name: nt.name,
              path: `${moduleName}/application/events/${nt.name}.java`
            });
          }

          // 1. Integration Event record
          const integrationEventPath = path.join(
            moduleBasePath, 'application', 'events',
            `${listener.integrationEventClassName}.java`
          );
          await renderAndWrite(
            path.join(__dirname, '..', '..', 'templates', 'kafka-listener', 'ListenerIntegrationEvent.java.ejs'),
            integrationEventPath,
            listenerContext,
            writeOptions
          );
          generatedFiles.push({
            type: 'Listener Integration Event',
            name: listener.integrationEventClassName,
            path: `${moduleName}/application/events/${listener.integrationEventClassName}.java`
          });

          // 2. Kafka listener class
          const kafkaListenerPath = path.join(
            moduleBasePath, 'infrastructure', 'kafkaListener',
            `${listener.listenerClassName}.java`
          );
          await renderAndWrite(
            path.join(__dirname, '..', '..', 'templates', 'kafka-listener', 'ListenerClass.java.ejs'),
            kafkaListenerPath,
            listenerContext,
            writeOptions
          );
          generatedFiles.push({
            type: 'Kafka Listener',
            name: listener.listenerClassName,
            path: `${moduleName}/infrastructure/kafkaListener/${listener.listenerClassName}.java`
          });

          // 3. Register topic in kafka.yaml (all environments)
          await updateKafkaYml(projectDir, topicKey, listener.topic);

          // 4. Typed Command dispatched from the listener
          const commandPath = path.join(
            moduleBasePath, 'application', 'commands',
            `${listener.commandClassName}.java`
          );
          await renderAndWrite(
            path.join(__dirname, '..', '..', 'templates', 'kafka-listener', 'ListenerCommand.java.ejs'),
            commandPath,
            listenerContext,
            writeOptions
          );
          generatedFiles.push({
            type: 'Listener Command',
            name: listener.commandClassName,
            path: `${moduleName}/application/commands/${listener.commandClassName}.java`
          });

          // 5. Use case handler that processes the command
          const handlerPath = path.join(
            moduleBasePath, 'application', 'usecases',
            `${listener.useCase}CommandHandler.java`
          );
          await renderAndWrite(
            path.join(__dirname, '..', '..', 'templates', 'kafka-listener', 'ListenerCommandHandler.java.ejs'),
            handlerPath,
            listenerContext,
            writeOptions
          );
          generatedFiles.push({
            type: 'Handler',
            name: `${listener.useCase}CommandHandler`,
            path: `${moduleName}/application/usecases/${listener.useCase}CommandHandler.java`
          });
        }
        spinner.succeed(chalk.green(`Kafka listeners generated! ✨`));
      } else if (listeners.length > 0) {
        console.log(chalk.yellow(`⚠ listeners: section found but no broker is installed. Run 'eva add kafka-client' to generate listener classes.`));
      }
    }

    // ── Generate ports (HTTP clients for synchronous communication) ──────────
    if (ports && ports.length > 0) {
      spinner.start(`Generating ${ports.length} HTTP port(s)...`);

      for (const portGroup of ports) {
        const {
          serviceName,
          serviceNameCamelCase,
          target,
          baseUrl,
          baseUrlProperty,
          feignClientName,
          feignClientClassName,
          feignAdapterClassName,
          feignConfigClassName,
          adapterPackage,
          methods,
          nestedTypes,
          domainModels
        } = portGroup;

        const adapterDir = path.join(moduleBasePath, 'infrastructure', 'adapters', adapterPackage);

        const portContext = {
          packageName,
          moduleName,
          serviceName,
          serviceNameCamelCase,
          target,
          baseUrl,
          baseUrlProperty,
          feignClientName,
          feignClientClassName,
          feignAdapterClassName,
          feignConfigClassName,
          adapterPackage,
          methods,
          nestedTypes,
          domainModels
        };

        // 0. Nested type records (shared across methods in the same service)
        for (const nt of nestedTypes) {
          const ntPath = path.join(
            moduleBasePath, 'application', 'dtos', `${nt.name}.java`
          );
          await renderAndWrite(
            path.join(__dirname, '..', '..', 'templates', 'ports', 'PortNestedType.java.ejs'),
            ntPath,
            { packageName, moduleName, name: nt.name, fields: nt.fields },
            writeOptions
          );
          generatedFiles.push({
            type: 'Port DTO',
            name: nt.name,
            path: `${moduleName}/application/dtos/${nt.name}.java`
          });
        }

        // 1a. Domain models in domain/models/{adapterPackage}/ (ACL: domain-side abstraction)
        for (const dm of (domainModels || [])) {
          const dmPath = path.join(moduleBasePath, 'domain', 'models', adapterPackage, `${dm.name}.java`);
          await renderAndWrite(
            path.join(__dirname, '..', '..', 'templates', 'ports', 'PortDomainModel.java.ejs'),
            dmPath,
            { packageName, moduleName, name: dm.name, fields: dm.fields, target, serviceName, adapterPackage },
            writeOptions
          );
          generatedFiles.push({
            type: 'Port Domain Model',
            name: dm.name,
            path: `${moduleName}/domain/models/${adapterPackage}/${dm.name}.java`
          });
        }

        // 1b. Infra DTOs (one per method that has fields:) — live in infrastructure/adapters/{service}/
        for (const method of methods.filter(m => m.hasResponse)) {
          const infraDtoPath = path.join(adapterDir, `${method.infraDtoName}.java`);
          await renderAndWrite(
            path.join(__dirname, '..', '..', 'templates', 'ports', 'PortResponseDto.java.ejs'),
            infraDtoPath,
            { packageName, moduleName, dtoName: method.infraDtoName, fields: method.fields, adapterPackage },
            writeOptions
          );
          generatedFiles.push({
            type: 'Port Infra DTO',
            name: method.infraDtoName,
            path: `${moduleName}/infrastructure/adapters/${adapterPackage}/${method.infraDtoName}.java`
          });
        }

        // 2. Request DTOs (one per method that has body:)
        for (const method of methods.filter(m => m.hasBody)) {
          const reqPath = path.join(
            moduleBasePath, 'application', 'dtos', `${method.requestDtoName}.java`
          );
          await renderAndWrite(
            path.join(__dirname, '..', '..', 'templates', 'ports', 'PortRequestDto.java.ejs'),
            reqPath,
            { packageName, moduleName, dtoName: method.requestDtoName, bodyFields: method.bodyFields, nestedTypes: method.nestedTypes },
            writeOptions
          );
          generatedFiles.push({
            type: 'Port DTO',
            name: method.requestDtoName,
            path: `${moduleName}/application/dtos/${method.requestDtoName}.java`
          });
        }

        // 3. Port interface (domain/repositories/)
        await renderAndWrite(
          path.join(__dirname, '..', '..', 'templates', 'ports', 'PortInterface.java.ejs'),
          path.join(moduleBasePath, 'domain', 'repositories', `${serviceName}.java`),
          portContext,
          writeOptions
        );
        generatedFiles.push({
          type: 'HTTP Port',
          name: serviceName,
          path: `${moduleName}/domain/repositories/${serviceName}.java`
        });

        // 4. Feign Client interface
        await renderAndWrite(
          path.join(__dirname, '..', '..', 'templates', 'ports', 'PortFeignClient.java.ejs'),
          path.join(adapterDir, `${feignClientClassName}.java`),
          portContext,
          writeOptions
        );
        generatedFiles.push({
          type: 'HTTP Port',
          name: feignClientClassName,
          path: `${moduleName}/infrastructure/adapters/${adapterPackage}/${feignClientClassName}.java`
        });

        // 5. Feign Adapter (@Component implementation)
        await renderAndWrite(
          path.join(__dirname, '..', '..', 'templates', 'ports', 'PortFeignAdapter.java.ejs'),
          path.join(adapterDir, `${feignAdapterClassName}.java`),
          portContext,
          writeOptions
        );
        generatedFiles.push({
          type: 'HTTP Port',
          name: feignAdapterClassName,
          path: `${moduleName}/infrastructure/adapters/${adapterPackage}/${feignAdapterClassName}.java`
        });

        // 6. Feign Config
        await renderAndWrite(
          path.join(__dirname, '..', '..', 'templates', 'ports', 'PortFeignConfig.java.ejs'),
          path.join(adapterDir, `${feignConfigClassName}.java`),
          portContext,
          writeOptions
        );
        generatedFiles.push({
          type: 'HTTP Port',
          name: feignConfigClassName,
          path: `${moduleName}/infrastructure/adapters/${adapterPackage}/${feignConfigClassName}.java`
        });

        // 7. Register base URL in parameters/*/urls.yaml
        await createOrUpdateUrlsConfig(projectDir, baseUrlProperty, baseUrl);
      }

      // Ensure urls.yaml is imported in all application-*.yaml files
      await ensureUrlsImport(projectDir);

      spinner.succeed(chalk.green(`HTTP ports generated! ✨`));
    }

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

    // Persist checksums to disk before asking about CRUD
    await checksumManager.save();

    if (endpoints) {
      // ── endpoints: section declared → skip CRUD prompt, auto-generate ──
      spinner.start('Generating endpoint-driven resources...');

      for (const aggregate of aggregates) {
        await generateEndpointsResources(
          aggregate,
          endpoints,
          moduleName,
          moduleBasePath,
          packageName,
          generatedFiles,
          writeOptions
        );
      }

      spinner.succeed(chalk.green('Endpoint-driven resources generated! ✨'));

      const epFiles = generatedFiles.filter(f =>
        f.type.includes('Command') || f.type.includes('Query') ||
        f.type.includes('Handler') || f.type.includes('DTO') ||
        f.type.includes('Controller') || f.type.includes('Mapper')
      );
      console.log(chalk.blue('\n📄 Generated endpoint files:'));
      const groupedEp = epFiles.reduce((acc, file) => {
        if (!acc[file.type]) acc[file.type] = [];
        acc[file.type].push(file);
        return acc;
      }, {});
      Object.keys(groupedEp).forEach(type => {
        console.log(chalk.gray(`\n  ${type}:`));
        groupedEp[type].forEach(file => {
          console.log(chalk.gray(`    ├── ${file.name}`));
        });
      });

      // Collect versions for summary
      const versionList = endpoints.versions.map(v => v.version).join(', ');
      const totalOps = endpoints.versions.reduce((sum, v) => sum + v.operations.length, 0);
      console.log(chalk.blue(`\n✅ Generated ${totalOps} endpoint(s) across version(s): ${versionList}`));

      await checksumManager.save();

    } else {
      // ── No endpoints section → original interactive CRUD flow ────────
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
      const postmanCollections = [];
      for (const aggregate of aggregates) {
        await generateCrudResources(
          aggregate,
          moduleName,
          moduleBasePath,
          packageName,
          apiVersion,
          generatedFiles,
          writeOptions
        );
        
        // Generate Postman Collection for this aggregate
        const collectionPath = await generatePostmanCollection(
          aggregate,
          moduleName,
          moduleBasePath,
          projectDir,
          packageName,
          apiVersion,
          projectConfig,
          allEnums,
          writeOptions
        );
        postmanCollections.push({
          name: aggregate.name,
          path: path.relative(projectDir, collectionPath)
        });
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
      
      // Display generated Postman collections
      if (postmanCollections.length > 0) {
        console.log(chalk.blue('\n📬 Generated Postman Collections:'));
        postmanCollections.forEach(collection => {
          console.log(chalk.gray(`   • ${collection.name}: ${collection.path}`));
        });
        console.log(chalk.cyan('\n💡 Import these collections into Postman to test your API endpoints!'));
      }

      // Save updated checksums after CRUD generation
      await checksumManager.save();
    }

    } // end else (no endpoints section)

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
 * Replace domain VO types with Create<Vo>Dto for validated VOs.
 * Adds originalVoType marker and prepends @Valid.
 */
function transformFieldsForApp(fields, validatedVoNames) {
  return fields.map(f => {
    if (f.isValueObject && validatedVoNames.has(f.javaType)) {
      return {
        ...f,
        originalVoType: f.javaType,
        javaType: `Create${f.javaType}Dto`,
        validationAnnotations: ['@Valid', ...(f.validationAnnotations || [])]
      };
    }
    return f;
  });
}

/**
 * Recursively transform rel.fields for app-layer contexts.
 */
function transformRelsForApp(rels, validatedVoNames) {
  return (rels || []).map(rel => ({
    ...rel,
    fields: transformFieldsForApp(rel.fields || [], validatedVoNames),
    nestedRelationships: transformRelsForApp(rel.nestedRelationships, validatedVoNames),
    nestedOneToOneRelationships: (rel.nestedOneToOneRelationships || []).map(otoRel => ({
      ...otoRel,
      fields: transformFieldsForApp(otoRel.fields || [], validatedVoNames)
    }))
  }));
}

/**
 * Classify an endpoint operation into a semantic category.
 * Returns { category, ...metadata } where category is one of:
 *   'standard'        → matches the 5 CRUD patterns exactly
 *   'transition'      → matches {MethodPascal}{Aggregate} for an enum transition
 *   'subEntityAdd'    → matches Add{EntityName} for a OneToMany secondary entity
 *   'subEntityRemove' → matches Remove{EntityName} for a OneToMany secondary entity
 *   'findBy'          → matches FindAll{Aggregate}sBy{FieldPascal} for a root field
 *   'scaffold'        → no semantic pattern matched
 */
function classifyUseCase(op, aggregateName, aggregate) {
  // 1. Standard CRUD
  const standardMap = {
    [`Create${aggregateName}`]: 'create',
    [`Update${aggregateName}`]: 'update',
    [`Delete${aggregateName}`]: 'delete',
    [`Get${aggregateName}`]: 'getById',
    [`FindAll${aggregateName}s`]: 'findAll'
  };
  if (standardMap[op.useCase]) {
    return { category: 'standard', variant: standardMap[op.useCase] };
  }

  const rootEntity = aggregate.rootEntity;
  const enums = aggregate.enums || [];

  // 2. Enum transitions — pattern: {MethodPascal}{Aggregate}
  for (const enumDef of enums) {
    for (const transition of (enumDef.transitions || [])) {
      const methodPascal = toPascalCase(transition.method);
      if (op.useCase === `${methodPascal}${aggregateName}`) {
        return {
          category: 'transition',
          domainMethod: transition.method,
          enumName: enumDef.name,
          targetStatus: Array.isArray(transition.to) ? transition.to[0] : transition.to
        };
      }
    }
  }

  // 3. Sub-entity operations — pattern: Add{Entity} / Remove{Entity} (OneToMany only)
  const oneToManyRels = (rootEntity.relationships || []).filter(r =>
    r.type === 'OneToMany' && !r.isInverse
  );
  for (const rel of oneToManyRels) {
    if (op.useCase === `Add${rel.target}`) {
      const targetEntity = (aggregate.secondaryEntities || []).find(e => e.name === rel.target);
      const entityFields = targetEntity
        ? targetEntity.fields.filter(f =>
            f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' &&
            f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.readOnly
          )
        : [];
      return {
        category: 'subEntityAdd',
        entityName: rel.target,
        fieldName: rel.fieldName,
        addMethodName: `add${rel.target}`,
        entityFields,
        entityImports: targetEntity ? (targetEntity.imports || []) : []
      };
    }
    if (op.useCase === `Remove${rel.target}`) {
      return {
        category: 'subEntityRemove',
        entityName: rel.target,
        fieldName: rel.fieldName,
        removeMethodName: `remove${rel.target}ById`
      };
    }
  }

  // 4. FindBy field — pattern: FindAll{Aggregate}sBy{FieldPascal}
  for (const field of (rootEntity.fields || [])) {
    const fieldPascal = toPascalCase(field.name);
    if (op.useCase === `FindAll${aggregateName}sBy${fieldPascal}`) {
      return {
        category: 'findBy',
        fieldName: field.name,
        fieldPascal,
        fieldJavaType: field.javaType,
        jpaMethodName: `findBy${fieldPascal}`
      };
    }
  }

  return { category: 'scaffold' };
}

/**
 * Enrich a single endpoint operation with derived properties for template rendering.
 * Expects op._classification to be set by classifyUseCase() before this call.
 */
function enrichEndpointOperation(op, aggregateName, idType) {
  const httpAnnotationMap = {
    GET: 'GetMapping', POST: 'PostMapping',
    PUT: 'PutMapping', PATCH: 'PatchMapping', DELETE: 'DeleteMapping'
  };
  const hasPathVar = Boolean(op.path && op.path.includes('{'));
  const pathVarMatch = hasPathVar ? op.path.match(/\{([^}]+)\}/) : null;
  const pathVarName = pathVarMatch ? pathVarMatch[1] : 'id';

  const cl = op._classification || { category: 'scaffold' };
  const isStandard = cl.category === 'standard';
  const standardType = isStandard ? cl.variant : null;

  // Infer type from HTTP method when not explicitly declared: GET → query, everything else → command
  const resolvedType = op.type || (op.method === 'GET' ? 'query' : 'command');

  let returnType = 'void';
  if (standardType === 'getById') returnType = `${aggregateName}ResponseDto`;
  else if (standardType === 'findAll') returnType = `PagedResponse<${aggregateName}ResponseDto>`;
  else if (cl.category === 'findBy') returnType = `PagedResponse<${aggregateName}ResponseDto>`;
  else if (cl.category === 'scaffold' && resolvedType === 'query') returnType = 'Object';

  let httpStatus = 'HttpStatus.OK';
  if (standardType === 'create') httpStatus = 'HttpStatus.CREATED';
  else if (standardType === 'update') httpStatus = 'HttpStatus.NO_CONTENT';
  else if (cl.category === 'transition') httpStatus = 'HttpStatus.NO_CONTENT';
  else if (cl.category === 'subEntityAdd') httpStatus = 'HttpStatus.CREATED';
  else if (cl.category === 'subEntityRemove') httpStatus = 'HttpStatus.NO_CONTENT';

  return {
    ...op,
    type: resolvedType,
    httpAnnotation: httpAnnotationMap[op.method] || 'PostMapping',
    methodName: toCamelCase(op.useCase),
    hasPathVar,
    pathVarName,
    isStandard,
    standardType,
    classifiedType: cl.category,
    classification: cl,
    returnType,
    httpStatus,
    idType
  };
}

/**
 * Generate endpoint-driven resources (use cases + versioned controllers)
 * for an aggregate when domain.yaml declares an `endpoints:` section.
 */
async function generateEndpointsResources(aggregate, endpoints, moduleName, moduleBasePath, packageName, generatedFiles, writeOptions = {}) {
  const { name: aggregateName, rootEntity, secondaryEntities, valueObjects = [] } = aggregate;
  const templatesDir = path.join(__dirname, '..', '..', 'templates', 'crud');

  const idField = rootEntity.fields[0];
  const idType = idField.javaType;

  const commandFields = rootEntity.fields.filter(f =>
    f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' &&
    f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.readOnly
  );

  const validatedVos = valueObjects.filter(vo =>
    vo.fields.some(f => f.validationAnnotations && f.validationAnnotations.length > 0)
  );
  const validatedVoNames = new Set(validatedVos.map(vo => vo.name));

  const oneToManyRelationships = enrichRelationshipsRecursively(rootEntity, secondaryEntities, 0, new Set());
  const oneToOneRels = rootEntity.relationships?.filter(r => r.type === 'OneToOne' && !r.isInverse) || [];
  const oneToOneRelationships = oneToOneRels.map(rel => {
    const targetEntity = secondaryEntities.find(e => e.name === rel.target);
    if (!targetEntity) return { targetEntityName: rel.target, fieldName: rel.fieldName, type: rel.type, fields: [] };
    const targetFields = targetEntity.fields.filter(f =>
      f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' &&
      f.name !== 'createdBy' && f.name !== 'updatedBy'
    );
    return { targetEntityName: rel.target, fieldName: rel.fieldName, type: rel.type, fields: targetFields, entity: targetEntity };
  });

  const hasValueObjects = rootEntity.fields.some(f => f.isValueObject);
  const hasEnums = rootEntity.enums && rootEntity.enums.length > 0;
  const resourceNameCamel = toCamelCase(aggregateName);
  const resourceNameKebab = toKebabCase(aggregateName);

  const responseFields = rootEntity.fields.filter(f =>
    f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.hidden
  );
  const responseSecondaryEntities = secondaryEntities.map(entity => ({
    ...entity,
    responseFields: entity.fields.filter(f => f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.hidden),
    nestedRelationships: enrichRelationshipsRecursively(entity, secondaryEntities, 0, new Set()),
    forwardOneToOneRels: (entity.relationships || [])
      .filter(r => r.type === 'OneToOne' && !r.isInverse)
      .map(r => ({ targetEntityName: r.target, fieldName: r.fieldName }))
  }));

  const commandFieldsApp = transformFieldsForApp(commandFields, validatedVoNames);
  const oneToOneRelationshipsApp = oneToOneRelationships.map(rel => ({
    ...rel,
    fields: transformFieldsForApp(rel.fields || [], validatedVoNames)
  }));
  const oneToManyRelationshipsApp = transformRelsForApp(oneToManyRelationships, validatedVoNames);

  const baseContext = {
    packageName, moduleName, aggregateName, rootEntity, secondaryEntities,
    responseFields, responseSecondaryEntities, idType,
    commandFields: commandFieldsApp, oneToManyRelationships, oneToOneRelationships,
    hasValueObjects, hasEnums, imports: rootEntity.imports,
    resourceNameCamel, resourceNameKebab
  };

  // ── Step 1: Validated VO Dtos ────────────────────────────────────────
  for (const vo of validatedVos) {
    const voDtoContext = {
      packageName, moduleName, voName: vo.name, fields: vo.fields,
      hasEnums: (vo.imports || []).some(i => i.includes('.enums.')),
      imports: [...(vo.imports || []), ...generateValidationImports(vo.fields)]
    };
    await renderAndWrite(
      path.join(templatesDir, 'CreateValueObjectDto.java.ejs'),
      path.join(moduleBasePath, 'application', 'dtos', `Create${vo.name}Dto.java`),
      voDtoContext, writeOptions
    );
    generatedFiles.push({ type: 'DTO', name: `Create${vo.name}Dto`, path: `${moduleName}/application/dtos/Create${vo.name}Dto.java` });
  }

  // ── Step 2: ApplicationMapper ────────────────────────────────────────
  // Only emit Create{Aggregate}Command import and fromCommand() when a
  // standard CreateOrder operation is declared — other POST use cases
  // (e.g. PlaceOrder) are scaffolds and never produce that command class.
  const hasCreateOperation = endpoints.versions.some(v =>
    v.operations.some(op => op.useCase === `Create${aggregateName}`)
  );
  await renderAndWrite(
    path.join(templatesDir, 'ApplicationMapper.java.ejs'),
    path.join(moduleBasePath, 'application', 'mappers', `${aggregateName}ApplicationMapper.java`),
    { ...baseContext, commandFields: commandFieldsApp, oneToOneRelationships: oneToOneRelationshipsApp, oneToManyRelationships: oneToManyRelationshipsApp, validatedVos, hasCreateOperation },
    writeOptions
  );
  generatedFiles.push({ type: 'Application Mapper', name: `${aggregateName}ApplicationMapper`, path: `${moduleName}/application/mappers/${aggregateName}ApplicationMapper.java` });

  // ── Step 3: ResponseDto ──────────────────────────────────────────────
  const responseDtoContext = {
    ...baseContext,
    allFields: rootEntity.fields.filter(f => f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.hidden),
    relationships: rootEntity.relationships.filter(r => (r.type === 'OneToMany' || r.type === 'OneToOne') && !r.isInverse)
  };
  await renderAndWrite(
    path.join(templatesDir, 'ResponseDto.java.ejs'),
    path.join(moduleBasePath, 'application', 'dtos', `${aggregateName}ResponseDto.java`),
    responseDtoContext, writeOptions
  );
  generatedFiles.push({ type: 'DTO', name: `${aggregateName}ResponseDto`, path: `${moduleName}/application/dtos/${aggregateName}ResponseDto.java` });

  // ── Step 4: Secondary entity DTOs ───────────────────────────────────
  for (const entity of secondaryEntities) {
    const nestedRelationships = enrichRelationshipsRecursively(entity, secondaryEntities, 0, new Set());
    const forwardOoO = (entity.relationships || []).filter(r => r.type === 'OneToOne' && !r.isInverse)
      .map(r => ({ targetEntityName: r.target, fieldName: r.fieldName }));

    await renderAndWrite(
      path.join(templatesDir, 'SecondaryEntityDto.java.ejs'),
      path.join(moduleBasePath, 'application', 'dtos', `${entity.name}Dto.java`),
      { packageName, moduleName, entityName: entity.name,
        fields: entity.fields.filter(f => f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.hidden),
        nestedRelationships, hasNestedRelationships: nestedRelationships.length > 0,
        forwardOneToOneRels: forwardOoO,
        hasValueObjects: entity.fields.some(f => f.isValueObject),
        hasEnums: entity.enums && entity.enums.length > 0, imports: entity.imports },
      writeOptions
    );
    generatedFiles.push({ type: 'DTO', name: `${entity.name}Dto`, path: `${moduleName}/application/dtos/${entity.name}Dto.java` });

    const createFields = entity.fields.filter(f =>
      f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' &&
      f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.readOnly
    );
    const entityNestedRels = enrichRelationshipsRecursively(entity, secondaryEntities, 0, new Set());
    const createFieldsApp = transformFieldsForApp(createFields, validatedVoNames);
    const dtoVoDtoImports = validatedVos.filter(vo => createFieldsApp.some(f => f.originalVoType === vo.name))
      .map(vo => `import ${packageName}.${moduleName}.application.dtos.Create${vo.name}Dto;`);
    const createDtoImports = [...new Set([
      ...(entity.imports || []), ...generateValidationImports(createFieldsApp), ...dtoVoDtoImports,
      ...(createFieldsApp.some(f => f.originalVoType) ? ['import jakarta.validation.Valid;'] : [])
    ])];
    const fwdOoO = (entity.relationships || []).filter(r => r.type === 'OneToOne' && !r.isInverse)
      .map(r => ({ targetEntityName: r.target, fieldName: r.fieldName }));

    await renderAndWrite(
      path.join(templatesDir, 'CreateItemDto.java.ejs'),
      path.join(moduleBasePath, 'application', 'dtos', `Create${entity.name}Dto.java`),
      { packageName, moduleName, entityName: entity.name, fields: createFieldsApp,
        nestedRelationships: entityNestedRels, hasNestedRelationships: entityNestedRels.length > 0,
        forwardOneToOneRels: fwdOoO,
        hasValueObjects: entity.fields.some(f => f.isValueObject),
        hasEnums: entity.enums && entity.enums.length > 0, imports: createDtoImports },
      writeOptions
    );
    generatedFiles.push({ type: 'DTO', name: `Create${entity.name}Dto`, path: `${moduleName}/application/dtos/Create${entity.name}Dto.java` });
  }

  // ── Step 5: Generate declared use cases (anti-duplicate across versions) ─
  const commandVoDtoImports = validatedVos
    .filter(vo => commandFieldsApp.some(f => f.originalVoType === vo.name))
    .map(vo => `import ${packageName}.${moduleName}.application.dtos.Create${vo.name}Dto;`);
  const commandAppImports = [...new Set([
    ...(rootEntity.imports || []), ...generateValidationImports(commandFieldsApp), ...commandVoDtoImports,
    ...(commandFieldsApp.some(f => f.originalVoType) ? ['import jakarta.validation.Valid;'] : [])
  ])];

  // Pre-classify ALL operations (including cross-version duplicates) so that
  // enrichEndpointOperation() can read op._classification in step 6.
  for (const version of endpoints.versions) {
    for (const op of version.operations) {
      op._classification = classifyUseCase(op, aggregateName, aggregate);
    }
  }

  const generatedUseCases = new Set();
  const findByOps = []; // collect FindBy ops for repository re-generation

  for (const version of endpoints.versions) {
    for (const op of version.operations) {
      if (generatedUseCases.has(op.useCase)) continue; // anti-duplicate
      generatedUseCases.add(op.useCase);

      const cl = op._classification;

      if (cl.category === 'standard') {
        const isStandard = true;
        if (cl.variant === 'create') {
          await renderAndWrite(
            path.join(templatesDir, 'CreateCommand.java.ejs'),
            path.join(moduleBasePath, 'application', 'commands', `Create${aggregateName}Command.java`),
            { ...baseContext, imports: commandAppImports }, writeOptions
          );
          generatedFiles.push({ type: 'Command', name: `Create${aggregateName}Command`, path: `${moduleName}/application/commands/Create${aggregateName}Command.java` });

          await renderAndWrite(
            path.join(templatesDir, 'CreateCommandHandler.java.ejs'),
            path.join(moduleBasePath, 'application', 'usecases', `Create${aggregateName}CommandHandler.java`),
            { ...baseContext, commandFields: commandFieldsApp, oneToOneRelationships: oneToOneRelationshipsApp, oneToManyRelationships: oneToManyRelationshipsApp, validatedVos }, writeOptions
          );
          generatedFiles.push({ type: 'Handler', name: `Create${aggregateName}CommandHandler`, path: `${moduleName}/application/usecases/Create${aggregateName}CommandHandler.java` });

        } else if (cl.variant === 'update') {
          await renderAndWrite(
            path.join(templatesDir, 'UpdateCommand.java.ejs'),
            path.join(moduleBasePath, 'application', 'commands', `Update${aggregateName}Command.java`),
            { ...baseContext, imports: commandAppImports }, writeOptions
          );
          generatedFiles.push({ type: 'Command', name: `Update${aggregateName}Command`, path: `${moduleName}/application/commands/Update${aggregateName}Command.java` });

          await renderAndWrite(
            path.join(templatesDir, 'UpdateCommandHandler.java.ejs'),
            path.join(moduleBasePath, 'application', 'usecases', `Update${aggregateName}CommandHandler.java`),
            baseContext, writeOptions
          );
          generatedFiles.push({ type: 'Handler', name: `Update${aggregateName}CommandHandler`, path: `${moduleName}/application/usecases/Update${aggregateName}CommandHandler.java` });

        } else if (cl.variant === 'delete') {
          await renderAndWrite(
            path.join(templatesDir, 'DeleteCommand.java.ejs'),
            path.join(moduleBasePath, 'application', 'commands', `Delete${aggregateName}Command.java`),
            baseContext, writeOptions
          );
          generatedFiles.push({ type: 'Command', name: `Delete${aggregateName}Command`, path: `${moduleName}/application/commands/Delete${aggregateName}Command.java` });

          await renderAndWrite(
            path.join(templatesDir, 'DeleteCommandHandler.java.ejs'),
            path.join(moduleBasePath, 'application', 'usecases', `Delete${aggregateName}CommandHandler.java`),
            baseContext, writeOptions
          );
          generatedFiles.push({ type: 'Handler', name: `Delete${aggregateName}CommandHandler`, path: `${moduleName}/application/usecases/Delete${aggregateName}CommandHandler.java` });

        } else if (cl.variant === 'getById') {
          await renderAndWrite(
            path.join(templatesDir, 'GetQuery.java.ejs'),
            path.join(moduleBasePath, 'application', 'queries', `Get${aggregateName}Query.java`),
            baseContext, writeOptions
          );
          generatedFiles.push({ type: 'Query', name: `Get${aggregateName}Query`, path: `${moduleName}/application/queries/Get${aggregateName}Query.java` });

          await renderAndWrite(
            path.join(templatesDir, 'GetQueryHandler.java.ejs'),
            path.join(moduleBasePath, 'application', 'usecases', `Get${aggregateName}QueryHandler.java`),
            baseContext, writeOptions
          );
          generatedFiles.push({ type: 'Handler', name: `Get${aggregateName}QueryHandler`, path: `${moduleName}/application/usecases/Get${aggregateName}QueryHandler.java` });

        } else if (cl.variant === 'findAll') {
          await renderAndWrite(
            path.join(templatesDir, 'ListQuery.java.ejs'),
            path.join(moduleBasePath, 'application', 'queries', `FindAll${aggregateName}sQuery.java`),
            baseContext, writeOptions
          );
          generatedFiles.push({ type: 'Query', name: `FindAll${aggregateName}sQuery`, path: `${moduleName}/application/queries/FindAll${aggregateName}sQuery.java` });

          await renderAndWrite(
            path.join(templatesDir, 'ListQueryHandler.java.ejs'),
            path.join(moduleBasePath, 'application', 'usecases', `FindAll${aggregateName}sQueryHandler.java`),
            baseContext, writeOptions
          );
          generatedFiles.push({ type: 'Handler', name: `FindAll${aggregateName}sQueryHandler`, path: `${moduleName}/application/usecases/FindAll${aggregateName}sQueryHandler.java` });
        }

      } else if (cl.category === 'transition') {
        // Transition: {MethodPascal}{Aggregate} → findById → entity.{method}() → save
        const transitionContext = {
          packageName, moduleName, aggregateName,
          useCaseName: op.useCase,
          idType,
          domainMethod: cl.domainMethod
        };
        await renderAndWrite(
          path.join(templatesDir, 'TransitionCommand.java.ejs'),
          path.join(moduleBasePath, 'application', 'commands', `${op.useCase}Command.java`),
          transitionContext, writeOptions
        );
        generatedFiles.push({ type: 'Command', name: `${op.useCase}Command`, path: `${moduleName}/application/commands/${op.useCase}Command.java` });

        await renderAndWrite(
          path.join(templatesDir, 'TransitionCommandHandler.java.ejs'),
          path.join(moduleBasePath, 'application', 'usecases', `${op.useCase}CommandHandler.java`),
          transitionContext, writeOptions
        );
        generatedFiles.push({ type: 'Handler', name: `${op.useCase}CommandHandler`, path: `${moduleName}/application/usecases/${op.useCase}CommandHandler.java` });

      } else if (cl.category === 'subEntityAdd') {
        // SubEntityAdd: Add{EntityName} → findById → entity.add{Entity}(...) → save
        const addContext = {
          packageName, moduleName, aggregateName,
          useCaseName: op.useCase,
          idType,
          entityName: cl.entityName,
          entityFields: cl.entityFields,
          addMethodName: cl.addMethodName,
          imports: cl.entityImports
        };
        await renderAndWrite(
          path.join(templatesDir, 'SubEntityAddCommand.java.ejs'),
          path.join(moduleBasePath, 'application', 'commands', `${op.useCase}Command.java`),
          addContext, writeOptions
        );
        generatedFiles.push({ type: 'Command', name: `${op.useCase}Command`, path: `${moduleName}/application/commands/${op.useCase}Command.java` });

        await renderAndWrite(
          path.join(templatesDir, 'SubEntityAddCommandHandler.java.ejs'),
          path.join(moduleBasePath, 'application', 'usecases', `${op.useCase}CommandHandler.java`),
          addContext, writeOptions
        );
        generatedFiles.push({ type: 'Handler', name: `${op.useCase}CommandHandler`, path: `${moduleName}/application/usecases/${op.useCase}CommandHandler.java` });

      } else if (cl.category === 'subEntityRemove') {
        // SubEntityRemove: Remove{EntityName} → findById → entity.remove{Entity}ById(itemId) → save
        const removeContext = {
          packageName, moduleName, aggregateName,
          useCaseName: op.useCase,
          idType,
          entityName: cl.entityName,
          removeMethodName: cl.removeMethodName
        };
        await renderAndWrite(
          path.join(templatesDir, 'SubEntityRemoveCommand.java.ejs'),
          path.join(moduleBasePath, 'application', 'commands', `${op.useCase}Command.java`),
          removeContext, writeOptions
        );
        generatedFiles.push({ type: 'Command', name: `${op.useCase}Command`, path: `${moduleName}/application/commands/${op.useCase}Command.java` });

        await renderAndWrite(
          path.join(templatesDir, 'SubEntityRemoveCommandHandler.java.ejs'),
          path.join(moduleBasePath, 'application', 'usecases', `${op.useCase}CommandHandler.java`),
          removeContext, writeOptions
        );
        generatedFiles.push({ type: 'Handler', name: `${op.useCase}CommandHandler`, path: `${moduleName}/application/usecases/${op.useCase}CommandHandler.java` });

      } else if (cl.category === 'findBy') {
        // FindBy: FindAll{Aggregate}sBy{Field} → paginated query on a root field
        findByOps.push(cl); // collected for repository re-generation after the loop
        const findByContext = {
          packageName, moduleName, aggregateName,
          useCaseName: op.useCase,
          idType,
          fieldName: cl.fieldName,
          fieldPascal: cl.fieldPascal,
          fieldJavaType: cl.fieldJavaType,
          jpaMethodName: cl.jpaMethodName
        };
        await renderAndWrite(
          path.join(templatesDir, 'FindByQuery.java.ejs'),
          path.join(moduleBasePath, 'application', 'queries', `${op.useCase}Query.java`),
          findByContext, writeOptions
        );
        generatedFiles.push({ type: 'Query', name: `${op.useCase}Query`, path: `${moduleName}/application/queries/${op.useCase}Query.java` });

        await renderAndWrite(
          path.join(templatesDir, 'FindByQueryHandler.java.ejs'),
          path.join(moduleBasePath, 'application', 'usecases', `${op.useCase}QueryHandler.java`),
          findByContext, writeOptions
        );
        generatedFiles.push({ type: 'Handler', name: `${op.useCase}QueryHandler`, path: `${moduleName}/application/usecases/${op.useCase}QueryHandler.java` });

      } else {
        // Scaffold: no semantic pattern matched → generate stub with TODO
        const scaffoldContext = { packageName, moduleName, aggregateName, useCaseName: op.useCase };
        const scaffoldType = op.type || (op.method === 'GET' ? 'query' : 'command');
        if (scaffoldType === 'command') {
          await renderAndWrite(
            path.join(templatesDir, 'ScaffoldCommand.java.ejs'),
            path.join(moduleBasePath, 'application', 'commands', `${op.useCase}Command.java`),
            scaffoldContext, writeOptions
          );
          generatedFiles.push({ type: 'Command', name: `${op.useCase}Command`, path: `${moduleName}/application/commands/${op.useCase}Command.java` });

          await renderAndWrite(
            path.join(templatesDir, 'ScaffoldCommandHandler.java.ejs'),
            path.join(moduleBasePath, 'application', 'usecases', `${op.useCase}CommandHandler.java`),
            scaffoldContext, writeOptions
          );
          generatedFiles.push({ type: 'Handler', name: `${op.useCase}CommandHandler`, path: `${moduleName}/application/usecases/${op.useCase}CommandHandler.java` });
        } else {
          await renderAndWrite(
            path.join(templatesDir, 'ScaffoldQuery.java.ejs'),
            path.join(moduleBasePath, 'application', 'queries', `${op.useCase}Query.java`),
            scaffoldContext, writeOptions
          );
          generatedFiles.push({ type: 'Query', name: `${op.useCase}Query`, path: `${moduleName}/application/queries/${op.useCase}Query.java` });

          await renderAndWrite(
            path.join(templatesDir, 'ScaffoldQueryHandler.java.ejs'),
            path.join(moduleBasePath, 'application', 'usecases', `${op.useCase}QueryHandler.java`),
            scaffoldContext, writeOptions
          );
          generatedFiles.push({ type: 'Handler', name: `${op.useCase}QueryHandler`, path: `${moduleName}/application/usecases/${op.useCase}QueryHandler.java` });
        }
      }
    }
  }

  // ── Step 5b: Re-generate repository files when FindBy ops are present ────
  // Checksum protection still applies: manually modified files are skipped.
  if (findByOps.length > 0) {
    const aggregateTemplatesDir = path.join(__dirname, '..', '..', 'templates', 'aggregate');
    const repoContext = { packageName, moduleName, rootEntity, findByOps };
    const repoImplContext = {
      packageName, moduleName, aggregateName, rootEntity,
      hasDomainEvents: (aggregate.domainEvents || []).length > 0,
      findByOps
    };
    await renderAndWrite(
      path.join(aggregateTemplatesDir, 'AggregateRepository.java.ejs'),
      path.join(moduleBasePath, 'domain', 'repositories', `${rootEntity.name}Repository.java`),
      repoContext, writeOptions
    );
    await renderAndWrite(
      path.join(aggregateTemplatesDir, 'JpaRepository.java.ejs'),
      path.join(moduleBasePath, 'infrastructure', 'database', 'repositories', `${rootEntity.name}JpaRepository.java`),
      repoContext, writeOptions
    );
    await renderAndWrite(
      path.join(aggregateTemplatesDir, 'AggregateRepositoryImpl.java.ejs'),
      path.join(moduleBasePath, 'infrastructure', 'database', 'repositories', `${rootEntity.name}RepositoryImpl.java`),
      repoImplContext, writeOptions
    );
  }

  // ── Step 6: Versioned controllers ────────────────────────────────────
  for (const version of endpoints.versions) {
    const versionCap = version.version.charAt(0).toUpperCase() + version.version.slice(1);
    const controllerName = `${aggregateName}${versionCap}Controller`;
    const enrichedOps = version.operations.map(op => enrichEndpointOperation(op, aggregateName, idType));

    const controllerContext = {
      ...baseContext,
      apiVersion: version.version,
      controllerName,
      operations: enrichedOps,
      basePath: endpoints.basePath,
      commandFields: commandFieldsApp,
      oneToManyRelationships,
      oneToOneRelationships
    };

    await renderAndWrite(
      path.join(templatesDir, 'EndpointsController.java.ejs'),
      path.join(moduleBasePath, 'infrastructure', 'rest', 'controllers', resourceNameCamel, version.version, `${controllerName}.java`),
      controllerContext, writeOptions
    );
    generatedFiles.push({ type: 'Controller', name: controllerName, path: `${moduleName}/infrastructure/rest/controllers/${resourceNameCamel}/${version.version}/${controllerName}.java` });
  }
}

/**
 * Generate CRUD resources for an aggregate root
 */
async function generateCrudResources(aggregate, moduleName, moduleBasePath, packageName, apiVersion, generatedFiles, writeOptions = {}) {
  const { name: aggregateName, rootEntity, secondaryEntities, valueObjects = [] } = aggregate;
  const templatesDir = path.join(__dirname, '..', '..', 'templates', 'crud');
  
  // Get ID field and type
  const idField = rootEntity.fields[0];
  const idType = idField.javaType;
  
  // Filter command fields (exclude id, audit fields, and readOnly fields)
  const commandFields = rootEntity.fields.filter(f => 
    f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' && f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.readOnly
  );

  // Validated VOs: VOs where any field has validation annotations
  const validatedVos = valueObjects.filter(vo =>
    vo.fields.some(f => f.validationAnnotations && f.validationAnnotations.length > 0)
  );
  const validatedVoNames = new Set(validatedVos.map(vo => vo.name));
  
  // Build enriched OneToMany relationships with recursive nested data
  const oneToManyRelationships = enrichRelationshipsRecursively(
    rootEntity, 
    secondaryEntities, 
    0, 
    new Set()
  );
  
  console.log(`[DEBUG] Found ${oneToManyRelationships.length} OneToMany relationships for ${aggregateName}`);
  oneToManyRelationships.forEach(rel => {
    console.log(`[DEBUG]   - ${rel.fieldName}: ${rel.targetEntityName} (nested: ${rel.hasNestedRelationships})`);
  });
  
  // Build OneToOne relationships
  const oneToOneRels = rootEntity.relationships?.filter(r => 
    r.type === 'OneToOne' && !r.isInverse
  ) || [];
  
  const oneToOneRelationships = oneToOneRels.map(rel => {
    const targetEntity = secondaryEntities.find(e => e.name === rel.target);
    
    if (!targetEntity) {
      return {
        targetEntityName: rel.target,
        fieldName: rel.fieldName,
        type: rel.type,
        fields: []
      };
    }
    
    const targetFields = targetEntity.fields.filter(f => 
      f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' && f.name !== 'createdBy' && f.name !== 'updatedBy'
    );
    
    return {
      targetEntityName: rel.target,
      fieldName: rel.fieldName,
      type: rel.type,
      fields: targetFields,
      entity: targetEntity
    };
  });
  
  console.log(`[DEBUG] Found ${oneToOneRelationships.length} OneToOne relationships for ${aggregateName}`);
  oneToOneRelationships.forEach(rel => {
    console.log(`[DEBUG]   - ${rel.fieldName}: ${rel.targetEntityName}`);
  });
  
  // Detect if has value objects or enums
  const hasValueObjects = rootEntity.fields.some(f => f.isValueObject);
  const hasEnums = rootEntity.enums && rootEntity.enums.length > 0;
  
  // Resource naming
  const resourceNameCamel = toCamelCase(aggregateName);
  const resourceNameKebab = toKebabCase(aggregateName);
  
  // Filter audit user fields and hidden fields from response DTOs
  const responseFields = rootEntity.fields.filter(f => 
    f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.hidden
  );
  
  const responseSecondaryEntities = secondaryEntities.map(entity => ({
    ...entity,
    responseFields: entity.fields.filter(f => 
      f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.hidden
    ),
    nestedRelationships: enrichRelationshipsRecursively(entity, secondaryEntities, 0, new Set()),
    forwardOneToOneRels: (entity.relationships || [])
      .filter(r => r.type === 'OneToOne' && !r.isInverse)
      .map(r => ({ targetEntityName: r.target, fieldName: r.fieldName }))
  }));
  
  // Apply app-layer field transformation (VO fields become Create<Vo>Dto types)
  const commandFieldsApp = transformFieldsForApp(commandFields, validatedVoNames);
  const oneToOneRelationshipsApp = oneToOneRelationships.map(rel => ({
    ...rel,
    fields: transformFieldsForApp(rel.fields || [], validatedVoNames)
  }));
  const oneToManyRelationshipsApp = transformRelsForApp(oneToManyRelationships, validatedVoNames);

  // Base context for all templates
  const baseContext = {
    packageName,
    moduleName,
    aggregateName,
    rootEntity,
    secondaryEntities,
    responseFields,
    responseSecondaryEntities,
    idType,
    commandFields: commandFieldsApp,
    oneToManyRelationships,
    oneToOneRelationships,
    hasValueObjects,
    hasEnums,
    imports: rootEntity.imports,
    apiVersion,
    resourceNameCamel,
    resourceNameKebab
  };

  // 0. Generate Create<VoName>Dto for validated Value Objects
  for (const vo of validatedVos) {
    const voDtoContext = {
      packageName,
      moduleName,
      voName: vo.name,
      fields: vo.fields,
      hasEnums: (vo.imports || []).some(i => i.includes('.enums.')),
      imports: [...(vo.imports || []), ...generateValidationImports(vo.fields)]
    };
    await renderAndWrite(
      path.join(templatesDir, 'CreateValueObjectDto.java.ejs'),
      path.join(moduleBasePath, 'application', 'dtos', `Create${vo.name}Dto.java`),
      voDtoContext,
      writeOptions
    );
    generatedFiles.push({ type: 'DTO', name: `Create${vo.name}Dto`, path: `${moduleName}/application/dtos/Create${vo.name}Dto.java` });
  }

  // 1. Generate ApplicationMapper (uses transformed rels + validatedVos for helper methods)
  await renderAndWrite(
    path.join(templatesDir, 'ApplicationMapper.java.ejs'),
    path.join(moduleBasePath, 'application', 'mappers', `${aggregateName}ApplicationMapper.java`),
    {
      ...baseContext,
      commandFields: commandFieldsApp,
      oneToOneRelationships: oneToOneRelationshipsApp,
      oneToManyRelationships: oneToManyRelationshipsApp,
      validatedVos
    },
    writeOptions
  );
  generatedFiles.push({ type: 'Application Mapper', name: `${aggregateName}ApplicationMapper`, path: `${moduleName}/application/mappers/${aggregateName}ApplicationMapper.java` });
  
  // 2. Generate Commands
  const commandVoDtoImports = validatedVos
    .filter(vo => commandFieldsApp.some(f => f.originalVoType === vo.name))
    .map(vo => `import ${packageName}.${moduleName}.application.dtos.Create${vo.name}Dto;`);
  const commandAppImports = [...new Set([
    ...(rootEntity.imports || []),
    ...generateValidationImports(commandFieldsApp),
    ...commandVoDtoImports,
    ...(commandFieldsApp.some(f => f.originalVoType) ? ['import jakarta.validation.Valid;'] : [])
  ])];
  await renderAndWrite(
    path.join(templatesDir, 'CreateCommand.java.ejs'),
    path.join(moduleBasePath, 'application', 'commands', `Create${aggregateName}Command.java`),
    { ...baseContext, imports: commandAppImports },
    writeOptions
  );
  generatedFiles.push({ type: 'Command', name: `Create${aggregateName}Command`, path: `${moduleName}/application/commands/Create${aggregateName}Command.java` });
  
  await renderAndWrite(
    path.join(templatesDir, 'DeleteCommand.java.ejs'),
    path.join(moduleBasePath, 'application', 'commands', `Delete${aggregateName}Command.java`),
    baseContext,
    writeOptions
  );
  generatedFiles.push({ type: 'Command', name: `Delete${aggregateName}Command`, path: `${moduleName}/application/commands/Delete${aggregateName}Command.java` });

  await renderAndWrite(
    path.join(templatesDir, 'UpdateCommand.java.ejs'),
    path.join(moduleBasePath, 'application', 'commands', `Update${aggregateName}Command.java`),
    { ...baseContext, imports: commandAppImports },
    writeOptions
  );
  generatedFiles.push({ type: 'Command', name: `Update${aggregateName}Command`, path: `${moduleName}/application/commands/Update${aggregateName}Command.java` });
  
  // 3. Generate Queries
  await renderAndWrite(
    path.join(templatesDir, 'GetQuery.java.ejs'),
    path.join(moduleBasePath, 'application', 'queries', `Get${aggregateName}Query.java`),
    baseContext,
    writeOptions
  );
  generatedFiles.push({ type: 'Query', name: `Get${aggregateName}Query`, path: `${moduleName}/application/queries/Get${aggregateName}Query.java` });
  
  await renderAndWrite(
    path.join(templatesDir, 'ListQuery.java.ejs'),
    path.join(moduleBasePath, 'application', 'queries', `FindAll${aggregateName}sQuery.java`),
    baseContext,
    writeOptions
  );
  generatedFiles.push({ type: 'Query', name: `FindAll${aggregateName}sQuery`, path: `${moduleName}/application/queries/FindAll${aggregateName}sQuery.java` });
  
  // 4. Generate Handlers
  await renderAndWrite(
    path.join(templatesDir, 'CreateCommandHandler.java.ejs'),
    path.join(moduleBasePath, 'application', 'usecases', `Create${aggregateName}CommandHandler.java`),
    {
      ...baseContext,
      commandFields: commandFieldsApp,
      oneToOneRelationships: oneToOneRelationshipsApp,
      oneToManyRelationships: oneToManyRelationshipsApp,
      validatedVos
    },
    writeOptions
  );
  generatedFiles.push({ type: 'Handler', name: `Create${aggregateName}CommandHandler`, path: `${moduleName}/application/usecases/Create${aggregateName}CommandHandler.java` });
  
  await renderAndWrite(
    path.join(templatesDir, 'GetQueryHandler.java.ejs'),
    path.join(moduleBasePath, 'application', 'usecases', `Get${aggregateName}QueryHandler.java`),
    baseContext,
    writeOptions
  );
  generatedFiles.push({ type: 'Handler', name: `Get${aggregateName}QueryHandler`, path: `${moduleName}/application/usecases/Get${aggregateName}QueryHandler.java` });
  
  await renderAndWrite(
    path.join(templatesDir, 'ListQueryHandler.java.ejs'),
    path.join(moduleBasePath, 'application', 'usecases', `FindAll${aggregateName}sQueryHandler.java`),
    baseContext,
    writeOptions
  );
  generatedFiles.push({ type: 'Handler', name: `FindAll${aggregateName}sQueryHandler`, path: `${moduleName}/application/usecases/FindAll${aggregateName}sQueryHandler.java` });
  
  await renderAndWrite(
    path.join(templatesDir, 'DeleteCommandHandler.java.ejs'),
    path.join(moduleBasePath, 'application', 'usecases', `Delete${aggregateName}CommandHandler.java`),
    baseContext,
    writeOptions
  );
  generatedFiles.push({ type: 'Handler', name: `Delete${aggregateName}CommandHandler`, path: `${moduleName}/application/usecases/Delete${aggregateName}CommandHandler.java` });

  await renderAndWrite(
    path.join(templatesDir, 'UpdateCommandHandler.java.ejs'),
    path.join(moduleBasePath, 'application', 'usecases', `Update${aggregateName}CommandHandler.java`),
    baseContext,
    writeOptions
  );
  generatedFiles.push({ type: 'Handler', name: `Update${aggregateName}CommandHandler`, path: `${moduleName}/application/usecases/Update${aggregateName}CommandHandler.java` });
  
  // 5. Generate DTOs
  const responseDtoContext = {
    ...baseContext,
    allFields: rootEntity.fields.filter(f => f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.hidden),
    relationships: rootEntity.relationships.filter(r => (r.type === 'OneToMany' || r.type === 'OneToOne') && !r.isInverse)
  };
  
  await renderAndWrite(
    path.join(templatesDir, 'ResponseDto.java.ejs'),
    path.join(moduleBasePath, 'application', 'dtos', `${aggregateName}ResponseDto.java`),
    responseDtoContext,
    writeOptions
  );
  generatedFiles.push({ type: 'DTO', name: `${aggregateName}ResponseDto`, path: `${moduleName}/application/dtos/${aggregateName}ResponseDto.java` });
  
  // Generate secondary entity DTOs with nested relationships
  for (const entity of secondaryEntities) {
    // Get nested relationships for this entity
    const nestedRelationships = enrichRelationshipsRecursively(
      entity,
      secondaryEntities,
      0,
      new Set()
    );
    
    const forwardOneToOneRelsDtoResp = (entity.relationships || [])
      .filter(r => r.type === 'OneToOne' && !r.isInverse)
      .map(r => ({ targetEntityName: r.target, fieldName: r.fieldName }));
    
    const entityDtoContext = {
      packageName,
      moduleName,
      entityName: entity.name,
      fields: entity.fields.filter(f => f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.hidden),
      nestedRelationships,
      hasNestedRelationships: nestedRelationships.length > 0,
      forwardOneToOneRels: forwardOneToOneRelsDtoResp,
      hasValueObjects: entity.fields.some(f => f.isValueObject),
      hasEnums: entity.enums && entity.enums.length > 0,
      imports: entity.imports
    };
    
    await renderAndWrite(
      path.join(templatesDir, 'SecondaryEntityDto.java.ejs'),
      path.join(moduleBasePath, 'application', 'dtos', `${entity.name}Dto.java`),
      entityDtoContext,
      writeOptions
    );
    generatedFiles.push({ type: 'DTO', name: `${entity.name}Dto`, path: `${moduleName}/application/dtos/${entity.name}Dto.java` });
  }
  
  // Generate CreateItemDto for ALL secondary entities with nested relationships
  console.log(`[DEBUG] Generating Create DTOs for ${secondaryEntities.length} secondary entities`);
  for (const entity of secondaryEntities) {
    console.log(`[DEBUG] Generating CreateItemDto for entity: ${entity.name}`);
    const createFields = entity.fields.filter(f => 
      f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' && f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.readOnly
    );
    
    // Get nested relationships for this entity
    const nestedRelationships = enrichRelationshipsRecursively(
      entity,
      secondaryEntities,
      0,
      new Set()
    );
    
    const createFieldsApp = transformFieldsForApp(createFields, validatedVoNames);
    const dtoVoDtoImports = validatedVos
      .filter(vo => createFieldsApp.some(f => f.originalVoType === vo.name))
      .map(vo => `import ${packageName}.${moduleName}.application.dtos.Create${vo.name}Dto;`);
    const createDtoImports = [...new Set([
      ...(entity.imports || []),
      ...generateValidationImports(createFieldsApp),
      ...dtoVoDtoImports,
      ...(createFieldsApp.some(f => f.originalVoType) ? ['import jakarta.validation.Valid;'] : [])
    ])];
    
    // Collect forward OneToOne relationships (not inverse) for nested DTO fields
    const forwardOneToOneRels = (entity.relationships || [])
      .filter(r => r.type === 'OneToOne' && !r.isInverse)
      .map(r => ({
        targetEntityName: r.target,
        fieldName: r.fieldName
      }));
    
    const createItemDtoContext = {
      packageName,
      moduleName,
      entityName: entity.name,
      fields: createFieldsApp,
      nestedRelationships,
      hasNestedRelationships: nestedRelationships.length > 0,
      forwardOneToOneRels,
      hasValueObjects: entity.fields.some(f => f.isValueObject),
      hasEnums: entity.enums && entity.enums.length > 0,
      imports: createDtoImports
    };
    
    await renderAndWrite(
      path.join(templatesDir, 'CreateItemDto.java.ejs'),
      path.join(moduleBasePath, 'application', 'dtos', `Create${entity.name}Dto.java`),
      createItemDtoContext,
      writeOptions
    );
    generatedFiles.push({ type: 'DTO', name: `Create${entity.name}Dto`, path: `${moduleName}/application/dtos/Create${entity.name}Dto.java` });
  }
  
  // 6. Generate Controller
  await renderAndWrite(
    path.join(templatesDir, 'Controller.java.ejs'),
    path.join(moduleBasePath, 'infrastructure', 'rest', 'controllers', resourceNameCamel, apiVersion, `${aggregateName}Controller.java`),
    baseContext,
    writeOptions
  );
  generatedFiles.push({ type: 'Controller', name: `${aggregateName}Controller`, path: `${moduleName}/infrastructure/rest/controllers/${resourceNameCamel}/${apiVersion}/${aggregateName}Controller.java` });
}

/**
 * Generate Postman Collection for CRUD testing
 */
async function generatePostmanCollection(
  aggregate,
  moduleName,
  moduleBasePath,
  projectDir,
  packageName,
  apiVersion,
  projectConfig,
  allEnums = [],
  writeOptions = {}
) {
  const { name: aggregateName, rootEntity, secondaryEntities } = aggregate;
  const templatesDir = path.join(__dirname, '..', '..', 'templates', 'postman');
  
  const idField = rootEntity.fields[0];
  const idType = idField.javaType;
  
  const commandFields = rootEntity.fields.filter(f => 
    f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' && f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.readOnly
  );
  
  const oneToManyRelationships = enrichRelationshipsRecursively(
    rootEntity, 
    secondaryEntities, 
    0, 
    new Set()
  );
  
  const resourceNameKebab = toKebabCase(aggregateName);
  const port = projectConfig.server?.port || 8040;
  
  // Generate unique collection ID
  const crypto = require('crypto');
  const collectionId = crypto.randomUUID();
  
  const context = {
    aggregateName,
    moduleName,
    resourceNameKebab,
    apiVersion,
    port,
    idType,
    commandFields,
    oneToManyRelationships,
    secondaryEntities,
    rootEntity,
    collectionId,
    trackUser: rootEntity.audit?.trackUser === true,
    allEnums
  };
  
  // Output to module root
  const outputPath = path.join(moduleBasePath, `${aggregateName}-Postman-Collection.json`);
  
  await renderAndWrite(
    path.join(templatesDir, 'Collection.json.ejs'),
    outputPath,
    context,
    writeOptions
  );
  
  return outputPath;
}

module.exports = generateEntitiesCommand;
