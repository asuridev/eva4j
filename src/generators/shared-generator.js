const fs = require('fs-extra');
const path = require('path');
const { renderAndWrite } = require('../utils/template-engine');

class SharedGenerator {
  constructor(context) {
    this.context = context;
    this.templatesDir = path.join(__dirname, '../../templates/shared');
    this.projectDir = process.cwd();
  }

  /**
   * Check if shared module already exists
   */
  static async needsSharedModule(projectDir, packagePath) {
    const sharedPath = path.join(projectDir, 'src', 'main', 'java', packagePath, 'shared');
    return !(await fs.pathExists(sharedPath));
  }

  async generate() {
    const { packagePath } = this.context;
    const sharedBasePath = path.join(this.projectDir, 'src', 'main', 'java', packagePath, 'shared');
    
    // Generate domain/base classes
    await this.generateDomainBase(sharedBasePath);
    
    // Generate value objects
    await this.generateValueObjects(sharedBasePath);
    
    // Generate domain exceptions
    await this.generateDomainExceptions(sharedBasePath);
    
    // Generate DTOs
    await this.generateDTOs(sharedBasePath);
    
    // Generate enums
    await this.generateEnums(sharedBasePath);
    
    // Generate constants
    await this.generateConstants(sharedBasePath);
  }

  async generateDomainBase(basePath) {
    const domainBasePath = path.join(basePath, 'domain', 'base');
    
    await this.generateFile('domain/base/Identifiable.java.ejs', 
      path.join(domainBasePath, 'Identifiable.java'));
    await this.generateFile('domain/base/BaseEntity.java.ejs', 
      path.join(domainBasePath, 'BaseEntity.java'));
    await this.generateFile('domain/base/AuditableEntity.java.ejs', 
      path.join(domainBasePath, 'AuditableEntity.java'));
    await this.generateFile('domain/base/SoftDeletableEntity.java.ejs', 
      path.join(domainBasePath, 'SoftDeletableEntity.java'));
  }

  async generateValueObjects(basePath) {
    const voPath = path.join(basePath, 'domain', 'valueobject');
    
    await this.generateFile('domain/valueobject/ValueObject.java.ejs', 
      path.join(voPath, 'ValueObject.java'));
    await this.generateFile('domain/valueobject/Money.java.ejs', 
      path.join(voPath, 'Money.java'));
    await this.generateFile('domain/valueobject/Email.java.ejs', 
      path.join(voPath, 'Email.java'));
    await this.generateFile('domain/valueobject/Address.java.ejs', 
      path.join(voPath, 'Address.java'));
  }

  async generateDomainExceptions(basePath) {
    const exceptionPath = path.join(basePath, 'domain', 'exception');
    
    await this.generateFile('domain/exception/DomainException.java.ejs', 
      path.join(exceptionPath, 'DomainException.java'));
    await this.generateFile('domain/exception/EntityNotFoundException.java.ejs', 
      path.join(exceptionPath, 'EntityNotFoundException.java'));
    await this.generateFile('domain/exception/ValidationException.java.ejs', 
      path.join(exceptionPath, 'ValidationException.java'));
    await this.generateFile('domain/exception/BusinessRuleViolationException.java.ejs', 
      path.join(exceptionPath, 'BusinessRuleViolationException.java'));
    await this.generateFile('domain/exception/DuplicateEntityException.java.ejs', 
      path.join(exceptionPath, 'DuplicateEntityException.java'));
  }

  async generateDTOs(basePath) {
    const dtoPath = path.join(basePath, 'dto', 'base');
    
    await this.generateFile('dto/base/ApiResponse.java.ejs', 
      path.join(dtoPath, 'ApiResponse.java'));
    await this.generateFile('dto/base/PageResponse.java.ejs', 
      path.join(dtoPath, 'PageResponse.java'));
    await this.generateFile('dto/base/ErrorDetail.java.ejs', 
      path.join(dtoPath, 'ErrorDetail.java'));
  }

  async generateEnums(basePath) {
    const enumsPath = path.join(basePath, 'enums');
    
    await this.generateFile('enums/Status.java.ejs', 
      path.join(enumsPath, 'Status.java'));
    await this.generateFile('enums/Currency.java.ejs', 
      path.join(enumsPath, 'Currency.java'));
    await this.generateFile('enums/Country.java.ejs', 
      path.join(enumsPath, 'Country.java'));
    await this.generateFile('enums/ErrorCode.java.ejs', 
      path.join(enumsPath, 'ErrorCode.java'));
  }

  async generateConstants(basePath) {
    const constantsPath = path.join(basePath, 'constants');
    
    await this.generateFile('constants/DomainConstants.java.ejs', 
      path.join(constantsPath, 'DomainConstants.java'));
  }

  async generateFile(templateRelPath, destPath) {
    const templatePath = path.join(this.templatesDir, templateRelPath);
    await renderAndWrite(templatePath, destPath, this.context);
  }
}

module.exports = SharedGenerator;
