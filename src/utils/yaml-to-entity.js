const yaml = require('js-yaml');
const fs = require('fs-extra');
const pluralize = require('pluralize');
const { toPascalCase, toCamelCase, toSnakeCase, toKebabCase } = require('./naming');

/**
 * Parse domain.yaml and extract aggregates with entities and value objects
 * @param {string} yamlPath - Path to domain.yaml file
 * @param {string} packageName - Package name
 * @param {string} moduleName - Module name
 * @returns {Object} Parsed aggregates with contexts for templates
 */
async function parseDomainYaml(yamlPath, packageName = '', moduleName = '') {
  const yamlContent = await fs.readFile(yamlPath, 'utf-8');
  const domainData = yaml.load(yamlContent);
  
  if (!domainData.aggregates || !Array.isArray(domainData.aggregates)) {
    throw new Error('domain.yaml must contain an "aggregates" array');
  }
  
  const aggregates = domainData.aggregates.map(aggregate => parseAggregate({
    ...aggregate,
    packageName,
    moduleName
  }));

  const endpoints = parseEndpoints(domainData);
  const listeners = parseListeners(domainData);

  // ── C2-006: useCase name collision between endpoints and listeners ─────────
  // Both sections generate a "{UseCase}Command.java". The generator processes
  // listeners first, then endpoints — the endpoint run silently overwrites the
  // listener command, leaving the KafkaListener dispatching a constructor that
  // no longer exists → compile error.
  const endpointUseCases = new Set(
    endpoints ? endpoints.versions.flatMap(v => v.operations.map(op => op.useCase)) : []
  );
  const collisions = listeners
    .map(l => l.useCase)
    .filter(uc => endpointUseCases.has(uc));
  if (collisions.length > 0) {
    throw new Error(
      `[C2-006] useCase name collision in domain.yaml:\n` +
      collisions.map(uc =>
        `  - "${uc}" appears in both endpoints: (operation) and listeners: (useCase).\n` +
        `    Both would generate "${uc}Command.java" — the endpoint version overwrites the listener version.\n` +
        `    Fix: rename the listener useCase, e.g. "${uc.replace(/^Create/, 'Initialize')}".`
      ).join('\n')
    );
  }

  const ports = parsePorts(domainData, moduleName);
  const readModels = parseReadModels(domainData, moduleName, ports);

  return {
    aggregates,
    allEnums: extractAllEnums(domainData.aggregates),
    endpoints,
    listeners,
    ports,
    readModels
  };
}

/**
 * Parse a single aggregate
 * @param {Object} aggregateData - Aggregate data from YAML
 * @returns {Object} Parsed aggregate with entities and value objects
 */
function parseAggregate(aggregateData) {
  const { name, entities = [], valueObjects = [], enums = [], events = [], packageName = '', moduleName = '' } = aggregateData;
  
  // Find the aggregate root
  const rootEntity = entities.find(e => e.isRoot === true);
  if (!rootEntity) {
    throw new Error(`Aggregate "${name}" must have one entity with isRoot: true`);
  }
  
  // Parse aggregate-level enums
  const aggregateEnums = enums.map(e => ({
    name: toPascalCase(e.name),
    values: e.values,
    transitions: e.transitions || null,
    initialValue: e.initialValue || null
  }));
  
  // Parse value objects FIRST to get their names
  const parsedValueObjects = valueObjects.map(vo => parseValueObject(vo, aggregateEnums, packageName, moduleName));
  const valueObjectNames = parsedValueObjects.map(vo => vo.name);
  
  // Generate inverse relationships from mappedBy
  const inverseRelationships = generateInverseRelationships(entities);
  
  // Parse entities with value object detection and inverse relationships
  const parsedEntities = entities.map(entity => parseEntity(entity, name, packageName, moduleName, aggregateEnums, valueObjectNames, inverseRelationships));
  const parsedRoot = parsedEntities.find(e => e.isRoot);
  const secondaryEntities = parsedEntities.filter(e => !e.isRoot);
  
  // Generate aggregate methods based on relationships
  const aggregateMethods = generateAggregateMethods(parsedRoot, secondaryEntities);
  
  // Merge imports from aggregate method parameters into root entity
  const methodImports = generateAggregateMethodImports(aggregateMethods, aggregateEnums, packageName, moduleName);
  const allRootImports = new Set([...parsedRoot.imports, ...methodImports]);
  parsedRoot.imports = Array.from(allRootImports).sort();
  
  // Parse domain events declared at aggregate level
  const domainEvents = events.map(event => {
    const eventName = toPascalCase(event.name);
    const eventFields = (event.fields || []).map(f => parseProperty(f, aggregateEnums, valueObjectNames));
    return {
      name: eventName,
      fieldName: toCamelCase(eventName),
      fields: eventFields,
      triggers: event.triggers || [],
      lifecycle: event.lifecycle || null
    };
  });

  // Build inverse map: { methodName → [event, ...] }
  // Used by the AggregateRoot template to emit raise() calls inside transition methods.
  const triggeredEventsMap = {};
  domainEvents.forEach(event => {
    (event.triggers || []).forEach(method => {
      if (!triggeredEventsMap[method]) triggeredEventsMap[method] = [];
      triggeredEventsMap[method].push(event);
    });
  });

  // Build lifecycle map: { create → [event, ...], update → [...], delete → [...], softDelete → [...] }
  // Used by templates to emit raise() calls at CRUD lifecycle points.
  const VALID_LIFECYCLE_VALUES = ['create', 'update', 'delete', 'softDelete'];
  const lifecycleEventsMap = {};
  domainEvents.forEach(event => {
    if (event.lifecycle && VALID_LIFECYCLE_VALUES.includes(event.lifecycle)) {
      if (!lifecycleEventsMap[event.lifecycle]) lifecycleEventsMap[event.lifecycle] = [];
      lifecycleEventsMap[event.lifecycle].push(event);
    }
  });

  return {
    name: toPascalCase(name),
    packageName: aggregateData.package || '',
    rootEntity: parsedRoot,
    secondaryEntities,
    valueObjects: parsedValueObjects,
    aggregateMethods,
    allEntities: parsedEntities,
    domainEvents,
    triggeredEventsMap,
    lifecycleEventsMap,
    enums: aggregateEnums
  };
}

/**
 * Parse an entity
 * @param {Object} entityData - Entity data from YAML
 * @param {string} aggregateName - Name of the aggregate
 * @param {string} packageName - Package name
 * @param {string} moduleName - Module name
 * @param {Array} aggregateEnums - All enums from the aggregate
 * @param {Array} valueObjectNames - Names of value objects in aggregate
 * @param {Object} inverseRelationships - Map of auto-generated inverse relationships
 * @returns {Object} Parsed entity
 */
function parseEntity(entityData, aggregateName, packageName = '', moduleName = '', aggregateEnums = [], valueObjectNames = [], inverseRelationships = {}) {
  const { name, isRoot = false, tableName, properties, fields: fieldsYaml, relationships = [], auditable = false, audit, hasSoftDelete = false } = entityData;
  
  // Validate hasSoftDelete
  if (hasSoftDelete !== undefined && typeof hasSoftDelete !== 'boolean') {
    throw new Error(`Entity "${name}": hasSoftDelete must be a boolean (true/false)`);
  }
  if (hasSoftDelete === true && isRoot === false) {
    console.warn(`⚠️  Entity "${name}": hasSoftDelete is only supported on the aggregate root (isRoot: true). It will be ignored for secondary entities.`);
  }

  // Accept both 'properties' and 'fields' field names
  let entityFields = properties || fieldsYaml || [];
  
  // Process audit configuration
  let auditConfig = {
    enabled: false,
    trackUser: false
  };
  
  // Legacy support: auditable: true (deprecated but still supported)
  if (auditable !== undefined) {
    if (typeof auditable !== 'boolean') {
      throw new Error(`Entity "${name}": auditable property must be a boolean (true/false)`);
    }
    if (auditable === true) {
      console.warn(`⚠️  Entity "${name}": 'auditable: true' is deprecated. Use 'audit: { enabled: true }' instead.`);
      auditConfig.enabled = true;
      auditConfig.trackUser = false;
    }
  }
  
  // New syntax: audit: { enabled: true, trackUser: true }
  if (audit !== undefined) {
    if (typeof audit !== 'object' || audit === null) {
      throw new Error(`Entity "${name}": audit property must be an object with { enabled, trackUser } properties`);
    }
    
    if (audit.enabled !== undefined) {
      if (typeof audit.enabled !== 'boolean') {
        throw new Error(`Entity "${name}": audit.enabled must be a boolean (true/false)`);
      }
      auditConfig.enabled = audit.enabled;
    }
    
    if (audit.trackUser !== undefined) {
      if (typeof audit.trackUser !== 'boolean') {
        throw new Error(`Entity "${name}": audit.trackUser must be a boolean (true/false)`);
      }
      auditConfig.trackUser = audit.trackUser;
    }
    
    // Validate: trackUser requires enabled
    if (auditConfig.trackUser === true && auditConfig.enabled === false) {
      throw new Error(`Entity "${name}": audit.trackUser requires audit.enabled to be true`);
    }
  }
  
  // Inject audit fields based on configuration
  if (auditConfig.enabled) {
    entityFields = [
      ...entityFields,
      { name: 'createdAt', type: 'LocalDateTime' },
      { name: 'updatedAt', type: 'LocalDateTime' }
    ];
    
    if (auditConfig.trackUser) {
      entityFields = [
        ...entityFields,
        { name: 'createdBy', type: 'String' },
        { name: 'updatedBy', type: 'String' }
      ];
    }
  }

  // Inject deletedAt field for soft-delete root entities
  const effectiveSoftDelete = hasSoftDelete === true && isRoot === true;
  if (effectiveSoftDelete) {
    entityFields = [
      ...entityFields,
      { name: 'deletedAt', type: 'LocalDateTime' }
    ];
  }
  
  const className = toPascalCase(name);
  const fieldName = toCamelCase(name);
  const table = tableName || toSnakeCase(pluralize(name));
  
  // Parse properties/fields with value object detection
  const fields = entityFields.map(prop => parseProperty(prop, valueObjectNames, aggregateEnums));
  
  // Parse relationships from YAML
  const yamlRelations = relationships.map(rel => parseRelationship(rel, className));
  
  // Get auto-generated inverse relationships for this entity
  const inverseRels = inverseRelationships[className] || [];
  
  // Combine YAML and inverse relationships (YAML takes priority on conflicts)
  const relations = [...yamlRelations, ...inverseRels.filter(inv => 
    !yamlRelations.some(yaml => yaml.fieldName === inv.fieldName)
  )];
  
  // Detect enums in properties/fields
  const enums = entityFields
    .filter(prop => prop.enumValues && Array.isArray(prop.enumValues))
    .map(prop => ({
      name: toPascalCase(prop.type),
      values: prop.enumValues
    }));
  
  return {
    name: className,
    fieldName,
    tableName: table,
    isRoot,
    hasSoftDelete: effectiveSoftDelete,
    auditable: auditable === true, // Legacy support
    audit: auditConfig, // New audit configuration
    fields,
    relationships: relations,
    enums,
    imports: generateEntityImports(fields, relations, enums, aggregateEnums, packageName, moduleName, true)
  };
}

/**
 * Parse a property
 * @param {Object} propData - Property data from YAML
 * @param {Array} valueObjectNames - Names of value objects in aggregate
 * @param {Array} aggregateEnums - Enums from the aggregate
 * @returns {Object} Parsed property
 */
/**
 * Build a JSR-303 annotation string from a validation descriptor object.
 * Supported keys: type, message, value, min, max, regexp, integer, fraction, inclusive.
 * @param {Object} validation - e.g. { type: 'Email', message: 'Invalid email' }
 * @returns {string} - e.g. '@Email(message = "Invalid email")'
 */
function buildAnnotationString(validation) {
  const { type, message, value, min, max, regexp, integer, fraction, inclusive } = validation;
  const params = [];

  if (value !== undefined)     params.push(`value = ${value}`);
  if (min !== undefined)       params.push(`min = ${min}`);
  if (max !== undefined)       params.push(`max = ${max}`);
  if (regexp !== undefined)    params.push(`regexp = "${regexp.replace(/\\/g, '\\\\')}"`);
  if (integer !== undefined)   params.push(`integer = ${integer}`);
  if (fraction !== undefined)  params.push(`fraction = ${fraction}`);
  if (inclusive !== undefined) params.push(`inclusive = ${inclusive}`);
  if (message !== undefined)   params.push(`message = "${message}"`);

  return params.length === 0 ? `@${type}` : `@${type}(${params.join(', ')})`;
}

/**
 * Compute the Java literal for a defaultValue declared in domain.yaml.
 * Returns a string ready to be emitted in a template (e.g. `0`, `"foo"`, `Status.ACTIVE`).
 * Returns null for unsupported combinations — callers should guard before emitting.
 *
 * @param {*}       rawValue  - The raw value from YAML (string, number, boolean)
 * @param {string}  javaType  - The resolved Java type (e.g. "String", "BigDecimal")
 * @param {boolean} isEnum    - Whether the field type is an enum
 * @returns {string|null}
 */
function computeJavaDefaultValue(rawValue, javaType, isEnum) {
  if (rawValue === null || rawValue === undefined) return null;

  const strValue = String(rawValue);

  // Enum type: emit EnumType.VALUE
  if (isEnum) {
    return `${javaType}.${strValue}`;
  }

  switch (javaType) {
    case 'String':
      return `"${strValue}"`;
    case 'Boolean':
      return strValue.toLowerCase() === 'true' ? 'true' : 'false';
    case 'Integer':
    case 'int':
      return strValue;
    case 'Long':
    case 'long':
      return `${strValue}L`;
    case 'Double':
    case 'double':
    case 'Float':
    case 'float':
      return strValue;
    case 'BigDecimal':
      return `new BigDecimal("${strValue}")`;
    case 'LocalDateTime':
      if (strValue === 'now') return 'LocalDateTime.now()';
      return null; // arbitrary datetime strings not supported
    case 'LocalDate':
      if (strValue === 'now') return 'LocalDate.now()';
      return null;
    case 'LocalTime':
      if (strValue === 'now') return 'LocalTime.now()';
      return null;
    case 'Instant':
      if (strValue === 'now') return 'Instant.now()';
      return null;
    case 'UUID':
      if (strValue === 'random') return 'UUID.randomUUID()';
      return null;
    default:
      // Unknown type — cannot safely emit a literal
      return null;
  }
}

function parseProperty(propData, valueObjectNames = [], aggregateEnums = []) {
  const { name, type, annotations = [], isValueObject = false, isEmbedded = false, enumValues, readOnly = false, hidden = false, validations = [], reference = null, defaultValue = null } = propData;

  if (defaultValue !== null && !readOnly) {
    console.warn(`⚠️  Field "${name}": "defaultValue" is only meaningful for readOnly fields. It will be ignored since readOnly is not set.`);
  }

  if (reference !== null) {
    if (typeof reference !== 'object' || !reference.aggregate || typeof reference.aggregate !== 'string') {
      throw new Error(`Field "${name}": "reference" must be an object with at least "aggregate" (string). Example:\n  reference:\n    aggregate: Customer\n    module: customers`);
    }
    if (reference.module !== undefined && typeof reference.module !== 'string') {
      throw new Error(`Field "${name}": "reference.module" must be a string.`);
    }
  }
  
  const javaType = mapYamlTypeToJava(type, enumValues);
  const fieldName = toCamelCase(name);
  
  // Detect if this is a collection type
  const isCollection = javaType.startsWith('List<');
  let collectionElementType = null;
  
  if (isCollection) {
    // Extract the type inside List<>
    const match = javaType.match(/List<(.+)>/);
    if (match) {
      collectionElementType = match[1];
    }
  }
  
  // Auto-detect if the type is a value object
  const isDetectedValueObject = valueObjectNames.includes(javaType) || valueObjectNames.includes(collectionElementType);
  
  // Check if field type matches any aggregate enum
  const isEnumType = aggregateEnums.some(e => e.name === javaType);

  // Build transition metadata if this field references an enum with transitions
  const matchingEnum = isEnumType ? aggregateEnums.find(e => e.name === javaType) : null;
  const hasTransitions = !!(matchingEnum && matchingEnum.transitions && matchingEnum.transitions.length > 0);
  const transitionMeta = hasTransitions ? {
    transitions: matchingEnum.transitions,
    initialValue: matchingEnum.initialValue || null,
    transitionMap: buildTransitionMap(matchingEnum.transitions, matchingEnum.values),
    enumValues: matchingEnum.values
  } : null;
  const autoInit = !!(hasTransitions && matchingEnum.initialValue);
  const autoInitValue = autoInit ? matchingEnum.initialValue : null;

  return {
    name: fieldName,
    originalName: name,
    javaType,
    javaTypeJpa: isDetectedValueObject || isValueObject 
      ? (isCollection ? `List<${collectionElementType}Jpa>` : `${javaType}Jpa`)
      : javaType,
    type,
    annotations,
    isValueObject: isValueObject || isDetectedValueObject,
    isEmbedded,
    isEnum: !!enumValues || isEnumType,
    isCollection,
    collectionElementType,
    columnAnnotations: extractColumnAnnotations(annotations),
    readOnly: readOnly || autoInit,  // autoInit (enum initialValue present) implies readOnly
    hidden: hidden,
    validationAnnotations: validations.map(v => buildAnnotationString(v)),
    transitionMeta,
    autoInit,
    autoInitValue,
    reference,
    defaultValue,
    javaDefaultValue: (readOnly && !autoInit && defaultValue !== null)
      ? computeJavaDefaultValue(defaultValue, javaType, !!enumValues || isEnumType)
      : null
  };
}

/**
 * Generate inverse relationships from entities with mappedBy
 * @param {Array} entities - Raw entities from YAML
 * @returns {Object} Map of entityName to array of inverse relationships
 */
function generateInverseRelationships(entities) {
  const inverseMap = {}; // { OrderItem: [{ type: 'ManyToOne', target: 'Order', ... }] }
  
  entities.forEach(entity => {
    const entityName = toPascalCase(entity.name);
    const relationships = entity.relationships || [];
    
    relationships.forEach(rel => {
      if (rel.mappedBy) {
        const targetName = rel.target || rel.targetEntity;
        if (!targetName) return;
        
        const targetEntity = toPascalCase(targetName);
        const inverseType = rel.type === 'OneToMany' ? 'ManyToOne' : 'OneToOne';
        const joinColumn = rel.joinColumn || `${rel.mappedBy}_id`;
        
        if (!inverseMap[targetEntity]) {
          inverseMap[targetEntity] = [];
        }
        
        inverseMap[targetEntity].push({
          type: inverseType,
          target: entityName,
          targetEntity: entityName,
          fieldName: rel.mappedBy,
          joinColumn: joinColumn,
          fetch: rel.fetch || 'LAZY',
          cascade: [],
          isCollection: false,
          javaType: entityName,
          javaTypeJpa: `${entityName}Jpa`,
          isInverse: true // Flag to identify auto-generated relationships
        });
      }
    });
  });
  
  return inverseMap;
}

/**
 * Parse a relationship
 * @param {Object} relData - Relationship data from YAML
 * @param {string} ownerEntity - Name of the entity that owns this relationship
 * @returns {Object} Parsed relationship
 */
function parseRelationship(relData, ownerEntity) {
  const { type, target, targetEntity: targetEntityYaml, mappedBy, joinColumn, cascade = [], fetch = 'LAZY' } = relData;
  
  // Accept both 'target' and 'targetEntity' field names
  const targetName = target || targetEntityYaml;
  
  if (!targetName) {
    throw new Error(`Relationship in entity '${ownerEntity}' is missing 'target' or 'targetEntity' field`);
  }
  
  const targetEntity = toPascalCase(targetName);
  const fieldName = type.includes('Many') ? toCamelCase(pluralize(targetName)) : toCamelCase(targetName);
  
  return {
    type, // OneToMany, ManyToOne, OneToOne, ManyToMany
    target: targetEntity,
    fieldName,
    mappedBy,
    joinColumn,
    cascade,
    fetch,
    isCollection: type.includes('Many') && !type.startsWith('ManyToOne'),
    javaType: type.includes('Many') && !type.startsWith('ManyToOne') 
      ? `List<${targetEntity}>` 
      : targetEntity,
    javaTypeJpa: type.includes('Many') && !type.startsWith('ManyToOne')
      ? `List<${targetEntity}Jpa>`
      : `${targetEntity}Jpa`
  };
}

/**
 * Parse a value object
 * @param {Object} voData - Value object data from YAML
 * @param {Array} aggregateEnums - Aggregate enums
 * @param {String} packageName - Package name
 * @param {String} moduleName - Module name
 * @returns {Object} Parsed value object
 */
function parseValueObject(voData, aggregateEnums = [], packageName = '', moduleName = '') {
  const { name, properties, fields: fieldsYaml, methods = [], validation = [] } = voData;
  
  // Accept both 'properties' and 'fields' field names
  const voFields = properties || fieldsYaml || [];
  
  const className = toPascalCase(name);
  const fields = voFields.map(prop => parseProperty(prop, [], aggregateEnums));
  const parsedMethods = methods.map(method => parseMethod(method));
  
  return {
    name: className,
    fields,
    methods: parsedMethods,
    validation,
    imports: generateValueObjectImports(fields, parsedMethods, aggregateEnums, packageName, moduleName)
  };
}

/**
 * Parse a method definition
 * @param {Object} methodData - Method data from YAML
 * @returns {Object} Parsed method
 */
function parseMethod(methodData) {
  const { name, returnType, parameters = [], body = '' } = methodData;
  
  return {
    name,
    returnType,
    parameters,
    body: body.trim()
  };
}

/**
 * Generate methods for aggregate root based on relationships
 * @param {Object} root - Parsed root entity
 * @param {Array} secondaryEntities - Secondary entities
 * @returns {Array} Generated methods
 */
function generateAggregateMethods(root, secondaryEntities) {
  const methods = [];
  
  // For each OneToMany relationship, generate add/remove methods
  root.relationships
    .filter(rel => rel.type === 'OneToMany')
    .forEach(rel => {
      const singularName = pluralize.singular(rel.fieldName);
      const entityName = rel.target;
      
      // Find secondary entity to extract its fields
      const secondaryEntity = secondaryEntities.find(e => e.name === entityName);
      
      if (secondaryEntity) {
        // Extract fields for parameters (exclude id, audit fields, readOnly, and inverse relationships)
        const paramFields = secondaryEntity.fields.filter(f => 
          f.name !== 'id' && 
          f.name !== 'createdAt' && 
          f.name !== 'updatedAt' && 
          f.name !== 'createdBy' && 
          f.name !== 'updatedBy' &&
          !f.readOnly
        );
        
        // Generate parameters array (scalar fields only — matches creation constructor)
        const parameters = paramFields.map(f => ({
          name: f.name,
          type: f.javaType
        }));
        
        // Constructor arguments match the creation constructor (scalar fields only)
        const constructorArgs = parameters.map(p => p.name).join(', ');
        
        // Detect forward OneToOne rels on the secondary entity → flattened params
        const forwardOtoRels = (secondaryEntity.relationships || []).filter(r => !r.isInverse && r.type === 'OneToOne');
        const otoParamGroups = forwardOtoRels.map(otoRel => {
          const otoEntity = secondaryEntities.find(e => e.name === otoRel.target);
          if (!otoEntity) return null;
          const otoFields = otoEntity.fields.filter(f =>
            f.name !== 'id' && f.name !== 'createdAt' && f.name !== 'updatedAt' &&
            f.name !== 'createdBy' && f.name !== 'updatedBy' && !f.readOnly
          );
          return {
            entityName: otoRel.target,
            fieldName: otoRel.fieldName,
            assignMethod: `assign${toPascalCase(otoRel.fieldName)}`,
            params: otoFields.map(f => ({
              name: toCamelCase(otoRel.fieldName) + toPascalCase(f.name), // prefixed: returnRequestReason
              type: f.javaType
            }))
          };
        }).filter(Boolean);
        
        // Build full parameter list: entity params + prefixed sub-entity params
        const allParameters = [
          ...parameters,
          ...otoParamGroups.flatMap(g => g.params)
        ];
        
        // Build method body: create entity, create + assign each sub-entity, add to list
        let methodBody;
        if (otoParamGroups.length > 0) {
          const otoLines = otoParamGroups.map(g => {
            const ctorArgs = g.params.map(p => p.name).join(', ');
            const varName = toCamelCase(g.fieldName);
            return `${g.entityName} ${varName} = new ${g.entityName}(${ctorArgs});\n        entity.${g.assignMethod}(${varName});`;
          }).join('\n        ');
          methodBody = `${entityName} entity = new ${entityName}(${constructorArgs});\n        ${otoLines}\n        this.${rel.fieldName}.add(entity);`;
        } else {
          methodBody = `${entityName} entity = new ${entityName}(${constructorArgs});\n        this.${rel.fieldName}.add(entity);`;
        }
        
        // add method with parameters (factory method — root controls all sub-entity creation)
        methods.push({
          name: `add${toPascalCase(singularName)}`,
          returnType: 'void',
          parameters: allParameters,
          body: methodBody,
          isFactory: true
        });
        
        // add method with entity (overload — for complex/test scenarios)
        methods.push({
          name: `add${toPascalCase(singularName)}`,
          returnType: 'void',
          parameters: [{
            name: toCamelCase(singularName),
            type: entityName
          }],
          body: `this.${rel.fieldName}.add(${toCamelCase(singularName)});`,
          isOverload: true
        });
      } else {
        // Fallback to old behavior if entity not found
        methods.push({
          name: `add${toPascalCase(singularName)}`,
          returnType: 'void',
          parameters: [{
            name: toCamelCase(singularName),
            type: entityName
          }],
          body: `this.${rel.fieldName}.add(${toCamelCase(singularName)});`
        });
      }
      
      // remove method
      methods.push({
        name: `remove${toPascalCase(singularName)}`,
        returnType: 'void',
        parameters: [{
          name: 'id',
          type: 'Long'
        }],
        body: `this.${rel.fieldName}.removeIf(item -> item.getId().equals(id));`
      });
      
      // get unmodifiable collection
      methods.push({
        name: `get${toPascalCase(rel.fieldName)}`,
        returnType: `List<${entityName}>`,
        parameters: [],
        body: `return Collections.unmodifiableList(this.${rel.fieldName});`
      });
    });
  
  // For each OneToOne relationship, generate assign method with overload
  root.relationships
    .filter(rel => rel.type === 'OneToOne' && rel.mappedBy)
    .forEach(rel => {
      const entityName = rel.target;
      const fieldName = rel.fieldName;
      
      // Find secondary entity to extract its fields
      const secondaryEntity = secondaryEntities.find(e => e.name === entityName);
      
      if (secondaryEntity) {
        // Extract fields for parameters (exclude id, audit fields, readOnly, and inverse relationships)
        const paramFields = secondaryEntity.fields.filter(f => 
          f.name !== 'id' && 
          f.name !== 'createdAt' && 
          f.name !== 'updatedAt' && 
          f.name !== 'createdBy' && 
          f.name !== 'updatedBy' &&
          !f.readOnly
        );
        
        // Filter out inverse relationships
        const paramRelationships = (secondaryEntity.relationships || []).filter(r => !r.isInverse);
        
        // Generate parameters array (scalar fields only — matches creation constructor)
        const parameters = paramFields.map(f => ({
          name: f.name,
          type: f.javaType
        }));
        
        // Constructor arguments match the creation constructor (scalar fields only)
        const constructorArgs = parameters.map(p => p.name).join(', ');
        
        // Generate method body that creates entity and assigns it
        const methodBody = `${entityName} entity = new ${entityName}(${constructorArgs});
        assign${toPascalCase(fieldName)}(entity);`;
        
        // assign method overload with parameters (factory method)
        methods.push({
          name: `assign${toPascalCase(fieldName)}`,
          returnType: 'void',
          parameters: parameters,
          body: methodBody,
          isFactory: true,
          isOverload: true
        });
      }
    });
  
  return methods;
}

/**
 * Map YAML type to Java type
 * @param {string} yamlType - Type from YAML
 * @param {Array} enumValues - Enum values if applicable
 * @returns {string} Java type
 */
function mapYamlTypeToJava(yamlType, enumValues) {
  if (enumValues) {
    return toPascalCase(yamlType);
  }
  
  // Handle List<> types - preserve as-is
  if (yamlType.startsWith('List<') && yamlType.endsWith('>')) {
    return yamlType;
  }
  
  const typeMap = {
    'String': 'String',
    'Integer': 'Integer',
    'Long': 'Long',
    'Double': 'Double',
    'BigDecimal': 'BigDecimal',
    'Boolean': 'Boolean',
    'LocalDate': 'LocalDate',
    'LocalDateTime': 'LocalDateTime',
    'LocalTime': 'LocalTime',
    'UUID': 'UUID'
  };
  
  return typeMap[yamlType] || toPascalCase(yamlType);
}

/**
 * Extract column annotations from annotations array
 * @param {Array} annotations - Annotations from YAML
 * @returns {Object} Parsed column annotations
 */
function extractColumnAnnotations(annotations = []) {
  const columnAnnotation = annotations.find(a => a.includes('@Column'));
  if (!columnAnnotation) return {};
  
  const match = columnAnnotation.match(/@Column\((.*)\)/);
  if (!match) return {};
  
  return { raw: columnAnnotation };
}

/**
 * Generate imports for entity
 * @param {Array} fields - Entity fields
 * @param {Array} relationships - Entity relationships
 * @param {Array} enums - Entity-specific enums
 * @param {Array} aggregateEnums - All enums from aggregate
 * @param {string} packageName - Package name
 * @param {string} moduleName - Module name
 * @returns {Array} Import statements
 */
function generateEntityImports(fields, relationships, enums = [], aggregateEnums = [], packageName = '', moduleName = '', isDomain = false) {
  const imports = new Set();
  
  // Standard JPA imports (only for JPA entities)
  if (!isDomain) {
    imports.add('import jakarta.persistence.*;');
    imports.add('import lombok.*;');
  }
  
  // Field type imports
  fields.forEach(field => {
    if (field.javaType.includes('BigDecimal')) {
      imports.add('import java.math.BigDecimal;');
    }
    if (field.javaType.includes('LocalDate') && !field.javaType.includes('LocalDateTime')) {
      imports.add('import java.time.LocalDate;');
    }
    if (field.javaType.includes('LocalDateTime')) {
      imports.add('import java.time.LocalDateTime;');
    }
    if (field.javaType.includes('LocalTime')) {
      imports.add('import java.time.LocalTime;');
    }
    if (field.javaType.includes('UUID')) {
      imports.add('import java.util.UUID;');
    }
  });
  
  // Enum imports - check if field types match any aggregate enum
  if (packageName && moduleName) {
    const allEnums = [...enums, ...aggregateEnums];
    fields.forEach(field => {
      const matchingEnum = allEnums.find(e => e.name === field.javaType);
      if (matchingEnum) {
        imports.add(`import ${packageName}.${moduleName}.domain.models.enums.${matchingEnum.name};`);
      }
    });
  }
  
  // Collection imports - check both fields and relationships
  if (fields.some(f => f.isCollection) || relationships.some(rel => rel.isCollection)) {
    imports.add('import java.util.List;');
    imports.add('import java.util.ArrayList;');
    imports.add('import java.util.Collections;');
  }
  
  return Array.from(imports).sort();
}

/**
 * Generate validation constraint imports for fields that have validations declared.
 * Returns a single wildcard import when any field has validation annotations.
 * Designed for application-layer command/DTO contexts only.
 * @param {Array} fields - Filtered field list (e.g. commandFields or createFields)
 * @returns {Array} Import statements
 */
function generateValidationImports(fields) {
  const hasValidations = fields.some(f => f.validationAnnotations && f.validationAnnotations.length > 0);
  if (!hasValidations) return [];
  return ['import jakarta.validation.constraints.*;'];
}

/**
 * Generate imports from aggregate method parameters
 * @param {Array} aggregateMethods - Array of aggregate methods
 * @returns {Array} Import statements for parameter types
 */
function generateAggregateMethodImports(aggregateMethods, aggregateEnums = [], packageName = '', moduleName = '') {
  const imports = new Set();
  
  if (!aggregateMethods || aggregateMethods.length === 0) {
    return [];
  }
  
  aggregateMethods.forEach(method => {
    if (method.parameters && method.parameters.length > 0) {
      method.parameters.forEach(param => {
        // Check for date/time types
        if (param.type.includes('LocalDate') && !param.type.includes('LocalDateTime')) {
          imports.add('import java.time.LocalDate;');
        }
        if (param.type.includes('LocalDateTime')) {
          imports.add('import java.time.LocalDateTime;');
        }
        if (param.type.includes('LocalTime')) {
          imports.add('import java.time.LocalTime;');
        }
        if (param.type.includes('Instant')) {
          imports.add('import java.time.Instant;');
        }
        // Check for numeric types
        if (param.type.includes('BigDecimal')) {
          imports.add('import java.math.BigDecimal;');
        }
        // Check for UUID
        if (param.type.includes('UUID')) {
          imports.add('import java.util.UUID;');
        }
        // Check for enum types from aggregate
        if (packageName && moduleName && aggregateEnums.length > 0) {
          const baseType = param.type.replace('List<', '').replace('>', '');
          const matchingEnum = aggregateEnums.find(e => e.name === baseType);
          if (matchingEnum) {
            imports.add(`import ${packageName}.${moduleName}.domain.models.enums.${matchingEnum.name};`);
          }
        }
      });
    }
  });
  
  return Array.from(imports).sort();
}

/**
 * Generate imports for value object
 * @param {Array} fields - Value object fields
 * @param {Array} methods - Value object methods
 * @param {Array} aggregateEnums - Aggregate enums for import detection
 * @param {String} packageName - Package name
 * @param {String} moduleName - Module name
 * @returns {Array} Import statements
 */
function generateValueObjectImports(fields, methods, aggregateEnums = [], packageName = '', moduleName = '') {
  const imports = new Set();
  
  fields.forEach(field => {
    if (field.javaType.includes('BigDecimal')) {
      imports.add('import java.math.BigDecimal;');
    }
    if (field.javaType.includes('LocalDate')) {
      imports.add('import java.time.LocalDate;');
    }
    if (field.javaType.includes('LocalDateTime')) {
      imports.add('import java.time.LocalDateTime;');
    }
    
    // Enum imports - check if field type matches any aggregate enum
    if (packageName && moduleName && aggregateEnums.length > 0) {
      const matchingEnum = aggregateEnums.find(e => e.name === field.javaType);
      if (matchingEnum) {
        imports.add(`import ${packageName}.${moduleName}.domain.models.enums.${matchingEnum.name};`);
      }
    }
  });
  
  // Collection imports
  if (fields.some(f => f.isCollection)) {
    imports.add('import java.util.List;');
    imports.add('import java.util.ArrayList;');
  }
  
  return Array.from(imports).sort();
}

/**
 * Build a map of valid transitions per state.
 * @param {Array} transitions - Transitions from YAML
 * @param {Array} values - All enum values
 * @returns {Object} Map { STATE: [ALLOWED_TARGETS] }
 */
function buildTransitionMap(transitions, values) {
  const map = {};
  values.forEach(v => { map[v] = []; });
  transitions.forEach(t => {
    const froms = Array.isArray(t.from) ? t.from : [t.from];
    froms.forEach(f => {
      if (!map[f]) map[f] = [];
      if (!map[f].includes(t.to)) map[f].push(t.to);
    });
  });
  return map;
}

/**
 * Extract all enums from aggregates (preserving transitions and initialValue).
 * @param {Array} aggregates - Aggregates array from YAML
 * @returns {Array} All unique enums
 */
function extractAllEnums(aggregates) {
  const enumsMap = new Map();
  
  aggregates.forEach(aggregate => {
    // Extract enums from aggregate-level enums section
    if (aggregate.enums && Array.isArray(aggregate.enums)) {
      aggregate.enums.forEach(enumDef => {
        const enumName = toPascalCase(enumDef.name);
        if (!enumsMap.has(enumName)) {
          enumsMap.set(enumName, {
            name: enumName,
            values: enumDef.values,
            transitions: enumDef.transitions || null,
            initialValue: enumDef.initialValue || null
          });
        }
      });
    }
    
    // Extract enums from entity properties/fields
    aggregate.entities?.forEach(entity => {
      const entityFields = entity.properties || entity.fields || [];
      entityFields.forEach(prop => {
        if (prop.enumValues && Array.isArray(prop.enumValues)) {
          const enumName = toPascalCase(prop.type);
          if (!enumsMap.has(enumName)) {
            enumsMap.set(enumName, {
              name: enumName,
              values: prop.enumValues
            });
          }
        }
      });
    });
  });
  
  return Array.from(enumsMap.values());
}

/**
 * Parse the optional endpoints section from domain.yaml.
 * When present, controls which use cases and versioned controllers are generated.
 * @param {Object} domainData - Raw parsed YAML data
 * @returns {Object|null} Parsed endpoints structure or null if not declared
 */
function parseEndpoints(domainData) {
  if (!domainData.endpoints) return null;
  const { basePath = '/', versions = [] } = domainData.endpoints;
  return {
    basePath,
    versions: versions.map(v => ({
      version: v.version,
      operations: (v.operations || []).map(op => {
        const method = (op.method || 'GET').toUpperCase();
        return {
          method,
          path: op.path || '/',
          description: op.description || '',
          useCase: toPascalCase(op.useCase),
          type: method === 'GET' ? 'query' : 'command'
        };
      })
    }))
  };
}

/**
 * Parse the optional listeners section from domain.yaml.
 * Declares integration events this module CONSUMES from external producers.
 * @param {Object} domainData - Raw parsed YAML data
 * @returns {Array} Parsed listeners array (empty if not declared)
 */
function parseListeners(domainData) {
  if (!domainData.listeners || !Array.isArray(domainData.listeners)) return [];
  return domainData.listeners.map(listener => {
    const eventName = toPascalCase(listener.event);
    // Normalise: strip trailing 'Event' suffix for class naming, re-add it consistently
    const baseName = eventName.endsWith('Event') ? eventName.slice(0, -5) : eventName;
    const integrationEventClassName = `${baseName}IntegrationEvent`;
    // e.g. PaymentApprovedKafkaListener
    const listenerClassName = `${baseName}KafkaListener`;
    const useCaseName = toPascalCase(listener.useCase);
    const commandClassName = `${useCaseName}Command`;
    const topic = listener.topic || null;
    const fields = (listener.fields || []).map(f => ({
      name: toCamelCase(f.name),
      javaType: f.type
    }));
    const nestedTypes = (listener.nestedTypes || []).map(nt => ({
      name: toPascalCase(nt.name),
      fields: (nt.fields || []).map(f => ({
        name: toCamelCase(f.name),
        javaType: f.type
      }))
    }));
    return {
      event: eventName,
      baseName,
      producer: listener.producer || null,
      topic,
      useCase: useCaseName,
      commandClassName,
      integrationEventClassName,
      listenerClassName,
      fields,
      nestedTypes
    };
  });
}

/**
 * Derive a domain model type name from a method name.
 * Strips common verb prefixes and 'ById/ByName/...' suffixes so that
 * 'findCustomerById' → 'Customer', 'processPayment' → 'Payment'.
 * @param {string} methodName  camelCase method name
 * @returns {string} PascalCase domain model name
 */
function deriveDomainType(methodName) {
  let name = toPascalCase(methodName);

  // Strip verb prefix
  name = name.replace(
    /^(Find|Get|Fetch|Search|Retrieve|List|Check|Process|Create|Update|Delete|Cancel|Submit|Execute)/,
    ''
  );

  // Strip trailing 'By{Something}' (e.g. ById, ByName, ByCode)
  name = name.replace(/By[A-Z][a-zA-Z0-9]*$/, '');

  // Strip common informational suffixes
  name = name.replace(/(?:Status|Availability|All)$/, '');

  // Fall back to full PascalCase method name if we stripped everything
  return name || toPascalCase(methodName);
}

/**
 * Parse the optional ports section from domain.yaml.
 * Declares HTTP services this module CALLS synchronously (Feign clients).
 * Entries sharing the same service: are grouped into a single FeignClient.
 * @param {Object} domainData - Raw parsed YAML data
 * @param {string} moduleName - Module name (used for property key naming)
 * @returns {Array} Parsed port service groups (empty if not declared)
 */
function parsePorts(domainData, moduleName = '') {
  if (!domainData.ports || !Array.isArray(domainData.ports)) return [];

  const serviceMap = new Map();

  for (const entry of domainData.ports) {
    if (!entry.service || !entry.name) continue;

    const serviceName = toPascalCase(entry.service);
    const methodName  = toCamelCase(entry.name);
    const methodPascal = toPascalCase(entry.name);

    // Parse HTTP verb + path
    const httpParts = (entry.http || 'GET /').trim().split(/\s+/);
    const httpVerb  = (httpParts[0] || 'GET').toUpperCase();
    const httpPath  = httpParts[1] || '/';

    // Extract path variables: /screenings/{id}/seats → ['id']
    const pathVarMatches = httpPath.match(/\{(\w+)\}/g) || [];
    const pathVariables  = pathVarMatches.map(pv => pv.slice(1, -1));

    // Response fields
    const responseFields = (entry.fields || []).map(f => ({
      name: toCamelCase(f.name),
      javaType: f.type
    }));

    // Body fields (POST/PUT/PATCH only)
    const bodyAllowed = httpVerb !== 'GET' && httpVerb !== 'DELETE';
    const bodyFields  = bodyAllowed
      ? (entry.body || []).map(f => ({ name: toCamelCase(f.name), javaType: f.type }))
      : [];

    // nestedTypes per method
    const nestedTypes = (entry.nestedTypes || []).map(nt => ({
      name: toPascalCase(nt.name),
      fields: (nt.fields || []).map(f => ({
        name: toCamelCase(f.name),
        javaType: f.type
      }))
    }));

    const returnList      = entry.returnList === true;
    const hasResponse     = responseFields.length > 0;
    const hasBody         = bodyFields.length > 0;
    // ACL: infra DTO name (lives in infrastructure/adapters/{service}/)
    const infraDtoName    = hasResponse ? `${methodPascal}Dto` : null;
    // Domain model type (lives in domain/models/)
    const domainType      = hasResponse
      ? (entry.domainType ? toPascalCase(entry.domainType) : deriveDomainType(entry.name))
      : null;
    // Keep responseDtoName as alias to infraDtoName for backward-compat
    const responseDtoName = infraDtoName;
    const requestDtoName  = hasBody ? `${methodPascal}RequestDto` : null;

    const method = {
      name: methodName,
      namePascal: methodPascal,
      httpVerb,
      httpPath,
      pathVariables,
      fields: responseFields,
      bodyFields,
      nestedTypes,
      returnList,
      hasResponse,
      hasBody,
      infraDtoName,
      domainType,
      responseDtoName,
      requestDtoName
    };

    if (!serviceMap.has(serviceName)) {
      serviceMap.set(serviceName, {
        serviceName,
        serviceNameCamelCase: toCamelCase(serviceName),
        target: entry.target || null,
        baseUrl: entry.baseUrl || null,
        methods: [],
        nestedTypes: [],
        domainModels: []  // ACL: unique domain models per service group
      });
    }

    const group = serviceMap.get(serviceName);
    group.methods.push(method);

    // Keep baseUrl from the first entry that declares it
    if (entry.baseUrl && !group.baseUrl) {
      group.baseUrl = entry.baseUrl;
    }

    // Deduplicate nestedTypes within the service group
    for (const nt of nestedTypes) {
      if (!group.nestedTypes.some(existing => existing.name === nt.name)) {
        group.nestedTypes.push(nt);
      }
    }

    // ACL: collect unique domain models (by name) across all methods in this service
    if (method.domainType && method.hasResponse) {
      if (!group.domainModels.some(dm => dm.name === method.domainType)) {
        group.domainModels.push({
          name: method.domainType,
          fields: method.fields
        });
      }
    }
  }

  const moduleKebab = toKebabCase(moduleName);

  return Array.from(serviceMap.values()).map(group => {
    const serviceKebab = toKebabCase(group.serviceName);
    return {
      ...group,
      baseUrl: group.baseUrl || 'http://localhost:8080',
      baseUrlProperty: `${moduleKebab}.${serviceKebab}.base-url`,
      feignClientName: `${moduleKebab}-${serviceKebab}`,
      feignClientClassName:  `${group.serviceName}FeignClient`,
      feignAdapterClassName: `${group.serviceName}FeignAdapter`,
      feignConfigClassName:  `${group.serviceName}FeignConfig`,
      adapterPackage: group.serviceNameCamelCase
    };
  });
}

/**
 * Derive a Kafka topic name from an event class name.
 * Strips trailing 'Event' suffix, then converts to SCREAMING_SNAKE_CASE.
 * e.g. 'ProductCreatedEvent' → 'PRODUCT_CREATED'
 *      'OrderCancelled'      → 'ORDER_CANCELLED'
 * @param {string} eventName - PascalCase event name
 * @returns {string} SCREAMING_SNAKE_CASE topic name
 */
function deriveTopicFromEventName(eventName) {
  const base = eventName.endsWith('Event') ? eventName.slice(0, -5) : eventName;
  // PascalCase → SCREAMING_SNAKE_CASE
  return base
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

/**
 * Parse the optional readModels section from domain.yaml.
 * Declares local read model projections maintained via domain events
 * from external bounded contexts.
 * @param {Object} domainData - Raw parsed YAML data
 * @param {string} moduleName - Current module name
 * @param {Array} ports - Parsed ports (for RM-009 warning)
 * @returns {Array} Parsed read models array (empty if not declared)
 */
function parseReadModels(domainData, moduleName = '', ports = []) {
  if (!domainData.readModels || !Array.isArray(domainData.readModels)) return [];

  const validActions = ['UPSERT', 'DELETE', 'SOFT_DELETE'];

  return domainData.readModels.map(rm => {
    const name = toPascalCase(rm.name);

    // RM-001: name must end with 'ReadModel'
    if (!name.endsWith('ReadModel')) {
      throw new Error(
        `[RM-001] Read model "${name}": name must end with "ReadModel" suffix. ` +
        `Rename to "${name}ReadModel".`
      );
    }

    // RM-002: tableName must start with 'rm_'
    if (!rm.tableName || !rm.tableName.startsWith('rm_')) {
      throw new Error(
        `[RM-002] Read model "${name}": tableName must start with "rm_" prefix. ` +
        `Got: "${rm.tableName || '(empty)'}".`
      );
    }

    // Source is required
    if (!rm.source || !rm.source.module || !rm.source.aggregate) {
      throw new Error(
        `[RM-010] Read model "${name}": source.module and source.aggregate are required.`
      );
    }

    // RM-010: source.module must differ from current module
    if (rm.source.module === moduleName || toKebabCase(rm.source.module) === toKebabCase(moduleName)) {
      throw new Error(
        `[RM-010] Read model "${name}": source.module ("${rm.source.module}") is the same as the current module. ` +
        `Read models are for cross-module projections only.`
      );
    }

    // Parse fields
    const fields = (rm.fields || []).map(f => ({
      name: toCamelCase(f.name),
      javaType: f.type
    }));

    // RM-004: fields must include an 'id' field
    if (!fields.some(f => f.name === 'id')) {
      throw new Error(
        `[RM-004] Read model "${name}": fields must include an "id" field.`
      );
    }

    // Parse syncedBy
    const syncedBy = rm.syncedBy || [];

    // RM-005: syncedBy must have at least one entry
    if (syncedBy.length === 0) {
      throw new Error(
        `[RM-005] Read model "${name}": syncedBy must have at least one entry.`
      );
    }

    const parsedSyncedBy = syncedBy.map(sync => {
      const eventName = toPascalCase(sync.event);
      const action = (sync.action || '').toUpperCase();

      // RM-006: action must be valid
      if (!validActions.includes(action)) {
        throw new Error(
          `[RM-006] Read model "${name}", event "${eventName}": ` +
          `syncedBy action must be one of ${validActions.join(', ')}. Got: "${action}".`
        );
      }

      const baseName = eventName.endsWith('Event') ? eventName.slice(0, -5) : eventName;
      const topic = sync.topic || deriveTopicFromEventName(eventName);
      const topicKey = topic.toLowerCase().replace(/_/g, '-');

      return {
        event: eventName,
        eventBaseName: baseName,
        action,
        integrationEventClassName: `${baseName}IntegrationEvent`,
        listenerClassName: `${baseName}ReadModelListener`,
        topicConstant: topic,
        topicKey,
        topicSpringProperty: `\${topics.${topicKey}}`,
        topicVariableName: toCamelCase(topicKey.replace(/-/g, '_')),
        fields // pass readModel fields to each sync entry for the listener templates
      };
    });

    const hasSoftDelete = parsedSyncedBy.some(s => s.action === 'SOFT_DELETE');
    const sourceName = toPascalCase(rm.source.aggregate);
    const sourceModule = rm.source.module;

    // RM-009: warn if ports still has sync calls to the same source module
    const conflictingPorts = ports.filter(p =>
      p.target && (p.target === sourceModule || toKebabCase(p.target) === toKebabCase(sourceModule))
    );
    if (conflictingPorts.length > 0) {
      const serviceNames = conflictingPorts.map(p => p.serviceName).join(', ');
      console.warn(
        `⚠️  [RM-009] Read model "${name}": ports: section still contains sync calls ` +
        `to module "${sourceModule}" (services: ${serviceNames}). Consider removing them ` +
        `since the read model provides local access to that data.`
      );
    }

    return {
      name,
      sourceName,
      sourceModule,
      tableName: rm.tableName,
      fields,
      syncedBy: parsedSyncedBy,
      hasSoftDelete,
      // Derived class names
      domainClassName: name,
      jpaEntityName: `${name}Jpa`,
      jpaRepositoryName: `${name}JpaRepository`,
      repositoryName: `${name}Repository`,
      repositoryImplName: `${name}RepositoryImpl`,
      syncHandlerName: `Sync${sourceName}ReadModelHandler`
    };
  });
}

/**
 * Resolve event constructor arguments for a domain event given entity context.
 * Replicates the same resolution logic used in AggregateRoot.java.ejs for transitions.
 *
 * @param {Object} event - Parsed domain event { name, fields }
 * @param {string} entityName - PascalCase aggregate root name (e.g. 'Product')
 * @param {Array}  entityFields - Parsed fields of the root entity
 * @param {Array}  valueObjects - Parsed value objects of the aggregate
 * @param {string} prefix - Expression prefix for getters (e.g. 'this' or 'updated' or 'entity')
 * @returns {Object} { args: string[], needsLocalDateTime: boolean, needsUUID: boolean }
 */
function resolveEventArgs(event, entityName, entityFields, valueObjects = [], prefix = 'this') {
  const entityBase = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  const args = [`${prefix}.getId()`];
  let needsLocalDateTime = false;
  let needsUUID = false;

  (event.fields || []).forEach(ef => {
    // Skip {entityName}Id — already provided as aggregateId in the DomainEvent constructor
    if (ef.name === entityBase + 'Id') return;

    const matched = entityFields.find(f => f.name === ef.name);
    if (matched) {
      if (matched.javaType === ef.javaType) {
        const cap = ef.name.charAt(0).toUpperCase() + ef.name.slice(1);
        args.push(`${prefix}.get${cap}()`);
        return;
      }
      // Type mismatch: entity field may be a VO wrapping the expected primitive/type
      const vo = (valueObjects || []).find(v => v.name === matched.javaType);
      if (vo) {
        const voSub = vo.fields.find(voF => voF.name === ef.name && voF.javaType === ef.javaType)
                    || vo.fields.find(voF => voF.javaType === ef.javaType);
        if (voSub) {
          const oCap = ef.name.charAt(0).toUpperCase() + ef.name.slice(1);
          const sCap = voSub.name.charAt(0).toUpperCase() + voSub.name.slice(1);
          args.push(`${prefix}.get${oCap}().get${sCap}()`);
          return;
        }
      }
      // Enum → String: convert via .name()
      if (matched.isEnum && ef.javaType === 'String') {
        const cap = ef.name.charAt(0).toUpperCase() + ef.name.slice(1);
        args.push(`${prefix}.get${cap}().name()`);
        return;
      }
      args.push(`null /* TODO: provide ${ef.name} (entity returns ${matched.javaType}, expected ${ef.javaType}) */`);
      return;
    }
    if (ef.name.endsWith('At') && ef.javaType === 'LocalDateTime') {
      args.push('LocalDateTime.now()');
      needsLocalDateTime = true;
      return;
    }
    args.push(`null /* TODO: provide ${ef.name} */`);
  });

  return { args, needsLocalDateTime, needsUUID };
}

/**
 * Pre-compute resolved arguments for all lifecycle events.
 * Returns an enriched lifecycleEventsMap where each event has a `resolvedArgs` array.
 *
 * @param {Object} lifecycleEventsMap - { create: [event, ...], update: [...], ... }
 * @param {string} entityName - PascalCase aggregate root name
 * @param {Array}  entityFields - Parsed fields of the root entity
 * @param {Array}  valueObjects - Parsed value objects of the aggregate
 * @returns {Object} enriched map: { create: [{ ...event, resolvedArgs, needsLocalDateTime }], ... }
 */
function resolveLifecycleEventArgs(lifecycleEventsMap, entityName, entityFields, valueObjects = []) {
  const resolved = {};
  // Each lifecycle type uses a different variable name in the generated code
  const prefixMap = { create: 'this', update: 'updated', delete: 'entity', softDelete: 'this' };
  for (const [lifecycle, events] of Object.entries(lifecycleEventsMap)) {
    const prefix = prefixMap[lifecycle] || 'this';
    resolved[lifecycle] = events.map(event => {
      const { args, needsLocalDateTime } = resolveEventArgs(event, entityName, entityFields, valueObjects, prefix);
      return { ...event, resolvedArgs: args, needsLocalDateTime };
    });
  }
  return resolved;
}

module.exports = {
  parseDomainYaml,
  parseAggregate,
  parseEntity,
  parseValueObject,
  generateAggregateMethods,
  generateEntityImports,
  generateValidationImports,
  generateAggregateMethodImports,
  parseListeners,
  parsePorts,
  parseReadModels,
  resolveEventArgs,
  resolveLifecycleEventArgs
};
