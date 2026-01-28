# eva4j

A Node.js CLI for generating Spring Boot projects with Gradle and Java 21+ using modular architecture (package-by-feature).

## Features

- 🚀 Generate Spring Boot projects with Gradle and Java 21+
- 📦 Modular architecture with package-by-feature pattern
- 🔧 Automatic shared module generation for cross-cutting domain concerns
- 🏗️ Clean separation between infrastructure (common) and domain (shared/modules)
- ✨ Interactive CLI with prompts
- 🎨 Beautiful console output with colors and spinners

## Installation

```bash
npm install -g eva4j
```

Or run locally:

```bash
npm install
npm link
```

## Usage

### Create a new project

```bash
eva4j create my-project
```

This will prompt you for:
- Group ID (e.g., com.company)
- Java version (21, 22, 23)
- Spring Boot version
- Database type (PostgreSQL, MySQL, H2)
- Dependencies (web, data-jpa, security, validation, actuator)

### Add a module

```bash
cd my-project
eva4j add module user
```

When you add the **first module**, the CLI automatically generates a `shared` module containing:
- Base entities (BaseEntity, AuditableEntity, SoftDeletableEntity)
- Value objects (Money, Email, Address)
- Domain exceptions (DomainException, EntityNotFoundException, ValidationException)
- Common DTOs (ApiResponse, PageResponse, ErrorDetail)
- Enums (Status, Currency, ErrorCode)
- Custom validation annotations

### Project Structure

```
my-project/
├── src/
│   ├── main/
│   │   ├── java/
│   │   │   └── com/
│   │   │       └── company/
│   │   │           └── myproject/
│   │   │               ├── MyProjectApplication.java
│   │   │               ├── common/          # Infrastructure layer
│   │   │               │   ├── config/
│   │   │               │   ├── exception/
│   │   │               │   └── util/
│   │   │               ├── shared/          # Shared domain layer
│   │   │               │   ├── domain/
│   │   │               │   ├── dto/
│   │   │               │   ├── enums/
│   │   │               │   └── validation/
│   │   │               └── user/            # Domain module
│   │   │                   ├── controller/
│   │   │                   ├── service/
│   │   │                   ├── repository/
│   │   │                   ├── model/
│   │   │                   └── dto/
│   │   └── resources/
│   └── test/
├── build.gradle
└── docker-compose.yml
```

## Architecture

### Common Package (Infrastructure)
Technical concerns: Security config, Swagger config, global exception handler, utilities

### Shared Module (Domain)
Business domain concepts shared across modules: Base entities, value objects, domain exceptions, enums

### Domain Modules
Feature-based modules: user, product, order, etc. Each with its own controller, service, repository, model, dto

## License

MIT
