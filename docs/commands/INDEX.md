# eva4j Commands Documentation Index

Complete reference for all eva4j commands. Each command has detailed documentation with examples, use cases, and best practices.

## 📑 Table of Contents

### 🏗️ Project Setup Commands

Commands for initializing and structuring your project.

- **[create](./CREATE.md)** - Create a new Spring Boot project with modular architecture
  - Initialize complete project structure
  - Multi-environment configuration
  - Docker Compose setup
  - Gradle build configuration

- **[add module](./ADD_MODULE.md)** - Add a new domain module
  - Hexagonal architecture layers
  - CQRS structure ready
  - Spring Modulith boundaries
  - Independent module development

### 🔨 Code Generation Commands

Commands for generating domain models, use cases, and resources.

- **[generate entities](./GENERATE_ENTITIES.md)** (`g entities`) - Generate complete domain model from YAML
  - Domain entities and value objects
  - JPA entities and repositories
  - CRUD commands and queries
  - REST controller with endpoints
  - **Most powerful command** - generates 90% of CRUD boilerplate

- **[generate usecase](./GENERATE_USECASE.md)** (`g usecase`) - Create CQRS commands or queries
  - Individual command/query creation
  - Handler with business logic structure
  - Extends generated entities
  - Custom business operations

- **[generate resource](./GENERATE_RESOURCE.md)** (`g resource`) - Generate REST controller
  - CRUD endpoints (POST, GET, GET list)
  - Pagination support
  - Validation integration
  - Handler injection

- **[generate record](./GENERATE_RECORD.md)** (`g record`) - Create Java Record
  - Immutable DTOs
  - Value objects
  - Event payloads
  - API responses

### 🔌 Integration Commands

Commands for integrating with external services and messaging systems.

- **[generate http-exchange](./GENERATE_HTTP_EXCHANGE.md)** (`g http`) - Create HTTP client
  - Spring Cloud OpenFeign integration
  - Port and adapter pattern
  - External API communication
  - Inter-service HTTP calls
  - Request/Response mapping

- **[generate kafka-event](./GENERATE_KAFKA_EVENT.md)** (`g kafka-event`) - Setup Kafka event publishing
  - Event-driven architecture
  - Asynchronous communication
  - Domain event publishing
  - Kafka producer configuration
  - Event versioning

- **[generate kafka-listener](./GENERATE_KAFKA_LISTENER.md)** (`g kafka-listener`) - Create Kafka event consumer
  - Event consumption from topics
  - Spring Kafka listener methods
  - Event processing handlers
  - Manual acknowledgment control
  - Integration with UseCaseMediator

- **add kafka-client** - Add Kafka dependencies
  - *Documentation coming soon*
  - Kafka dependencies installation
  - Base configuration

### 🚀 Deployment & Scaling Commands

Commands for transitioning from monolith to microservices.

- **[detach](./DETACH.md)** - Extract module to independent microservice
  - Module extraction
  - Standalone application creation
  - Docker configuration
  - Service independence
  - Zero code rewrite

### 📊 Utility Commands

- **info** - Display project information
  - *Documentation coming soon*
  - List modules
  - Show configuration
  - Project statistics

---

## 🎯 Command Categories by Use Case

### Starting a New Project
1. [create](./CREATE.md) - Initialize project
2. [add module](./ADD_MODULE.md) - Create first module
3. [generate entities](./GENERATE_ENTITIES.md) - Generate domain model

### Building Features
1. [generate entities](./GENERATE_ENTITIES.md) - Complete CRUD
2. [generate usecase](./GENERATE_USECASE.md) - Custom operations
3. [generate resource](./GENERATE_RESOURCE.md) - REST API

### Integrating Services
1. [generate http-exchange](./GENERATE_HTTP_EXCHANGE.md) - External APIs
2. [generate kafka-event](./GENERATE_KAFKA_EVENT.md) - Event publishing
3. [generate kafka-listener](./GENERATE_KAFKA_LISTENER.md) - Event consumption

### Scaling to Microservices
1. [detach](./DETACH.md) - Extract module
2. [generate http-exchange](./GENERATE_HTTP_EXCHANGE.md) - Service communication

---

## 📈 Command Complexity & Impact

### High Impact, Low Effort ⭐⭐⭐
- **[create](./CREATE.md)** - One command, complete project structure
- **[generate entities](./GENERATE_ENTITIES.md)** - YAML to full CRUD in seconds
- **[add module](./ADD_MODULE.md)** - Complete module structure instantly

### Medium Impact, Low Effort ⭐⭐
- **[generate resource](./GENERATE_RESOURCE.md)** - Quick REST API exposure
- **[generate kafka-event](./GENERATE_KAFKA_EVENT.md)** - Event publishing setup
- **[generate http-exchange](./GENERATE_HTTP_EXCHANGE.md)** - External service integration

### Low Impact, Low Effort ⭐
- **[generate usecase](./GENERATE_USECASE.md)** - Individual use case
- **[generate record](./GENERATE_RECORD.md)** - Simple DTO creation

### High Impact, Medium Effort 🚀
- **[detach](./DETACH.md)** - Microservice extraction (requires planning)

---

## 🔗 Quick Links

### Getting Started
- [📖 Main README](../../README.md)
- [📝 Quick Reference](../../QUICK_REFERENCE.md)
- [📘 YAML Guide](../../DOMAIN_YAML_GUIDE.md)

### Examples
- [examples/](../../examples/) - YAML examples for various scenarios
  - Simple CRUD
  - Complex relationships
  - Value objects
  - Collections
  - Multiple aggregates

### Support
- [🐛 Issue Tracker](https://github.com/your-repo/eva4j/issues)
- [💬 Discussions](https://github.com/your-repo/eva4j/discussions)

---

## 📚 Learning Path

### Beginner Track
1. Read [create](./CREATE.md) - Understand project structure
2. Read [add module](./ADD_MODULE.md) - Learn module architecture
3. Read [generate entities](./GENERATE_ENTITIES.md) - Master YAML-driven development
4. Practice with examples in `examples/` directory

### Intermediate Track
1. [generate usecase](./GENERATE_USECASE.md) - Custom business logic
2. [generate http-exchange](./GENERATE_HTTP_EXCHANGE.md) - External integrations
3. [generate kafka-event](./GENERATE_KAFKA_EVENT.md) - Event-driven patterns

### Advanced Track
1. [detach](./DETACH.md) - Microservices extraction
2. Multi-module event communication
3. Distributed transactions patterns
4. Service mesh integration

---

## ⚡ Command Aliases Reference

All generate commands support short aliases for faster development:

```bash
eva4j g entities <name>        # generate entities
eva4j g usecase <name>         # generate usecase  
eva4j g resource <name>        # generate resource
eva4j g record <name>          # generate record
eva4j g http <name>            # generate http-exchange
eva4j g kafka-event <name>     # generate kafka-event
eva4j g kafka-listener <name>  # generate kafka-listener
```

---

## 🎓 Best Practices

### Command Execution Order
1. **create** - Always first
2. **add module** - Before generating code
3. **generate entities** - Core domain model
4. **generate usecase** - Additional operations
5. **generate resource** - API exposure
6. **detach** - When scaling needed

### Common Patterns
- Generate entities from YAML for standard CRUD
- Use generate usecase for custom operations
- Create HTTP clients for external dependencies
- Publish events for async communication
- Detach modules when team/scaling requires it

### Anti-Patterns to Avoid
- ❌ Don't detach modules prematurely
- ❌ Don't manually create what can be generated
- ❌ Don't skip YAML validation before generating
- ❌ Don't generate without planning module boundaries

---

*Last updated: February 2026*
