const yaml = require('js-yaml');
const fs = require('fs-extra');
const pluralize = require('pluralize');
const { toPascalCase, toCamelCase, toSnakeCase } = require('./naming');

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
  
  return {
    aggregates,
    allEnums: extractAllEnums(domainData.aggregates)
  };
}

/**
 * Parse a single aggregate
 * @param {Object} aggregateData - Aggregate data from YAML
 * @returns {Object} Parsed aggregate with entities and value objects
 */
function parseAggregate(aggregateData) {
  const { name, entities = [], valueObjects = [], enums = [], packageName = '', moduleName = '' } = aggregateData;
  
  // Find the aggregate root
  const rootEntity = entities.find(e => e.isRoot === true);
  if (!rootEntity) {
    throw new Error(`Aggregate "${name}" must have one entity with isRoot: true`);
  }
  
  // Parse aggregate-level enums
  const aggregateEnums = enums.map(e => ({
    name: toPascalCase(e.name),
    values: e.values
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
  
  return {
    name: toPascalCase(name),
    packageName: aggregateData.package || '',
    rootEntity: parsedRoot,
    secondaryEntities,
    valueObjects: parsedValueObjects,
    aggregateMethods,
    allEntities: parsedEntities
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
  const { name, isRoot = false, tableName, properties, fields: fieldsYaml, relationships = [], auditable = false, audit } = entityData;
  
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
function parseProperty(propData, valueObjectNames = [], aggregateEnums = []) {
  const { name, type, annotations = [], isValueObject = false, isEmbedded = false, enumValues } = propData;
  
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
    columnAnnotations: extractColumnAnnotations(annotations)
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
        // Extract fields for parameters (exclude id, audit fields, inverse relationships)
        const paramFields = secondaryEntity.fields.filter(f => 
          f.name !== 'id' && 
          f.name !== 'createdAt' && 
          f.name !== 'updatedAt' && 
          f.name !== 'createdBy' && 
          f.name !== 'updatedBy'
        );
        
        // Filter out inverse relationships
        const paramRelationships = (secondaryEntity.relationships || []).filter(r => !r.isInverse);
        
        // Generate parameters array
        const parameters = paramFields.map(f => ({
          name: f.name,
          type: f.javaType
        }));
        
        // Add non-inverse relationships as parameters
        paramRelationships.forEach(r => {
          if (!r.isCollection) {
            parameters.push({
              name: r.fieldName,
              type: r.javaType
            });
          }
        });
        
        // Generate constructor arguments string
        const constructorArgs = parameters.map(p => p.name).join(', ');
        
        // Generate method body that creates entity and adds it
        const methodBody = `${entityName} entity = new ${entityName}(${constructorArgs});
        this.${rel.fieldName}.add(entity);`;
        
        // add method with parameters (factory method)
        methods.push({
          name: `add${toPascalCase(singularName)}`,
          returnType: 'void',
          parameters: parameters,
          body: methodBody,
          isFactory: true
        });
        
        // add method with entity (for complex cases and mappers)
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
        // Extract fields for parameters (exclude id, audit fields, inverse relationships)
        const paramFields = secondaryEntity.fields.filter(f => 
          f.name !== 'id' && 
          f.name !== 'createdAt' && 
          f.name !== 'updatedAt' && 
          f.name !== 'createdBy' && 
          f.name !== 'updatedBy'
        );
        
        // Filter out inverse relationships
        const paramRelationships = (secondaryEntity.relationships || []).filter(r => !r.isInverse);
        
        // Generate parameters array
        const parameters = paramFields.map(f => ({
          name: f.name,
          type: f.javaType
        }));
        
        // Add non-inverse relationships as parameters
        paramRelationships.forEach(r => {
          if (!r.isCollection) {
            parameters.push({
              name: r.fieldName,
              type: r.javaType
            });
          }
        });
        
        // Generate constructor arguments string
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
 * Extract all enums from aggregates
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
            values: enumDef.values
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

module.exports = {
  parseDomainYaml,
  parseAggregate,
  parseEntity,
  parseValueObject,
  generateAggregateMethods,
  generateEntityImports
};
