# Command `create`

## 📋 Description

Creates a new Spring Boot project with modular architecture, configured with best practices for hexagonal architecture, CQRS, and Spring Modulith.

## 🎯 Purpose

Initialize a complete project from scratch with the entire architectural structure pre-configured, eliminating the need for manual setup and ensuring consistency from the start.

## 📝 Syntax

```bash
eva4j create <project-name>
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `project-name` | Yes | Project name (will become the directory name) |

## 🔧 Interactive Options

The command prompts for the following information:

1. **Artifact ID** - Maven/Gradle artifact identifier (default: project name)
2. **Group ID** - Group ID (default: `com.example`)
3. **Java Version** - Java version (options: 21, 22, 23)
4. **Spring Boot Version** - Spring Boot version (default: 3.4.1)
5. **Database Type** - Database type (options: postgresql, mysql, h2)
6. **Author** - Project author name

## 📦 Generated Structure

```
my-project/
├── build.gradle                 # Gradle configuration
├── settings.gradle              # Module settings
├── gradle/                      # Gradle wrapper
├── docker-compose.yaml           # Development services (DB, Kafka, etc.)
├── src/
│   └── main/
│       ├── java/
│       │   └── com/example/myproject/
│       │       ├── Application.java           # Main class
│       │       └── shared/                    # Shared code
│       │           ├── application/           # Shared DTOs
│       │           ├── domain/                # Shared models
│       │           └── infrastructure/        # Shared config
│       └── resources/
│           ├── application.yaml                # Main config
│           ├── application-local.yaml          # Local config
│           ├── application-develop.yaml        # Development config
│           ├── application-test.yaml           # Test config
│           └── application-production.yaml     # Production config
├── .gitignore
└── README.md
```

## 💡 Examples

### Example 1: Basic project with PostgreSQL

```bash
eva4j create ecommerce-backend
```

**Interaction:**
```
🚀 Creating new Spring Boot project with eva4j

? Project artifact ID: ecommerce-backend
? Group ID: com.acme
? Java version: 21
? Spring Boot version: 3.4.1
? Database type: postgresql
? Author name: John Doe
```

### Example 2: Project with MySQL

```bash
eva4j create inventory-system
```

**Select MySQL in the database prompt**

### Example 3: Test project with H2

```bash
eva4j create poc-microservice
```

**Select H2 for in-memory database (ideal for POCs)**

## ✨ Generated Project Features

### 1. Modular Architecture
- Package-by-feature structure ready
- Spring Modulith configured to validate boundaries
- Support for multiple domain modules

### 2. Database
- Driver dependencies configured
- Multi-environment connection (local, dev, test, prod)
- JPA/Hibernate configured with naming strategies

### 3. Docker Compose
- Database configured (PostgreSQL/MySQL)
- Kafka + Zookeeper (for events)
- Adminer (database management)
- Kafka UI (topic management)

### 4. Multi-Environment Configuration
- `application.yaml` - Base configuration
- `application-local.yaml` - Local development with Docker
- `application-develop.yaml` - Development environment
- `application-test.yaml` - Automated testing
- `application-production.yaml` - Production

### 5. Included Dependencies
- Spring Boot Web (REST APIs)
- Spring Data JPA (Persistence)
- Spring Validation (Validations)
- Spring Modulith (Modularity)
- Lombok (Boilerplate reduction)
- MapStruct (Automatic mappings)
- Selected database driver

## 🚀 Next Steps

After creating the project:

1. **Navigate to directory:**
   ```bash
   cd <project-name>
   ```

2. **Start development services:**
   ```bash
   docker-compose up -d
   ```

3. **Add your first module:**
   ```bash
   eva4j add module customer
   ```

4. **Generate domain entities:**
   ```bash
   eva4j g entities <aggregate-name>
   ```

5. **Run the application:**
   ```bash
   ./gradlew bootRun
   ```

## ⚠️ Prerequisites

- **Node.js** 16+ installed
- **Java JDK** 21+ installed
- **Docker** (optional, for development services)
- **Gradle** downloads automatically via wrapper

## 🔍 Validations

The command validates:
- ✅ Valid project name (no spaces or special characters)
- ✅ Group ID with valid Java package format
- ✅ Destination directory does not exist
- ✅ Compatible Java and Spring Boot versions

## 📚 See Also

- [add-module](./ADD_MODULE.md) - Add domain modules
- [generate-entities](./GENERATE_ENTITIES.md) - Generate entities from YAML
- [generate-usecase](./GENERATE_USECASE.md) - Create CQRS use cases

## 🐛 Troubleshooting

**Error: "Directory already exists"**
- Solution: Choose another name or delete the existing directory

**Error: "Invalid Java version"**
- Solution: Ensure you have JDK 21+ installed and in your PATH

**Docker Compose fails**
- Solution: Verify Docker is running and ports (5432, 9092, 8080, etc.) are available
