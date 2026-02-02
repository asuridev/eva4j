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
  const parsedValueObjects = valueObjects.map(vo => parseValueObject(vo));
  const valueObjectNames = parsedValueObjects.map(vo => vo.name);
  
  // Parse entities with value object detection
  const parsedEntities = entities.map(entity => parseEntity(entity, name, packageName, moduleName, aggregateEnums, valueObjectNames));
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
 * @returns {Object} Parsed entity
 */
function parseEntity(entityData, aggregateName, packageName = '', moduleName = '', aggregateEnums = [], valueObjectNames = []) {
  const { name, isRoot = false, tableName, properties, fields: fieldsYaml, relationships = [] } = entityData;
  
  // Accept both 'properties' and 'fields' field names
  const entityFields = properties || fieldsYaml || [];
  
  const className = toPascalCase(name);
  const fieldName = toCamelCase(name);
  const table = tableName || toSnakeCase(pluralize(name));
  
  // Parse properties/fields with value object detection
  const fields = entityFields.map(prop => parseProperty(prop, valueObjectNames));
  
  // Parse relationships
  const relations = relationships.map(rel => parseRelationship(rel, className));
  
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
 * @returns {Object} Parsed property
 */
function parseProperty(propData, valueObjectNames = []) {
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
    isEnum: !!enumValues,
    isCollection,
    collectionElementType,
    columnAnnotations: extractColumnAnnotations(annotations)
  };
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
 * @returns {Object} Parsed value object
 */
function parseValueObject(voData) {
  const { name, properties, fields: fieldsYaml, methods = [], validation = [] } = voData;
  
  // Accept both 'properties' and 'fields' field names
  const voFields = properties || fieldsYaml || [];
  
  const className = toPascalCase(name);
  const fields = voFields.map(prop => parseProperty(prop));
  const parsedMethods = methods.map(method => parseMethod(method));
  
  return {
    name: className,
    fields,
    methods: parsedMethods,
    validation,
    imports: generateValueObjectImports(fields, parsedMethods)
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
      
      // add method
      methods.push({
        name: `add${toPascalCase(singularName)}`,
        returnType: 'void',
        parameters: [{
          name: toCamelCase(singularName),
          type: entityName
        }],
        body: `this.${rel.fieldName}.add(${toCamelCase(singularName)});`
      });
      
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
  
  // Relationship imports
  if (relationships.some(rel => rel.isCollection)) {
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
 * @returns {Array} Import statements
 */
function generateValueObjectImports(fields, methods) {
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
  });
  
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
