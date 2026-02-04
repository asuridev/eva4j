# eva4j

> **A powerful Node.js CLI for generating Spring Boot projects with modular architecture that enables efficient monolith-first development with seamless transition to microservices.**

[![npm version](https://img.shields.io/npm/v/eva4j.svg)](https://www.npmjs.com/package/eva4j)
[![License](https://img.shields.io/npm/l/eva4j.svg)](https://github.com/your-repo/eva4j/blob/main/LICENSE)
[![Node Version](https://img.shields.io/node/v/eva4j.svg)](https://nodejs.org)

---

## 🚀 What is eva4j?

**eva4j accelerates Spring Boot development** by automating repetitive tasks and generating production-ready code following industry best practices for Clean Architecture, CQRS, and Microservices.

### ⚡ Generate in Seconds, Not Hours

```bash
# Create a complete project
eva4j create my-ecommerce
cd my-ecommerce

# Add a module
eva4j add module product

# Generate full CRUD from YAML
eva4j g entities product

# 🎉 Done! You have:
# ✅ Domain entities with business logic
# ✅ JPA repositories and mappers
# ✅ CQRS commands and queries
# ✅ REST API with pagination
# ✅ Complete hexagonal architecture
```

---

## 💎 Why eva4j?

### The Problem

Building Spring Boot applications with proper architecture requires:
- ❌ Hours setting up project structure
- ❌ Repetitive code for CRUD operations
- ❌ Manual wiring of layers (domain, application, infrastructure)
- ❌ Complex microservices infrastructure from day one
- ❌ Risk of architectural inconsistencies

### The Solution

eva4j provides:
- ✅ **Project in seconds** - Complete structure with one command
- ✅ **YAML-driven development** - Define domain model, generate 90% of code
- ✅ **Automatic layer wiring** - Domain, application, infrastructure pre-connected
- ✅ **Modular monolith first** - Simple development, microservices ready
- ✅ **Architectural consistency** - Same patterns across all modules

---

## 🎯 Key Benefits & Impact

### 1. **Massive Time Savings**

| Task | Without eva4j | With eva4j | Time Saved |
|------|---------------|------------|------------|
| Project setup | 2-4 hours | 30 seconds | **99%** |
| Module creation | 1-2 hours | 15 seconds | **99%** |
| Entity + CRUD | 3-6 hours | 1 minute | **98%** |
| HTTP integration | 1-2 hours | 30 seconds | **99%** |
| Kafka setup | 2-3 hours | 30 seconds | **99%** |

**Total saved per module: 7-15 hours** → Invest in business logic instead!

### 2. **Quality & Consistency**

- ✅ **Clean/Hexagonal Architecture** - Enforced by design
- ✅ **CQRS Pattern** - Write and read operations properly separated
- ✅ **Domain-Driven Design** - Entities, Value Objects, Aggregates
- ✅ **Best Practices** - Industry-standard patterns built-in
- ✅ **No Architectural Drift** - All modules follow same structure

### 3. **Developer Experience**

- ✅ **Simple Learning Curve** - YAML + CLI commands
- ✅ **Interactive Prompts** - Guided project creation
- ✅ **Clear Documentation** - Every command fully documented
- ✅ **Rich Examples** - 10+ YAML examples included
- ✅ **Fast Feedback** - Generate, run, test in seconds

### 4. **Pragmatic Microservices**

#### Start Simple (Modular Monolith)
- 📁 **Single repository** - All code in one place
- 🖥️ **Single application** - Deploy and debug easily
- 🐛 **Simple debugging** - Breakpoints work across modules
- ⚡ **Fast startup** - Seconds, not minutes
- 🧪 **Integrated testing** - Test module interactions without Docker

#### Scale When Needed (Microservices)
- 🚀 **Extract modules** - One command to microservice
- 🔄 **Zero rewrite** - Same code structure
- 📦 **Independent deployment** - Deploy modules separately
- 🎯 **Gradual migration** - Extract only what you need
- 🏗️ **Same architecture** - Familiar structure everywhere

---

## 🏆 Real-World Impact

### Typical Project Timeline Comparison

**Traditional Approach:**
```
Week 1-2:  Project setup, architecture decisions
Week 3-4:  First module implementation
Week 5-6:  Second module, refactor patterns
Week 7-8:  Third module, stabilize architecture
Week 9+:   Business logic finally starts
```

**With eva4j:**
```
Day 1:     Project setup, 3 modules created, CRUD working
Week 1:    Business logic implementation
Week 2:    Testing and refinement
Week 3+:   More features, not more infrastructure
```

**Result: Ship in 1/3 of the time** while maintaining higher quality standards.

---

## 💡 Development Philosophy

### Without Complex Infrastructure

You **don't need** from day one:
- ❌ Multiple services running
- ❌ Distributed databases
- ❌ Service mesh
- ❌ Complex orchestration
- ❌ Microservices overhead

Instead, you **get**:
- ✅ **Single application** - Simple to develop and debug
- ✅ **Module boundaries** - Enforced by Spring Modulith
- ✅ **Clean architecture** - Ready for extraction
- ✅ **Fast iteration** - Change multiple modules instantly
- ✅ **Microservices ready** - Extract when business requires it

### Result

**Reduce setup time from days to minutes**, maintain architectural consistency, and scale from rapid development to distributed production when actually needed.

## 🎯 Philosophy: Modular Monolith to Microservices

Eva4j follows a **pragmatic approach** to microservices architecture:

### Development Stage: Modular Monolith
- **Single repository** with multiple domain modules
- **Fast development** with shared codebase and immediate refactoring
- **Easy testing** - run entire system locally
- **Simplified debugging** - single application to run
- **Reduced complexity** - no distributed system concerns
- **Spring Modulith** ensures module boundaries and prevents coupling

### Production Stage: Independent Microservices
- **Detach modules** into independent microservices with one command
- **Deploy independently** to production environments
- **Scale individually** based on load requirements
- **Maintain separately** with isolated teams
- **Same codebase structure** - familiar architecture

### Key Benefits
✅ **Faster time-to-market** - develop as monolith, deploy as microservices  
✅ **Lower operational complexity** during development  
✅ **Enforced boundaries** - Spring Modulith validates module independence  
✅ **Zero code rewrite** - detached services maintain the same structure  
✅ **Gradual migration** - extract modules to microservices when needed  

---

## 🚀 Features

- 📦 **Modular Architecture** - Package-by-feature with Spring Modulith
- 🏗️ **Clean/Hexagonal Architecture** - Ports & Adapters pattern
- ⚡ **CQRS Pattern** - Command/Query separation for use cases
- 🔄 **Event-Driven** - Kafka integration for async communication
- 🌐 **HTTP Clients** - Spring Cloud OpenFeign for external services
- 🎯 **Module Detachment** - Extract modules to microservices
- 🗄️ **Multi-Database** - PostgreSQL, MySQL, or H2
- 🔧 **Multi-Environment** - local, develop, test, production configs
- ✨ **Interactive CLI** - Beautiful prompts and validations
- 📝 **Auto Documentation** - Spring Modulith docs generation

---

## 📥 Installation

```bash
npm install -g eva4j
```

Or for local development:

```bash
npm install
npm link
```

---

## 📚 Complete Documentation

### 📖 Command Reference

All commands are fully documented with examples, use cases, and best practices:

**[📑 Complete Commands Index](docs/commands/INDEX.md)** - Full documentation hub

#### Quick Links to Most Used Commands

| Command | Purpose | Documentation |
|---------|---------|---------------|
| `create` | Create new project | [📖 CREATE.md](docs/commands/CREATE.md) |
| `add module` | Add domain module | [📖 ADD_MODULE.md](docs/commands/ADD_MODULE.md) |
| `g entities` | Generate from YAML | [📖 GENERATE_ENTITIES.md](docs/commands/GENERATE_ENTITIES.md) |
| `g usecase` | Create use case | [📖 GENERATE_USECASE.md](docs/commands/GENERATE_USECASE.md) |
| `g resource` | Generate REST API | [📖 GENERATE_RESOURCE.md](docs/commands/GENERATE_RESOURCE.md) |
| `g http` | HTTP client | [📖 GENERATE_HTTP_EXCHANGE.md](docs/commands/GENERATE_HTTP_EXCHANGE.md) |
| `g kafka-event` | Kafka events | [📖 GENERATE_KAFKA_EVENT.md](docs/commands/GENERATE_KAFKA_EVENT.md) |
| `detach` | Extract microservice | [📖 DETACH.md](docs/commands/DETACH.md) |

### 📘 Additional Resources

- **[DOMAIN_YAML_GUIDE.md](DOMAIN_YAML_GUIDE.md)** - Complete YAML syntax reference
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Command cheat sheet  
- **[examples/](examples/)** - 10+ YAML examples for different scenarios

---

## 📚 Commands Documentation

Eva4j provides a comprehensive set of commands for different stages of development. Each command has detailed documentation with examples and best practices.

### Core Commands

| Command | Description | Documentation |
|---------|-------------|---------------|
| **create** | Create a new Spring Boot project with modular architecture | [📖 CREATE.md](docs/commands/CREATE.md) |
| **add module** | Add a new domain module with hexagonal architecture | [📖 ADD_MODULE.md](docs/commands/ADD_MODULE.md) |
| **detach** | Extract a module into an independent microservice | [📖 DETACH.md](docs/commands/DETACH.md) |

### Code Generation Commands

| Command | Description | Documentation |
|---------|-------------|---------------|
| **generate entities** (g entities) | Generate complete domain model from YAML | [📖 GENERATE_ENTITIES.md](docs/commands/GENERATE_ENTITIES.md) |
| **generate usecase** (g usecase) | Create CQRS commands or queries | [📖 GENERATE_USECASE.md](docs/commands/GENERATE_USECASE.md) |
| **generate resource** (g resource) | Generate REST controller with CRUD endpoints | [📖 GENERATE_RESOURCE.md](docs/commands/GENERATE_RESOURCE.md) |
| **generate record** (g record) | Create Java Record for DTOs | [📖 GENERATE_RECORD.md](docs/commands/GENERATE_RECORD.md) |

### Integration Commands

| Command | Description | Documentation |
|---------|-------------|---------------|
| **generate http-exchange** (g http) | Create HTTP client with OpenFeign | [📖 GENERATE_HTTP_EXCHANGE.md](docs/commands/GENERATE_HTTP_EXCHANGE.md) |
| **generate kafka-event** (g kafka-event) | Setup Kafka event publishing | [📖 GENERATE_KAFKA_EVENT.md](docs/commands/GENERATE_KAFKA_EVENT.md) |
| **generate kafka-listener** (g kafka-listener) | Create Kafka event consumer | Coming soon |
| **add kafka-client** | Add Kafka dependencies to module | Coming soon |

### Quick Start Example

```bash
# 1. Create project
eva4j create my-ecommerce
cd my-ecommerce

# 2. Start development services
docker-compose up -d

# 3. Add modules
eva4j add module product
eva4j add module order
eva4j add module customer

# 4. Generate entities from YAML
eva4j g entities product

# 5. Run application
./gradlew bootRun
```

### Command Aliases

For faster development, most generate commands have short aliases:

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

## 📖 Detailed Command Reference

### 1. `create` - Create New Project

Initialize a new Spring Boot project with modular architecture.

```bash
eva4j create <project-name>
```

Creates a production-ready Spring Boot project with:
- ✅ Modular architecture (Spring Modulith)
- ✅ Multi-environment configuration (local, dev, test, prod)
- ✅ Docker Compose with database and Kafka
- ✅ Gradle build with all necessary dependencies
- ✅ Hexagonal architecture structure

**[📖 Full Documentation](docs/commands/CREATE.md)**

---

### 2. `add module` - Add Domain Module

Add a domain module following hexagonal architecture.

```bash
eva4j add module <module-name>
```

Generates a complete module with:
- ✅ Domain layer (entities, value objects, repositories)
- ✅ Application layer (commands, queries, handlers, DTOs)
- ✅ Infrastructure layer (JPA, REST controllers)
- ✅ CQRS pattern ready
- ✅ Spring Modulith boundaries validated

**[📖 Full Documentation](docs/commands/ADD_MODULE.md)**

---

### 3. `generate entities` - Generate Domain Model

Generate complete domain implementation from YAML definition.

```bash
eva4j generate entities <aggregate-name>
eva4j g entities <aggregate-name>    # Short alias
```

Creates from a YAML file:
- ✅ Domain entities and value objects
- ✅ JPA entities and repositories
- ✅ CRUD commands and queries
- ✅ Command/Query handlers
- ✅ DTOs and mappers
- ✅ REST controller

**[📖 Full Documentation](docs/commands/GENERATE_ENTITIES.md)**

**Example YAML:** See [examples/](examples/) directory for complete examples.

---

### 4. Other Commands

For complete documentation on all commands, see:

- **[generate usecase](docs/commands/GENERATE_USECASE.md)** - Create individual CQRS use cases
- **[generate resource](docs/commands/GENERATE_RESOURCE.md)** - Generate REST controllers
- **[generate record](docs/commands/GENERATE_RECORD.md)** - Create Java Records
- **[generate http-exchange](docs/commands/GENERATE_HTTP_EXCHANGE.md)** - HTTP client integration
- **[generate kafka-event](docs/commands/GENERATE_KAFKA_EVENT.md)** - Kafka event publishing
- **[detach](docs/commands/DETACH.md)** - Extract module to microservice

---

## 🎯 Common Workflows

### Workflow 1: Create CRUD Module

```bash
# 1. Add module
eva4j add module product

# 2. Create YAML definition
# Edit examples/product.yaml

# 3. Generate entities
eva4j g entities product

# 4. Run and test
./gradlew bootRun
```

### Workflow 2: Add Custom Use Cases

```bash
# Generate additional commands
eva4j g usecase UpdateProductPrice --type command
eva4j g usecase DeactivateProduct --type command

# Generate custom queries
eva4j g usecase SearchProductsByCategory --type query
eva4j g usecase GetLowStockProducts --type query
```

### Workflow 3: Integrate External Service

```bash
# Create HTTP client
eva4j g http PaymentGateway

# Configure in application.yml
# Implement client methods
# Use in domain through ports
```

### Workflow 4: Event-Driven Communication

```bash
# Publish events
eva4j g kafka-event OrderCreated

# Consume events in another module
eva4j g kafka-listener OrderCreated
```

### Workflow 5: Extract to Microservice

```bash
# When module is mature and needs independence
eva4j detach order

# Result: order-service/ as standalone application
```

---

## 🎓 Additional Resources

- **[DOMAIN_YAML_GUIDE.md](DOMAIN_YAML_GUIDE.md)** - Complete YAML syntax reference
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Command cheat sheet
- **[examples/](examples/)** - YAML examples for different scenarios

---

### 3. Legacy Reference (Deprecated Section)

For backward compatibility, here's the old reference format:

### `add kafka-client` - Add Kafka Support

Install Kafka dependencies and configuration.

```bash
eva4j add kafka-client
```

**What it does:**
- Adds `spring-kafka` dependencies to build.gradle
- Creates kafka.yml configuration for all environments
- Generates KafkaConfig.java in shared module
- Updates application-*.yml to import kafka.yml

**Generated Configuration:**
```yaml
# parameters/local/kafka.yml
spring.kafka:
  bootstrap-servers: localhost:9092
  consumer:
    group-id: ${spring.application.name}
  topics:
    # Topics will be added by generate kafka-event
```

**Example:**
```bash
eva4j add kafka-client
```

---

### 4. `generate usecase` (alias: `g usecase`)

Create a use case (command or query) following CQRS pattern.

```bash
eva4j generate usecase <module-name> [usecase-name]
eva4j g usecase <module-name> [usecase-name]
```

**Interactive Prompts:**
- Use case name (if not provided)
- Type: Command (write) or Query (read)

**Command Pattern** (write operations):
```java
// CreateUserCommand.java
public record CreateUserCommand(String name, String email) {}

// CreateUserCommandHandler.java
@ApplicationComponent
public class CreateUserCommandHandler {
    public UserResponseDto handle(CreateUserCommand command) {
        // Business logic
    }
}
```

**Query Pattern** (read operations):
```java
// FindUserByIdQuery.java
public record FindUserByIdQuery(UUID id) {}

// FindUserByIdQueryHandler.java
@ApplicationComponent  
public class FindUserByIdQueryHandler {
    public UserResponseDto handle(FindUserByIdQuery query) {
        // Business logic
    }
}

// UserResponseDto.java
public record UserResponseDto(UUID id, String name, String email) {}
```

**Examples:**
```bash
eva4j g usecase user create-user      # Command
eva4j g usecase user find-user-by-id  # Query
eva4j g usecase product update-stock  # Command
```

---

### 5. `generate resource` (alias: `g resource`)

Generate complete REST resource with full CRUD operations.

```bash
eva4j generate resource <module-name>
eva4j g resource <module-name>
```

**Interactive Prompts:**
- Resource name (default: module name)
- API version (default: v1)

**What it generates:**
- 5 Use Cases (Create, Update, Delete, FindById, FindAll)
- Response DTO
- REST Controller with 5 endpoints

**Generated Endpoints:**
```java
@RestController
@RequestMapping("/api/v1/users")
public class UserController {
    
    @PostMapping                          // POST /api/v1/users
    @GetMapping("/{id}")                  // GET /api/v1/users/{id}
    @GetMapping                           // GET /api/v1/users
    @PutMapping("/{id}")                  // PUT /api/v1/users/{id}
    @DeleteMapping("/{id}")               // DELETE /api/v1/users/{id}
}
```

**Example:**
```bash
eva4j g resource user
eva4j g resource product
```

---

### 6. `generate http-exchange` (alias: `g http-exchange`)

Create HTTP client adapter using Spring Cloud OpenFeign.

```bash
eva4j generate http-exchange <module-name> [port-name]
eva4j g http-exchange <module-name> [port-name]
```

**Interactive Prompts:**
- Port name (if not provided)
- Base URL of remote service

**Generated Structure:**
```java
// application/ports/ProductService.java
public interface ProductService {
    ProductDto getProduct(UUID id);
}

// infrastructure/adapters/productService/ProductServiceAdapter.java
@Component
public class ProductServiceAdapter implements ProductService {
    private final ProductServiceFeignClient client;
    // Implementation
}

// infrastructure/adapters/productService/ProductServiceFeignClient.java
@FeignClient(name = "product-service", url = "${urls.product-service}")
public interface ProductServiceFeignClient {
    @GetMapping("/api/v1/products/{id}")
    ProductDto getProduct(@PathVariable UUID id);
}
```

**Configuration Added:**
```yaml
# parameters/local/urls.yml
urls:
  product-service: http://localhost:8041
```

**Example:**
```bash
eva4j g http-exchange order product-service
eva4j g http-exchange user payment-gateway
```

---

### 7. `generate kafka-event` (alias: `g kafka-event`)

Create Kafka event publisher with topic configuration.

```bash
eva4j generate kafka-event <module-name> [event-name]
eva4j g kafka-event <module-name> [event-name]
```

**Prerequisites:** Kafka client must be installed

**Interactive Prompts:**
- Event name (if not provided)
- Number of partitions (default: 3)
- Number of replicas (default: 1)

**Generated Structure:**
```java
// application/events/UserCreatedEvent.java
public record UserCreatedEvent(UUID id, String name, String email) {}

// application/ports/MessageBroker.java (created/updated)
public interface MessageBroker {
    void publishUserCreatedEvent(UserCreatedEvent event);
}

// infrastructure/adapters/kafkaMessageBroker/KafkaMessageBroker.java
@Component
public class KafkaMessageBroker implements MessageBroker {
    public void publishUserCreatedEvent(UserCreatedEvent event) {
        kafkaTemplate.send("USER_CREATED", envelope);
    }
}
```

**Configuration Added:**
```yaml
# parameters/local/kafka.yml
spring.kafka:
  topics:
    user-created: USER_CREATED
```

**Usage in Code:**
```java
@ApplicationComponent
public class CreateUserCommandHandler {
    private final MessageBroker messageBroker;
    
    public UserResponseDto handle(CreateUserCommand command) {
        // ... create user
        messageBroker.publishUserCreatedEvent(
            new UserCreatedEvent(user.getId(), user.getName(), user.getEmail())
        );
        return dto;
    }
}
```

**Example:**
```bash
eva4j g kafka-event user user-created
eva4j g kafka-event order order-placed
eva4j g kafka-event product stock-updated
```

---

### 8. `generate kafka-listener` (alias: `g kafka-listener`)

Create Kafka event listeners/consumers.

```bash
eva4j generate kafka-listener <module-name>
eva4j g kafka-listener <module-name>
```

**Prerequisites:** 
- Kafka client must be installed
- At least one topic must exist in kafka.yml

**Interactive Prompts:**
- Select topics to listen to (checkbox, multiple selection)

**Generated Structure:**
```java
// infrastructure/kafkaListener/KafkaController.java (created/updated)
@RestController
@RequestMapping("/kafka")
public class KafkaController {
    
    @KafkaListener(
        topics = "#{@kafkaTopics.getUserCreated()}", 
        groupId = "${spring.kafka.consumer.group-id}"
    )
    public void handleUserCreatedListener(
        @Payload EventEnvelope<String> envelope,
        @Header(KafkaHeaders.RECEIVED_KEY) UUID key
    ) {
        // Handle event
        log.info("Received user-created event: {}", envelope);
    }
}
```

**Example:**
```bash
eva4j g kafka-listener notification
# Select: user-created, order-placed
```

---

### 9. `detach` - Extract Module to Microservice

Extract a module from the monolith into an independent microservice.

```bash
eva4j detach [module-name]
```

**Interactive Prompts:**
- Module name (if not provided)
- Confirmation with summary

**What it does:**
1. Creates new project in sibling directory (`{module-name}_msvc`)
2. Copies entire module directory
3. Merges shared components into module/domain and module/infrastructure
4. Updates all package references (shared → module-name)
5. Copies test files
6. Copies environment configurations (develop, test, production)
7. Copies parameters folder (kafka.yml, urls.yml)
8. Updates Kafka configuration references
9. Removes Spring Modulith dependencies
10. Increments server port (+1)
11. Uses parent's database configuration

**Example:**
```bash
# In monolith project
eva4j detach user

# Creates: ../user_msvc/
# Port: parent port + 1
# Database: same as parent
# Structure: standalone microservice
```

**Generated Microservice:**
```
user_msvc/
├── build.gradle           # NO Spring Modulith, includes Kafka if parent has it
├── .eva4j.json           # Independent configuration
└── src/
    ├── main/java/.../user/
    │   ├── domain/
    │   │   ├── annotations/      # Merged from shared
    │   │   ├── customExceptions/ # Merged from shared
    │   │   └── models/           # Original module entities
    │   ├── infrastructure/
    │   │   ├── configurations/   # Merged from shared
    │   │   ├── filters/          # Merged from shared
    │   │   ├── database/         # Original module repos
    │   │   └── rest/             # Original module controllers
    │   └── application/          # Original module use cases
    └── resources/
        ├── application.yml         # Updated port
        ├── application-develop.yml # Copied from parent
        └── parameters/             # Copied and updated
            └── */kafka.yml         # Package refs updated
```

**Deploy Strategy:**
```bash
# Development: Run monolith
cd my-shop
./gradlew bootRun

# Production: Deploy microservices
cd user_msvc && ./gradlew bootJar
cd order_msvc && ./gradlew bootJar
cd product_msvc && ./gradlew bootJar
```

---

### 10. `info` - View Project Information

Display project configuration and module history.

```bash
eva4j info
```

**Output Example:**
```
📦 Eva4j Project Information

Project Details:
  Name:              my-shop
  Group ID:          com.company
  Artifact ID:       my-shop
  Package:           com.company.myshop
  Database:          postgresql

Versions:
  Java:              21
  Spring Boot:       3.5.5
  Spring Modulith:   1.4.6

Dependencies:
  • web
  • data-jpa
  • validation
  • actuator

Features:
  • kafka

Modules:
  • user (soft-delete, audit) - Created: 2026-01-27
  • product (soft-delete, audit) - Created: 2026-01-27
  • order (soft-delete, audit) - Created: 2026-01-28

Timestamps:
  Created:           1/27/2026, 10:25:00 AM
  Last Updated:      1/28/2026, 3:45:00 PM
```

---

## 🏗️ Development Workflow

### Phase 1: Modular Monolith Development

```bash
# 1. Create project
eva4j create e-commerce
cd e-commerce

# 2. Add modules
eva4j add module user
eva4j add module product
eva4j add module order

# 3. Generate resources
eva4j g resource user
eva4j g resource product
eva4j g resource order

# 4. Add event-driven communication
eva4j add kafka-client
eva4j g kafka-event order order-placed
eva4j g kafka-listener notification

# 5. Add external service clients
eva4j g http-exchange order payment-service

# 6. Run entire system locally
./gradlew bootRun
# All modules run in single JVM on port 8040
```

**Benefits during development:**
- ✅ Fast compilation and restart
- ✅ Easy debugging with breakpoints across modules
- ✅ Simple testing without container orchestration
- ✅ Immediate refactoring across modules
- ✅ Spring Modulith validates module boundaries

---

### Phase 2: Production Microservices

```bash
# Extract modules to microservices
eva4j detach user       # Port 8041
eva4j detach product    # Port 8042  
eva4j detach order      # Port 8043

# Deploy independently
cd ../user_msvc
./gradlew bootJar
docker build -t user-service .
kubectl apply -f k8s/user-service.yaml

cd ../product_msvc
./gradlew bootJar
docker build -t product-service .
kubectl apply -f k8s/product-service.yaml

cd ../order_msvc
./gradlew bootJar
docker build -t order-service .
kubectl apply -f k8s/order-service.yaml
```

**Benefits in production:**
- ✅ Independent scaling (scale order service 10x, user service 2x)
- ✅ Isolated deployments (update order service without touching users)
- ✅ Team autonomy (different teams own different services)
- ✅ Technology flexibility (add Kotlin to new service if needed)
- ✅ Fault isolation (product service down doesn't crash orders)

---

## 📁 Project Structure

```
my-project/
├── build.gradle                    # Dependencies with Spring Modulith
├── settings.gradle
├── .eva4j.json                     # Project configuration
├── docker-compose.yml              # Local database
├── README.md
└── src/
    ├── main/
    │   ├── java/com/company/myproject/
    │   │   ├── Application.java               # Main class
    │   │   ├── shared/                        # Cross-cutting concerns
    │   │   │   ├── domain/
    │   │   │   │   ├── annotations/           # @DomainComponent
    │   │   │   │   ├── customExceptions/      # Domain exceptions
    │   │   │   │   ├── errorMessage/          # Error messages
    │   │   │   │   └── interfaces/            # Base entities
    │   │   │   └── infrastructure/
    │   │   │       ├── configurations/        # Swagger, Jackson
    │   │   │       ├── eventEnvelope/         # Event wrapper
    │   │   │       ├── filters/               # Logging filters
    │   │   │       └── handlerException/      # Global handler
    │   │   ├── user/                          # User module
    │   │   │   ├── package-info.java          # @ApplicationModule
    │   │   │   ├── application/               # Use cases layer
    │   │   │   │   ├── commands/
    │   │   │   │   ├── queries/
    │   │   │   │   ├── usecases/
    │   │   │   │   ├── dtos/
    │   │   │   │   ├── events/
    │   │   │   │   ├── mappers/
    │   │   │   │   └── ports/
    │   │   │   ├── domain/                    # Domain layer
    │   │   │   │   ├── models/
    │   │   │   │   │   ├── entities/
    │   │   │   │   │   └── valueObjects/
    │   │   │   │   ├── repositories/
    │   │   │   │   └── services/
    │   │   │   └── infrastructure/            # Infrastructure layer
    │   │   │       ├── adapters/
    │   │   │       ├── database/
    │   │   │       ├── kafkaListener/
    │   │   │       └── rest/
    │   │   │           ├── controllers/
    │   │   │           └── validators/
    │   │   └── product/                       # Product module
    │   │       └── ... (same structure)
    │   └── resources/
    │       ├── application.yml                # Main config (port 8040)
    │       ├── application-local.yml          # Local profile
    │       ├── application-develop.yml        # Development profile
    │       ├── application-test.yml           # Test profile
    │       ├── application-production.yml     # Production profile
    │       └── parameters/
    │           ├── local/
    │           │   ├── kafka.yml              # Kafka config (localhost)
    │           │   └── urls.yml               # Service URLs (localhost)
    │           ├── develop/
    │           │   ├── kafka.yml
    │           │   └── urls.yml
    │           ├── test/
    │           │   ├── kafka.yml
    │           │   └── urls.yml
    │           └── production/
    │               ├── kafka.yml
    │               └── urls.yml
    └── test/
        └── java/com/company/myproject/
            └── ApplicationTests.java
```

---

## 🎓 Architecture Principles

### Hexagonal Architecture (Ports & Adapters)

```
┌─────────────────────────────────────┐
│         Infrastructure              │
│  (REST, Kafka, Database, HTTP)      │
└─────────────┬───────────────────────┘
              │ Adapters
┌─────────────▼───────────────────────┐
│         Application                 │
│   (Use Cases, Ports, DTOs)          │
└─────────────┬───────────────────────┘
              │ Uses
┌─────────────▼───────────────────────┐
│         Domain                      │
│  (Entities, Value Objects, Logic)   │
└─────────────────────────────────────┘
```

**Domain Layer:** Pure business logic, no frameworks  
**Application Layer:** Use cases, coordinates domain and infrastructure  
**Infrastructure Layer:** Framework integration (Spring, JPA, Kafka)

---

### CQRS Pattern

**Commands** (write operations):
```java
record CreateUserCommand(String name, String email) {}

@ApplicationComponent
class CreateUserCommandHandler {
    public UserResponseDto handle(CreateUserCommand command) {
        // Validate, create entity, persist, publish event
    }
}
```

**Queries** (read operations):
```java
record FindUserQuery(UUID id) {}

@ApplicationComponent  
class FindUserQueryHandler {
    public UserResponseDto handle(FindUserQuery query) {
        // Fetch and return data
    }
}
```

---

### Spring Modulith Boundaries

```java
@ApplicationModule
package com.company.myproject.user;

// ✅ Allowed: user → shared
// ✅ Allowed: user.infrastructure → user.application → user.domain
// ❌ Forbidden: user → product (direct module dependency)
// ❌ Forbidden: user.domain → user.infrastructure (wrong direction)
```

**Validation:**
```bash
./gradlew test
# Spring Modulith validates architecture at test time
# Generates documentation at target/spring-modulith-docs/
```

---

## 🌍 Environment Management

Eva4j projects support 4 environments out of the box:

| Environment | Profile | Use Case | Config File |
|-------------|---------|----------|-------------|
| **local** | `local` | Developer machine | `application-local.yml` |
| **develop** | `develop` | Development server | `application-develop.yml` |
| **test** | `test` | QA/Staging | `application-test.yml` |
| **production** | `production` | Production | `application-production.yml` |

**Run with profile:**
```bash
# Local (default)
./gradlew bootRun

# Development server
./gradlew bootRun --args='--spring.profiles.active=develop'

# Production
java -jar app.jar --spring.profiles.active=production
```

**Environment-specific Kafka & URLs:**
```
resources/parameters/
├── local/
│   ├── kafka.yml     # bootstrap-servers: localhost:9092
│   └── urls.yml      # product-service: http://localhost:8041
├── develop/
│   ├── kafka.yml     # bootstrap-servers: dev-kafka.company.com:9092
│   └── urls.yml      # product-service: https://dev-product.company.com
└── production/
    ├── kafka.yml     # bootstrap-servers: prod-kafka.company.com:9092
    └── urls.yml      # product-service: https://product.company.com
```

---

## 🧪 Testing

```bash
# Run all tests
./gradlew test

# Run specific module tests
./gradlew :test --tests com.company.myproject.user.*

# Spring Modulith generates architecture docs
# Check: target/spring-modulith-docs/
```

---

## 📖 Additional Documentation

- **[USAGE.md](USAGE.md)** - Detailed usage guide with examples
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Quick command reference
- **[TESTING_GUIDE.md](TESTING_GUIDE.md)** - Testing best practices
- **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - Implementation details

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or pull request.

---

## 📄 License

MIT License - see LICENSE file for details

---

## 🙏 Acknowledgments

- Spring Boot & Spring Modulith teams
- Hexagonal Architecture by Alistair Cockburn
- CQRS pattern by Greg Young

---

**Built with ❤️ for pragmatic developers who value speed and flexibility**
