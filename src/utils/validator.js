const fs = require('fs-extra');
const path = require('path');

/**
 * Validate project name
 * @param {string} name - Project name
 * @returns {boolean|string} True if valid, error message otherwise
 */
function validateProjectName(name) {
  if (!name || name.trim() === '') {
    return 'Project name cannot be empty';
  }
  
  if (!/^[a-z0-9-]+$/.test(name)) {
    return 'Project name must contain only lowercase letters, numbers, and hyphens';
  }
  
  if (name.startsWith('-') || name.endsWith('-')) {
    return 'Project name cannot start or end with a hyphen';
  }
  
  if (name.length < 2) {
    return 'Project name must be at least 2 characters long';
  }
  
  return true;
}

/**
 * Validate group ID (Java package naming convention)
 * @param {string} groupId - Group ID
 * @returns {boolean|string} True if valid, error message otherwise
 */
function validateGroupId(groupId) {
  if (!groupId || groupId.trim() === '') {
    return 'Group ID cannot be empty';
  }
  
  const parts = groupId.split('.');
  
  if (parts.length < 2) {
    return 'Group ID must have at least 2 parts (e.g., com.company)';
  }
  
  for (const part of parts) {
    if (!/^[a-z][a-z0-9]*$/.test(part)) {
      return 'Each part of Group ID must start with a lowercase letter and contain only lowercase letters and numbers';
    }
  }
  
  return true;
}

/**
 * Validate module name
 * @param {string} name - Module name
 * @returns {boolean|string} True if valid, error message otherwise
 */
function validateModuleName(name) {
  if (!name || name.trim() === '') {
    return 'Module name cannot be empty';
  }
  
  if (!/^[a-z][a-z0-9]*$/.test(name)) {
    return 'Module name must start with a lowercase letter and contain only lowercase letters and numbers';
  }
  
  if (name.length < 2) {
    return 'Module name must be at least 2 characters long';
  }
  
  // Reserved names
  const reserved = ['common', 'shared', 'config', 'util', 'test'];
  if (reserved.includes(name)) {
    return `Module name '${name}' is reserved and cannot be used`;
  }
  
  return true;
}

/**
 * Check if current directory is a valid eva4j project
 * @param {string} dir - Directory path
 * @returns {boolean} True if valid project
 */
async function isEva4jProject(dir) {
  const buildGradlePath = path.join(dir, 'build.gradle');
  
  if (!await fs.pathExists(buildGradlePath)) {
    return false;
  }
  
  // Check if build.gradle contains Spring Boot plugin
  const content = await fs.readFile(buildGradlePath, 'utf-8');
  return content.includes('org.springframework.boot');
}

/**
 * Check if module already exists
 * @param {string} projectDir - Project directory
 * @param {string} packagePath - Package path
 * @param {string} moduleName - Module name
 * @returns {boolean} True if module exists
 */
async function moduleExists(projectDir, packagePath, moduleName) {
  const modulePath = path.join(projectDir, 'src', 'main', 'java', packagePath, moduleName);
  return await fs.pathExists(modulePath);
}

/**
 * Check if shared module exists
 * @param {string} projectDir - Project directory
 * @param {string} packagePath - Package path
 * @returns {boolean} True if shared module exists
 */
async function sharedModuleExists(projectDir, packagePath) {
  const sharedPath = path.join(projectDir, 'src', 'main', 'java', packagePath, 'shared');
  return await fs.pathExists(sharedPath);
}

/**
 * Validate Java version
 * @param {number} version - Java version
 * @returns {boolean} True if valid
 */
function validateJavaVersion(version) {
  const validVersions = [21, 22, 23];
  return validVersions.includes(version);
}

/**
 * Validate port number
 * @param {number} port - Port number
 * @returns {boolean|string} True if valid, error message otherwise
 */
function validatePort(port) {
  const portNum = parseInt(port, 10);
  
  if (isNaN(portNum)) {
    return 'Port must be a number';
  }
  
  if (portNum < 1024 || portNum > 65535) {
    return 'Port must be between 1024 and 65535';
  }
  
  return true;
}

module.exports = {
  validateProjectName,
  validateGroupId,
  validateModuleName,
  isEva4jProject,
  moduleExists,
  sharedModuleExists,
  validateJavaVersion,
  validatePort
};
