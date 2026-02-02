const pluralize = require('pluralize');
const { toPascalCase, toCamelCase } = require('./naming');

/**
 * Parse JSON and extract all records (main + nested)
 * @param {object|string} json - JSON object or string
 * @param {string} mainRecordName - Name for the main record
 * @returns {Object} { mainRecord, nestedRecords, allRecords }
 */
function parseJsonToRecords(json, mainRecordName) {
  let obj = typeof json === 'string' ? JSON.parse(json) : json;
  
  // If the JSON is an array, use the first element as the template
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      throw new Error('Cannot generate record from empty array');
    }
    obj = obj[0]; // Use first element as template
  }
  
  const nestedRecords = new Map(); // Map to store nested record definitions
  const processedTypes = new Set(); // Avoid duplicate nested records
  
  // Parse main record fields
  const mainFields = parseFields(obj, mainRecordName, nestedRecords, processedTypes);
  
  const mainRecord = {
    name: toPascalCase(mainRecordName),
    fields: mainFields,
    imports: generateImportsForFields(mainFields),
    jsonExample: JSON.stringify(obj, null, 2)
  };
  
  // Convert nested records map to array
  const nestedRecordsArray = Array.from(nestedRecords.values());
  
  return {
    mainRecord,
    nestedRecords: nestedRecordsArray,
    allRecords: [mainRecord, ...nestedRecordsArray]
  };
}

/**
 * Parse object fields and detect nested structures
 * @param {object} obj - Object to parse
 * @param {string} parentName - Parent record name for context
 * @param {Map} nestedRecords - Map to store nested record definitions
 * @param {Set} processedTypes - Set of already processed type names
 * @returns {Array} Array of field definitions
 */
function parseFields(obj, parentName, nestedRecords, processedTypes) {
  const fields = [];
  
  for (const [key, value] of Object.entries(obj)) {
    const field = parseField(key, value, parentName, nestedRecords, processedTypes);
    fields.push(field);
  }
  
  return fields;
}

/**
 * Parse a single field and determine its Java type
 * @param {string} key - Field name
 * @param {*} value - Field value
 * @param {string} parentName - Parent record name
 * @param {Map} nestedRecords - Map to store nested record definitions
 * @param {Set} processedTypes - Set of already processed type names
 * @returns {Object} Field definition
 */
function parseField(key, value, parentName, nestedRecords, processedTypes) {
  const fieldName = toCamelCase(key);
  const isNullable = value === null;
  const isArray = Array.isArray(value);
  
  // Handle null values
  if (value === null) {
    return {
      name: fieldName,
      originalKey: key,
      javaType: 'Object',
      isNullable: true,
      isArray: false,
      isNestedRecord: false
    };
  }
  
  // Handle arrays
  if (isArray) {
    if (value.length === 0) {
      return {
        name: fieldName,
        originalKey: key,
        javaType: 'List<Object>',
        isNullable: false,
        isArray: true,
        isNestedRecord: false
      };
    }
    
    const firstElement = value[0];
    
    // Array of objects - create nested record
    if (typeof firstElement === 'object' && firstElement !== null && !Array.isArray(firstElement)) {
      const singularName = pluralize.singular(key);
      const recordName = toPascalCase(singularName);
      
      // Only process if not already processed
      if (!processedTypes.has(recordName)) {
        processedTypes.add(recordName);
        const nestedFields = parseFields(firstElement, recordName, nestedRecords, processedTypes);
        
        nestedRecords.set(recordName, {
          name: recordName,
          fields: nestedFields,
          imports: generateImportsForFields(nestedFields),
          jsonExample: JSON.stringify(firstElement, null, 2)
        });
      }
      
      return {
        name: fieldName,
        originalKey: key,
        javaType: `List<${recordName}>`,
        isNullable: false,
        isArray: true,
        isNestedRecord: true,
        nestedRecordName: recordName
      };
    }
    
    // Array of primitives
    const elementType = inferJavaType(firstElement, key);
    return {
      name: fieldName,
      originalKey: key,
      javaType: `List<${elementType}>`,
      isNullable: false,
      isArray: true,
      isNestedRecord: false
    };
  }
  
  // Handle nested objects (not arrays)
  if (typeof value === 'object' && !Array.isArray(value)) {
    const recordName = toPascalCase(key);
    
    // Only process if not already processed
    if (!processedTypes.has(recordName)) {
      processedTypes.add(recordName);
      const nestedFields = parseFields(value, recordName, nestedRecords, processedTypes);
      
      nestedRecords.set(recordName, {
        name: recordName,
        fields: nestedFields,
        imports: generateImportsForFields(nestedFields),
        jsonExample: JSON.stringify(value, null, 2)
      });
    }
    
    return {
      name: fieldName,
      originalKey: key,
      javaType: recordName,
      isNullable: false,
      isArray: false,
      isNestedRecord: true,
      nestedRecordName: recordName
    };
  }
  
  // Primitive types
  const javaType = inferJavaType(value, key);
  return {
    name: fieldName,
    originalKey: key,
    javaType,
    isNullable: false,
    isArray: false,
    isNestedRecord: false
  };
}

/**
 * Infer Java type from JavaScript value
 * @param {*} value - Value to analyze
 * @param {string} key - Field name for pattern detection
 * @returns {string} Java type
 */
function inferJavaType(value, key = '') {
  // Check for special patterns first
  const specialType = detectSpecialType(key, value);
  if (specialType) return specialType;
  
  const jsType = typeof value;
  
  switch (jsType) {
    case 'string':
      return 'String';
    case 'number':
      return Number.isInteger(value) ? 'Integer' : 'Double';
    case 'boolean':
      return 'Boolean';
    case 'object':
      if (value === null) return 'Object';
      if (Array.isArray(value)) return 'List<Object>';
      return 'Object';
    default:
      return 'Object';
  }
}

/**
 * Detect special types based on patterns (dates, UUIDs, etc.)
 * @param {string} key - Field name
 * @param {*} value - Field value
 * @returns {string|null} Special Java type or null
 */
function detectSpecialType(key, value) {
  if (typeof value !== 'string') return null;
  
  // ISO DateTime pattern (e.g., "2024-01-01T10:30:00", "2024-01-01T10:30:00.000Z")
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return 'LocalDateTime';
  }
  
  // ISO Date pattern (e.g., "2024-01-01")
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return 'LocalDate';
  }
  
  // UUID pattern
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return 'UUID';
  }
  
  // Time pattern (e.g., "10:30:00")
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) {
    return 'LocalTime';
  }
  
  return null;
}

/**
 * Generate imports needed for a list of fields
 * @param {Array} fields - Array of field definitions
 * @returns {Array} Array of import statements
 */
function generateImportsForFields(fields) {
  const imports = new Set();
  
  fields.forEach(field => {
    const type = field.javaType;
    
    if (type.includes('LocalDateTime')) {
      imports.add('import java.time.LocalDateTime;');
    }
    if (type.includes('LocalDate')) {
      imports.add('import java.time.LocalDate;');
    }
    if (type.includes('LocalTime')) {
      imports.add('import java.time.LocalTime;');
    }
    if (type.includes('UUID')) {
      imports.add('import java.util.UUID;');
    }
    if (type.includes('List<')) {
      imports.add('import java.util.List;');
    }
  });
  
  return Array.from(imports).sort();
}

/**
 * Format fields for Java record parameters
 * @param {Array} fields - Array of field definitions
 * @returns {string} Formatted field parameters
 */
function formatRecordFields(fields) {
  return fields.map((field, index) => {
    const comma = index < fields.length - 1 ? ',' : '';
    return `    ${field.javaType} ${field.name}${comma}`;
  }).join('\n');
}

module.exports = {
  parseJsonToRecords,
  parseFields,
  inferJavaType,
  detectSpecialType,
  generateImportsForFields,
  formatRecordFields
};
