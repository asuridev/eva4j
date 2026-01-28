const pluralize = require('pluralize');

/**
 * Convert string to PascalCase
 * @param {string} str - Input string
 * @returns {string} PascalCase string
 */
function toPascalCase(str) {
  return str
    .replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ''))
    .replace(/^(.)/, (char) => char.toUpperCase());
}

/**
 * Convert string to camelCase
 * @param {string} str - Input string
 * @returns {string} camelCase string
 */
function toCamelCase(str) {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Convert string to snake_case
 * @param {string} str - Input string
 * @returns {string} snake_case string
 */
function toSnakeCase(str) {
  return str
    .replace(/([A-Z])/g, '_$1')
    .replace(/[-\s]+/g, '_')
    .replace(/^_/, '')
    .toLowerCase();
}

/**
 * Convert string to kebab-case
 * @param {string} str - Input string
 * @returns {string} kebab-case string
 */
function toKebabCase(str) {
  return str
    .replace(/([A-Z])/g, '-$1')
    .replace(/[\s_]+/g, '-')
    .replace(/^-/, '')
    .toLowerCase();
}

/**
 * Pluralize a word
 * @param {string} word - Word to pluralize
 * @returns {string} Pluralized word
 */
function pluralizeWord(word) {
  return pluralize(word);
}

/**
 * Convert package name to path
 * @param {string} packageName - Package name (e.g., com.company.project)
 * @returns {string} Package path (e.g., com/company/project)
 */
function toPackagePath(packageName) {
  return packageName.replace(/\./g, '/');
}

/**
 * Get base entity class based on flags
 * @param {boolean} hasSoftDelete - Whether to use soft delete
 * @param {boolean} hasAudit - Whether to use audit fields
 * @returns {string} Base entity class name
 */
function getBaseEntity(hasSoftDelete, hasAudit) {
  if (hasSoftDelete) {
    return 'SoftDeletableEntity';
  }
  if (hasAudit) {
    return 'AuditableEntity';
  }
  return 'BaseEntity';
}

/**
 * Convert artifact ID to valid Java package name
 * @param {string} artifactId - Artifact ID (e.g., my-project)
 * @returns {string} Valid package name (e.g., myproject)
 */
function artifactIdToPackageName(artifactId) {
  return artifactId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Generate application class name from artifact ID
 * @param {string} artifactId - Artifact ID (e.g., my-project)
 * @returns {string} Application class name (e.g., MyProjectApplication)
 */
function getApplicationClassName(artifactId) {
  return toPascalCase(artifactId) + 'Application';
}

/**
 * Get full package name
 * @param {string} groupId - Group ID (e.g., com.company)
 * @param {string} artifactId - Artifact ID (e.g., my-project)
 * @returns {string} Full package name (e.g., com.company.myproject)
 */
function getFullPackageName(groupId, artifactId) {
  const packagePart = artifactIdToPackageName(artifactId);
  return `${groupId}.${packagePart}`;
}

module.exports = {
  toPascalCase,
  toCamelCase,
  toSnakeCase,
  toKebabCase,
  pluralizeWord,
  toPackagePath,
  getBaseEntity,
  artifactIdToPackageName,
  getApplicationClassName,
  getFullPackageName
};
