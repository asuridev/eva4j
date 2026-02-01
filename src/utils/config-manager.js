const fs = require('fs-extra');
const path = require('path');

class ConfigManager {
  constructor(projectPath = process.cwd()) {
    this.projectPath = projectPath;
    this.configFile = path.join(projectPath, '.eva4j.json');
  }

  /**
   * Save project configuration to .eva4j.json
   * @param {Object} config - Project configuration
   * @param {string} config.projectName - Name of the project
   * @param {string} config.groupId - Maven group ID
   * @param {string} config.artifactId - Maven artifact ID
   * @param {string} config.packageName - Base package name
   * @param {string} config.javaVersion - Java version
   * @param {string} config.springBootVersion - Spring Boot version
   * @param {string} config.springModulithVersion - Spring Modulith version
   * @param {Array<string>} config.dependencies - Selected dependencies
   * @param {string} config.createdAt - ISO timestamp of creation
   */
  async saveProjectConfig(config) {
    const projectConfig = {
      projectName: config.projectName,
      groupId: config.groupId,
      artifactId: config.artifactId,
      packageName: config.packageName,
      javaVersion: config.javaVersion,
      springBootVersion: config.springBootVersion,
      springModulithVersion: config.springModulithVersion,
      dependencies: config.dependencies || [],
      databaseType: config.databaseType,
      modules: [],
      createdAt: config.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await fs.writeJson(this.configFile, projectConfig, { spaces: 2 });
    return projectConfig;
  }

  /**
   * Load project configuration from .eva4j.json
   * @returns {Object|null} Project configuration or null if not found
   */
  async loadProjectConfig() {
    try {
      if (await fs.pathExists(this.configFile)) {
        return await fs.readJson(this.configFile);
      }
      return null;
    } catch (error) {
      console.error('Error loading project configuration:', error.message);
      return null;
    }
  }

  /**
   * Add a module to the project configuration
   * @param {string} moduleName - Name of the module
   * @param {Object} options - Module options
   */
  async addModule(moduleName, options = {}) {
    const config = await this.loadProjectConfig();
    if (!config) {
      throw new Error('Project configuration not found. Are you in an eva4j project?');
    }

    const module = {
      name: moduleName,
      createdAt: new Date().toISOString(),
      ...options
    };

    config.modules.push(module);
    config.updatedAt = new Date().toISOString();

    await fs.writeJson(this.configFile, config, { spaces: 2 });
    return config;
  }

  /**
   * Check if a module exists in the project
   * @param {string} moduleName - Name of the module to check
   * @returns {boolean} True if module exists
   */
  async moduleExists(moduleName) {
    const config = await this.loadProjectConfig();
    if (!config) return false;
    
    return config.modules.some(module => module.name === moduleName);
  }

  /**
   * Get all modules from the project configuration
   * @returns {Array} List of modules
   */
  async getModules() {
    const config = await this.loadProjectConfig();
    return config ? config.modules : [];
  }

  /**
   * Check if .eva4j.json exists in the project
   * @returns {boolean} True if config file exists
   */
  async exists() {
    return await fs.pathExists(this.configFile);
  }

  /**
   * Get the full project configuration path
   * @returns {string} Path to .eva4j.json
   */
  getConfigPath() {
    return this.configFile;
  }

  /**
   * Check if a feature exists in the project
   * @param {string} featureName - Name of the feature to check
   * @returns {boolean} True if feature exists
   */
  async featureExists(featureName) {
    const config = await this.loadProjectConfig();
    if (!config || !config.features) return false;
    
    return config.features.includes(featureName);
  }

  /**
   * Add a feature to the project configuration
   * @param {string} featureName - Name of the feature to add
   */
  async addFeature(featureName) {
    const config = await this.loadProjectConfig();
    if (!config) {
      throw new Error('Project configuration not found. Are you in an eva4j project?');
    }

    if (!config.features) {
      config.features = [];
    }

    if (!config.features.includes(featureName)) {
      config.features.push(featureName);
      config.updatedAt = new Date().toISOString();
      await fs.writeJson(this.configFile, config, { spaces: 2 });
    }

    return config;
  }
}

module.exports = ConfigManager;
