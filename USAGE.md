# eva4j - Installation & Usage Guide

## Installation

### Local Development

1. Clone or navigate to the eva4j directory:
```bash
cd c:\Documentos\eva4j
```

2. Install dependencies:
```bash
npm install
```

3. Link the CLI globally (for local testing):
```bash
npm link
```

Now you can use `eva4j` command from anywhere!

### Publish to npm (optional)

```bash
npm publish
```

Then install globally:
```bash
npm install -g eva4j
```

## Usage

### 1. Create a New Spring Boot Project

```bash
eva4j create my-shop
```

This will prompt you for:
- Group ID (e.g., `com.company`)
- Java version (21, 22, or 23)
- Spring Boot version
- Dependencies (Web, JPA, Security, Validation, Actuator)
- Database type (PostgreSQL, MySQL, H2)
- Author name

**Generated structure:**
```
my-shop/
├── src/main/java/com/company/myshop/
│   └── MyShopApplication.java
├── src/main/resources/
│   ├── application.yml (base config)
│   ├── application-local.yml
│   ├── application-develop.yml
│   ├── application-test.yml
│   └── application-production.yml
├── build.gradle (includes Spring Modulith)
├── settings.gradle
├── .eva4j.json (project configuration)
├── docker-compose.yml (if database selected)
├── .gitignore
└── README.md
```

### 2. Add Your First Module

Navigate to your project:
```bash
cd my-shop
```

Add a domain module (e.g., "user"):
```bash
eva4j add module user
```

**First module automatically creates `shared` module!**

The CLI will:
1. Detect this is the first module
2. Create the `shared` module with:
   - Base entities (BaseEntity, AuditableEntity, SoftDeletableEntity)
   - Value objects (Money, Email, Address)
   - Domain exceptions
   - Common DTOs (ApiResponse, PageResponse)
   - Enums (Status, Currency, ErrorCode)
3. Create the `user` module with Spring Modulith structure:
   - `package-info.java` with @ApplicationModule annotation
   - `application/` - Empty directory for controllers, services, DTOs
   - `domain/` - Empty directory for entities and value objects
   - `infrastructure/` - Empty directory for repositories

### 3. Add More Modules

```bash
eva4j add module product
eva4j add module order
```

Each module includes:
- **package-info.java**: Spring Modulith configuration with `@ApplicationModule`
- **application/**: Empty directory for controllers, services, DTOs, mappers
- **domain/**: Empty directory for entities, value objects, domain logic
- **infrastructure/**: Empty directory for repositories, external integrations

You can then add your own classes following hexagonal/modular architecture principles.

## Project Structure

```
my-shop/
├── src/
│   ├── main/java/com/company/myshop/
│   │   ├── MyShopApplication.java
│   │   ├── shared/                    # Domain (business)
│   │   │   ├── domain/
│   │   │   │   ├── base/
│   │   │   │   │   ├── BaseEntity.java
│   │   │   │   │   ├── AuditableEntity.java
│   │   │   │   │   └── SoftDeletableEntity.java
│   │   │   │   ├── valueobject/
│   │   │   │   │   ├── Money.java
│   │   │   │   │   ├── Email.java
│   │   │   │   │   └── Address.java
│   │   │   │   └── exception/
│   │   │   │       ├── DomainException.java
│   │   │   │       ├── EntityNotFoundException.java
│   │   │   │       └── ValidationException.java
│   │   │   ├── dto/base/
│   │   │   │   ├── ApiResponse.java
│   │   │   │   ├── PageResponse.java
│   │   │   │   └── ErrorDetail.java
│   │   │   ├── enums/
│   │   │   │   ├── Status.java
│   │   │   │   ├── Currency.java
│   │   │   │   └── ErrorCode.java
│   │   │   └── constants/
│   │   │       └── DomainConstants.java
│   │   ├── user/                      # Domain module
│   │   │   ├── package-info.java      # @ApplicationModule
│   │   │   ├── application/           # Controllers, Services, DTOs
│   │   │   ├── domain/                # Entities, Value Objects
│   │   │   └── infrastructure/        # Repositories
│   │   └── product/                   # Another domain module
│   │       └── ... (same structure)
│   └── resources/
│       ├── application.yml
│       ├── application-local.yml
│       ├── application-develop.yml
│       ├── application-test.yml
│       └── application-production.yml
└── build.gradle
```

## Running the Application

```bash
# Using Gradle wrapper
./gradlew bootRun

# Or build and run
./gradlew build
java -jar build/libs/my-shop-1.0.0.jar
```

## Environment Profiles

The application includes multiple Spring profiles:

- **local**: Development on local machine (DEBUG logs, create-drop, SQL visible)
- **develop**: Development environment (INFO logs, update schema)
- **test**: Testing environment (INFO logs, update schema)
- **production**: Production environment (WARN logs, validate schema, swagger disabled)

Set the profile using the `PROFILE` environment variable:

```bash
# Local development (default if not set)
PROFILE=local ./gradlew bootRun

# Development environment
PROFILE=develop ./gradlew bootRun

# Production
PROFILE=production java -jar build/libs/my-shop-1.0.0.jar
```

Default profile: `develop`

## API Documentation

Once running, visit:
- Swagger UI: http://localhost:8001/api/v1/swagger-ui.html
- OpenAPI: http://localhost:8001/api/v1/api-docs
- Health: http://localhost:8001/api/v1/actuator/health

**Note**: Context path is `/api/v1` and default port is `8001` (configurable in application.yml)

## Architecture

### Spring Modulith
The project uses Spring Modulith for modular monolith architecture. Each module is annotated with `@ApplicationModule` and can only depend on the `shared` module.

### Shared Module (Domain)
Business domain: base entities, value objects, domain exceptions, shared enums. This module is automatically created when you add your first domain module.

### Domain Modules (Features)
Each module follows a layered structure:
- **application/**: Application layer (controllers, services, DTOs, mappers)
- **domain/**: Domain layer (entities, value objects, domain logic)
- **infrastructure/**: Infrastructure layer (repositories, external integrations)

Modules are self-contained and can only reference the `shared` module, promoting loose coupling.

## Commands Reference

```bash
# Create project
eva4j create <project-name>

# Add module
eva4j add module <module-name>

# Display project info
eva4j info

# Version
eva4j -v

# Help
eva4j --help
```

## Project Configuration Persistence

Eva4j automatically saves project configuration in `.eva4j.json` file at the project root. This file tracks:
- Project metadata (name, group ID, package name, versions)
- Selected dependencies
- Added modules with their options (soft-delete, audit)
- Creation and update timestamps

**Benefits:**
- Persist configuration across sessions
- Track module history
- Share configuration with team members (committed to git)
- Validate module additions against existing modules

**Example `.eva4j.json`:**
```json
{
  "projectName": "my-shop",
  "groupId": "com.company",
  "artifactId": "my-shop",
  "packageName": "com.company.myshop",
  "javaVersion": "21",
  "springBootVersion": "3.5.5",
  "springModulithVersion": "1.4.6",
  "dependencies": ["web", "data-jpa", "validation"],
  "modules": [
    {
      "name": "user",
      "hasSoftDelete": true,
      "hasAudit": true,
      "createdAt": "2026-01-27T10:30:00.000Z"
    }
  ],
  "createdAt": "2026-01-27T10:25:00.000Z",
  "updatedAt": "2026-01-27T10:30:00.000Z"
}
```

**View project info:**
```bash
cd my-shop
eva4j info
```

This displays:
- Project details (name, group ID, package)
- Versions (Java, Spring Boot, Spring Modulith)
- Dependencies
- Modules with features
- Timestamps

## Tips

1. **First Module**: Always generates the shared module automatically
2. **Soft Delete**: Enable for entities that should not be permanently deleted
3. **Audit Fields**: Enable to track who created/modified entities
4. **Spring Modulith**: Each module is isolated and can only depend on `shared`
5. **Profiles**: Use `local` for development, `production` for deployment
6. **Virtual Threads**: Enabled by default for better performance (Java 21+)
7. **Configuration Tracking**: Use `eva4j info` to view project details and module history
8. **Team Collaboration**: `.eva4j.json` is tracked in git for team coordination

## Example Workflow

```bash
# 1. Create project
eva4j create ecommerce

# 2. Navigate to project
cd ecommerce

# 3. View project info
eva4j info

# 4. Add domain modules
eva4j add module user      # Creates shared + user
eva4j add module product   # Just creates product
eva4j add module order     # Just creates order
eva4j add module payment   # Just creates payment

# 5. Check configuration and modules
eva4j info

# 6. Start database (if using Docker)
docker-compose up -d

# 7. Run application
./gradlew bootRun

# 8. Visit Swagger
# http://localhost:8001/api/v1/swagger-ui.html
```

## Troubleshooting

**Issue**: "Not in a Spring Boot project directory"
- Solution: Make sure you're in the project root (where build.gradle exists)

**Issue**: Module already exists
- Solution: Choose a different module name or delete the existing module folder

**Issue**: Permission denied (Linux/Mac)
- Solution: `chmod +x ./gradlew`

## Contributing

Issues and pull requests welcome at: https://github.com/your-repo/eva4j

## License

MIT
