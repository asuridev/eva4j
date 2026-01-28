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
    
    // Generate package-info
    await this.generatePackageInfo(sharedBasePath);
    
    // Generate annotations
    await this.generateAnnotations(sharedBasePath);
    
    // Generate interfaces
    await this.generateInterfaces(sharedBasePath);
    
    // Generate custom exceptions
    await this.generateCustomExceptions(sharedBasePath);
    
    // Generate error messages
    await this.generateErrorMessages(sharedBasePath);
    
    // Generate event envelope
    await this.generateEventEnvelope(sharedBasePath);
    
    // Generate handler exception
    await this.generateHandlerException(sharedBasePath);
    
    // Generate configurations
    await this.generateConfigurations(sharedBasePath);
  }

  async generatePackageInfo(basePath) {
    await this.generateFile('package-info.java.ejs', 
      path.join(basePath, 'package-info.java'));
  }

  async generateAnnotations(basePath) {
    const annotationsPath = path.join(basePath, 'annotations');
    const files = ['ApplicationComponent', 'DomainComponent', 'LogAfter', 'LogBefore', 'LogExceptions', 'LogTimer'];
    
    for (const file of files) {
      await this.generateFile(`annotations/${file}.java.ejs`, 
        path.join(annotationsPath, `${file}.java`));
    }
  }

  async generateInterfaces(basePath) {
    const interfacesPath = path.join(basePath, 'interfaces');
    const files = ['Command', 'CommandHandler', 'Dispatchable', 'Handler', 'Query', 'QueryHandler'];
    
    for (const file of files) {
      await this.generateFile(`interfaces/${file}.java.ejs`, 
        path.join(interfacesPath, `${file}.java`));
    }
  }

  async generateCustomExceptions(basePath) {
    const exceptionsPath = path.join(basePath, 'customExceptions');
    const files = ['BadRequestException', 'ConflictException', 'ForbiddenException', 
                   'ImportFileException', 'NotFoundException', 'UnauthorizedException', 'ValidationException'];
    
    for (const file of files) {
      await this.generateFile(`customExceptions/${file}.java.ejs`, 
        path.join(exceptionsPath, `${file}.java`));
    }
  }

  async generateErrorMessages(basePath) {
    const errorMessagePath = path.join(basePath, 'errorMessage');
    const files = ['ErrorMessage', 'FullErrorMessage', 'ShortErrorMessage'];
    
    for (const file of files) {
      await this.generateFile(`errorMessage/${file}.java.ejs`, 
        path.join(errorMessagePath, `${file}.java`));
    }
  }

  async generateEventEnvelope(basePath) {
    const eventEnvelopePath = path.join(basePath, 'eventEnvelope');
    
    await this.generateFile('eventEnvelope/EventEnvelope.java.ejs', 
      path.join(eventEnvelopePath, 'EventEnvelope.java'));
    await this.generateFile('eventEnvelope/EventMetadata.java.ejs', 
      path.join(eventEnvelopePath, 'EventMetadata.java'));
  }

  async generateHandlerException(basePath) {
    const handlerExceptionPath = path.join(basePath, 'handlerException');
    
    await this.generateFile('handlerException/HandlerExceptions.java.ejs', 
      path.join(handlerExceptionPath, 'HandlerExceptions.java'));
  }

  async generateConfigurations(basePath) {
    const configurationsPath = path.join(basePath, 'configurations');
    
    // Logger config
    await this.generateFile('configurations/loggerConfig/HandlerLogs.java.ejs', 
      path.join(configurationsPath, 'loggerConfig', 'HandlerLogs.java'));
    
    // Security config
    await this.generateFile('configurations/securityConfig/SecurityConfig.java.ejs', 
      path.join(configurationsPath, 'securityConfig', 'SecurityConfig.java'));
    
    // Swagger config
    await this.generateFile('configurations/swaggerConfig/SwaggerConfig.java.ejs', 
      path.join(configurationsPath, 'swaggerConfig', 'SwaggerConfig.java'));
    
    // UseCase config
    await this.generateFile('configurations/useCaseConfig/UseCaseAutoRegister.java.ejs', 
      path.join(configurationsPath, 'useCaseConfig', 'UseCaseAutoRegister.java'));
    await this.generateFile('configurations/useCaseConfig/UseCaseConfig.java.ejs', 
      path.join(configurationsPath, 'useCaseConfig', 'UseCaseConfig.java'));
    await this.generateFile('configurations/useCaseConfig/UseCaseContainer.java.ejs', 
      path.join(configurationsPath, 'useCaseConfig', 'UseCaseContainer.java'));
    await this.generateFile('configurations/useCaseConfig/UseCaseMediator.java.ejs', 
      path.join(configurationsPath, 'useCaseConfig', 'UseCaseMediator.java'));
  }

  async generateFile(templateRelPath, destPath) {
    const templatePath = path.join(this.templatesDir, templateRelPath);
    await renderAndWrite(templatePath, destPath, this.context);
  }
}

module.exports = SharedGenerator;
