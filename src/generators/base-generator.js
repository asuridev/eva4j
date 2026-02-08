const fs = require('fs-extra');
const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');
const { toPackagePath, getApplicationClassName } = require('../utils/naming');
const ConfigManager = require('../utils/config-manager');

class BaseGenerator {
  constructor(context) {
    this.context = context;
    this.templatesDir = path.join(__dirname, '../../templates/base');
    this.projectDir = path.join(process.cwd(), context.artifactId);
  }

  async generate() {
    const { packageName, packagePath } = this.context;
    
    // Create base directories
    await this.createDirectoryStructure();
    
    // Generate Java sources
    await this.generateApplication();
    
    // Generate build files
    await this.generateGradleFiles();
    
    // Generate resources
    await this.generateResources();
    
    // Generate root files
    await this.generateRootFiles();
    
    // Generate test
    await this.generateTests();
    
    // Save project configuration
    await this.saveProjectConfig();
  }
  
  async saveProjectConfig() {
    const configManager = new ConfigManager(this.projectDir);
    await configManager.saveProjectConfig({
      projectName: this.context.projectName,
      groupId: this.context.groupId,
      artifactId: this.context.artifactId,
      packageName: this.context.packageName,
      javaVersion: this.context.javaVersion,
      springBootVersion: this.context.springBootVersion,
      springModulithVersion: this.context.springModulithVersion,
      dependencies: this.context.dependencies,
      databaseType: this.context.databaseType,
      createdAt: new Date().toISOString()
    });
  }

  async createDirectoryStructure() {
    const { packagePath } = this.context;
    const srcMain = path.join(this.projectDir, 'src', 'main', 'java', packagePath);
    const srcTest = path.join(this.projectDir, 'src', 'test', 'java', packagePath);
    const resources = path.join(this.projectDir, 'src', 'main', 'resources');
    
    await fs.ensureDir(srcMain);
    await fs.ensureDir(srcTest);
    await fs.ensureDir(resources);
    await fs.ensureDir(path.join(resources, 'static'));
    await fs.ensureDir(path.join(resources, 'templates'));
  }

  async generateApplication() {
    const { packageName, packagePath } = this.context;
    const templatePath = path.join(this.templatesDir, 'application', 'Application.java.ejs');
    const destPath = path.join(
      this.projectDir,
      'src', 'main', 'java', packagePath,
      `${this.context.applicationClassName}.java`
    );
    
    await renderAndWrite(templatePath, destPath, this.context);
  }

  async generateGradleFiles() {
    await this.generateFile('gradle/build.gradle.ejs', 
      path.join(this.projectDir, 'build.gradle'));
    await this.generateFile('gradle/settings.gradle.ejs', 
      path.join(this.projectDir, 'settings.gradle'));
  }

  async generateResources() {
    const resourcesPath = path.join(this.projectDir, 'src', 'main', 'resources');
    
    // Base application.yaml files
    await this.generateFile('resources/application.yaml.ejs', 
      path.join(resourcesPath, 'application.yaml'));
    await this.generateFile('resources/application-local.yaml.ejs', 
      path.join(resourcesPath, 'application-local.yaml'));
    await this.generateFile('resources/application-develop.yaml.ejs', 
      path.join(resourcesPath, 'application-develop.yaml'));
    await this.generateFile('resources/application-test.yaml.ejs', 
      path.join(resourcesPath, 'application-test.yaml'));
    await this.generateFile('resources/application-production.yaml.ejs', 
      path.join(resourcesPath, 'application-production.yaml'));
    
    // DB configuration per environment
    if (this.context.dependencies?.includes('data-jpa')) {
      await this.generateFile('resources/parameters/local/db.yaml.ejs', 
        path.join(resourcesPath, 'parameters', 'local', 'db.yaml'));
      await this.generateFile('resources/parameters/develop/db.yaml.ejs', 
        path.join(resourcesPath, 'parameters', 'develop', 'db.yaml'));
      await this.generateFile('resources/parameters/test/db.yaml.ejs', 
        path.join(resourcesPath, 'parameters', 'test', 'db.yaml'));
      await this.generateFile('resources/parameters/production/db.yaml.ejs', 
        path.join(resourcesPath, 'parameters', 'production', 'db.yaml'));
    }

    // CORS configuration per environment
    await this.generateFile('resources/parameters/local/cors.yaml.ejs', 
      path.join(resourcesPath, 'parameters', 'local', 'cors.yaml'));
    await this.generateFile('resources/parameters/develop/cors.yaml.ejs', 
      path.join(resourcesPath, 'parameters', 'develop', 'cors.yaml'));
    await this.generateFile('resources/parameters/test/cors.yaml.ejs', 
      path.join(resourcesPath, 'parameters', 'test', 'cors.yaml'));
    await this.generateFile('resources/parameters/production/cors.yaml.ejs', 
      path.join(resourcesPath, 'parameters', 'production', 'cors.yaml'));
  }

  async generateRootFiles() {
    await this.generateFile('root/gitignore.ejs', 
      path.join(this.projectDir, '.gitignore'));
    await this.generateFile('root/README.md.ejs', 
      path.join(this.projectDir, 'README.md'));
    await this.generateFile('root/AGENTS.md.ejs', 
      path.join(this.projectDir, 'AGENTS.md'));
    
    if (this.context.features.includeDocker) {
      await this.generateFile('docker/docker-compose.yaml.ejs', 
        path.join(this.projectDir, 'docker-compose.yaml'));
    }
  }

  async generateTests() {
    const { packagePath } = this.context;
    await this.generateFile('test/ApplicationTests.java.ejs', 
      path.join(this.projectDir, 'src', 'test', 'java', packagePath, 
        `${this.context.applicationClassName}Tests.java`));
  }

  async generateFile(templateRelPath, destPath) {
    const templatePath = path.join(this.templatesDir, templateRelPath);
    await renderAndWrite(templatePath, destPath, this.context);
  }
}

module.exports = BaseGenerator;
