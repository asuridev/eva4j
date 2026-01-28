const fs = require('fs-extra');
const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');

class ModuleGenerator {
  constructor(context) {
    this.context = context;
    this.templatesDir = path.join(__dirname, '../../templates/module');
    this.projectDir = process.cwd();
  }

  async generate() {
    const { packagePath, moduleName } = this.context;
    const moduleBasePath = path.join(this.projectDir, 'src', 'main', 'java', packagePath, moduleName);
    
    // Create module directories with application subdirectories
    await fs.ensureDir(path.join(moduleBasePath, 'application', 'commands'));
    await fs.ensureDir(path.join(moduleBasePath, 'application', 'dtos'));
    await fs.ensureDir(path.join(moduleBasePath, 'application', 'mappers'));
    await fs.ensureDir(path.join(moduleBasePath, 'application', 'events'));
    await fs.ensureDir(path.join(moduleBasePath, 'application', 'ports'));
    await fs.ensureDir(path.join(moduleBasePath, 'application', 'queries'));
    await fs.ensureDir(path.join(moduleBasePath, 'application', 'usecases'));
    
    // Create domain subdirectories
    await fs.ensureDir(path.join(moduleBasePath, 'domain', 'models', 'entities'));
    await fs.ensureDir(path.join(moduleBasePath, 'domain', 'models', 'valueObjects'));
    await fs.ensureDir(path.join(moduleBasePath, 'domain', 'repositories'));
    await fs.ensureDir(path.join(moduleBasePath, 'domain', 'services'));
    
    // Create infrastructure subdirectories
    await fs.ensureDir(path.join(moduleBasePath, 'infrastructure', 'adapters'));
    await fs.ensureDir(path.join(moduleBasePath, 'infrastructure', 'database'));
    await fs.ensureDir(path.join(moduleBasePath, 'infrastructure', 'rest', 'controllers'));
    await fs.ensureDir(path.join(moduleBasePath, 'infrastructure', 'rest', 'validators'));
    
    // Generate package-info.java at module root
    await this.generateFile('package-info.java.ejs', 
      path.join(moduleBasePath, 'package-info.java'));
  }

  async generateFile(templateRelPath, destPath) {
    const templatePath = path.join(this.templatesDir, templateRelPath);
    await renderAndWrite(templatePath, destPath, this.context);
  }
}

module.exports = ModuleGenerator;
