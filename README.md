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
eva create my-ecommerce
cd my-ecommerce

# Add a module
eva add module product

# Generate full CRUD from YAML
eva g entities product

# 🎉 Done! You have:
# ✅ Domain entities with business logic
# ✅ JPA repositories and mappers
# ✅ CQRS commands and queries
# ✅ REST API with pagination
# ✅ Complete hexagonal architecture
```

---

## 💎 Why eva4j?

### The real problem: AI agents cannot generate production-quality code directly

The biggest bottleneck is no longer writing repetitive code — it's the gap between **business requirements** and **production code with the right architecture**.

Teams today try to solve this in two ways, both with serious problems:

**Option A — Direct prompt to the agent:** _"Create an inventory system with Spring Boot, PostgreSQL, Kafka, hexagonal architecture, CQRS..."_

The agent generates something... but:
- ❌ Architecture varies between modules — inconsistent
- ❌ Hexagonal patterns are applied partially or incorrectly
- ❌ No convention on where each class belongs
- ❌ The code doesn't compile as a whole
- ❌ Each regeneration produces something different
- ❌ Impossible to iterate incrementally

**Option B — Spec Driven Development (SDD):** _"Given this functional specification document, generate the code following these patterns..."_

One step ahead of the free prompt: instead of an informal description, the agent receives a more structured functional specification — use cases, flows, business rules. The agent generates more organized code, but the underlying problem remains:

- ⚠️ The agent must simultaneously focus on **two different planes**: interpreting the functional domain and producing code with the right architecture — and it tends to lose one when it digs into the other
- ⚠️ Functional specifications don't dictate technical structure: the agent makes architecture decisions each session, producing different results
- ⚠️ Ensuring consistency across modules requires ever more exhaustive specifications — and even then the generated code needs deep review
- ⚠️ Every requirement change means regenerating and manually auditing the code to detect accumulated regressions or inconsistencies
- ⚠️ **A change in the system definition translates into a code refactoring** — with hard-to-measure impact, prone to integration errors, and potentially affecting modules that appear unrelated to the change
- ⚠️ Before working on business logic, the team must stand up the entire infrastructure (database, messaging broker)

SDD improves the situation, but **still sends the agent to the wrong plane**: from the functional specification straight to code — skipping a fundamental intermediate layer.

---

### The new vision: technology-agnostic technical specifications as an intermediate step

The problem with SDD is not the specification itself — it's that the **functional** specification is converted directly into code. The solution is to introduce an intermediate step: transform functional requirements into **technology-agnostic technical specifications** before generating a single line of code.

These technical specifications don't talk about Spring Boot, JPA or Kafka. They talk about **domain entities, lifecycles, events, relationships between modules and API contracts**. They are understandable by the agent, the business team, and the generator — and can be reviewed, discussed, and iterated without touching code.

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 1 — Functional requirements                              │
│  (business describes what the system must do)                   │
└───────────────────────────────┬──────────────────────────────────┘
                                │  AI agent
                                │  (translates domain into structure)
┌───────────────────────────────▼──────────────────────────────────┐
│  LAYER 2 — Technology-agnostic technical specification          │
│  (agent + team iterate here — no code)                          │
│                                                                  │
│  system.yaml + {module}.yaml                                    │
│  • Which modules (bounded contexts) make up the system?         │
│  • How many aggregates does each module have?                   │
│  • Which entities form each aggregate? Which is the root?       │
│  • What fields and types does each entity have?                 │
│  • What lifecycle do entities have (states/transitions)?        │
│  • What events occur? Who produces them and who consumes them?  │
│  • How do modules communicate with each other?                  │
│  • What endpoints does each module expose and what use case?    │
│                                                                  │
│  Reviewable · Versionable · Evaluable · Iterable                │
│  without needing to generate any code                           │
└───────────────────────────────┬──────────────────────────────────┘
                                │  eva build
                                │  (when the team validates
                                │  that the specification is correct)
┌───────────────────────────────▼──────────────────────────────────┐
│  LAYER 3 — Code  (eva4j generates, team completes)              │
│                                                                  │
│  technical specification  ──▶  functional Spring Boot prototype │
│                               • Compiles from the first build   │
│                               • Endpoints respond immediately   │
│                               • No infrastructure required      │
│                                 (--mock: H2 + Spring Events)    │
└──────────────────────────────────────────────────────────────────┘
```

**The agent does what it does well:** translating functional requirements into technology-agnostic technical specifications — modeling the domain, identifying entities, defining lifecycles, designing contracts between modules. The result is a precise and verifiable YAML, not code.

**The team validates the specification** before a single line of Java exists — discussing entities, relationships and flows in a format readable by everyone.

**eva4j does what the agent cannot do reliably:** converting that specification into code with correct hexagonal architecture, CQRS, DDD patterns and multi-environment configuration — identically every time, no matter how many times it runs.

---

### From prototype to production with minimal friction

Eva4j does not generate a production-ready complete system in a single step — it generates a **functional and correct prototype** that the team can complement and iterate from day one:

| What `eva build` delivers | What the team completes |
|---|---|
| Domain entities with constructors, getters and lifecycle methods | Domain-specific business logic |
| Correctly structured CQRS handlers | The body of each handler (`UnsupportedOperationException` as a visible placeholder) |
| JSR-303 validations, DTOs, Application↔Domain↔JPA mappers | Complex business validations and cross-aggregate rules |
| Kafka, Feign, JPA multi-environment configuration | Specific queries, indexes, performance tuning |
| REST endpoints that respond from day 1 | Edge cases, business error handling |
| Optional mock infrastructure (H2 + Spring Events) | Integration with real infrastructure when the model is validated |

**The full cycle:**

1. The agent generates specifications from business requirements (`system.yaml` + `{module}.yaml`)
2. The team reviews and validates that the specification correctly reflects the domain — without seeing code
3. `eva build` → the prototype starts; endpoints respond; the team completes business logic **from day 1 without infrastructure**
4. Requirements evolve → update the YAML → `eva build` regenerates safely (checksums protect manual modifications)
5. When the prototype meets all verified requirements, moving to production is a configuration change — not a rewrite

**A change in the system definition is a YAML diff — not a code refactoring.** The impact is always measurable: exactly the files that correspond to what changed in the specification. The new build faithfully reflects the new design, with no residue from the previous one.

---

### The Solution

eva4j provides:
- ✅ **Specification as contract** - The YAML is the artifact that the agent, the team and the generator share — reviewable, versionable, evaluable before generating a single line of code
- ✅ **Deterministic generation** - The same YAML always produces the same code, with no session-to-session variations
- ✅ **Functional prototype from day 1** - The team works on business logic while the specification continues to be refined
- ✅ **No infrastructure from the start** - `--mock` replaces Kafka and the DB with in-memory equivalents
- ✅ **Safe iteration** - Checksums prevent overwriting manual modifications on regeneration
- ✅ **Consistent architecture** - Same patterns across all modules, no architectural drift
- ✅ **Technology-agnostic specification** - The YAML describes domain structure, not framework details — while the current generator targets Spring Boot, the same specification is designed to power generators for other stacks and languages

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

## 📐 Specification Files: `system/`

eva4j projects store their specifications in the `system/` directory. These are the files an AI agent produces when designing a system: declarative structure, no side effects, verifiable before any code generation runs.

```
system/
├── system.yaml          # Global architecture: modules, database, messaging, integrations
├── product.yaml         # Domain model for the product module
├── notification.yaml    # Domain model for the notification module
└── order.yaml           # Domain model for the order module
```

### `system.yaml` — The System Architecture

Defines which modules exist, how they communicate, and what infrastructure they use.

```yaml
system:
  name: product-catalog
  groupId: com.example
  javaVersion: 21
  springBootVersion: 3.5.5
  database: postgresql           # postgresql | mysql | h2

messaging:
  enabled: true
  broker: kafka
  kafka:
    bootstrapServers: localhost:9092
    defaultGroupId: product-catalog

modules:
  - name: product
    description: "Product catalogue. Lifecycle: DRAFT → PUBLISHED → DISCONTINUED."
    exposes:
      - method: POST
        path: /products
        useCase: CreateProduct
      - method: GET
        path: /products/{id}
        useCase: GetProduct
      - method: PUT
        path: /products/{id}/publish
        useCase: PublishProduct
        description: "Transition DRAFT → PUBLISHED. Emits ProductPublishedEvent."

  - name: notification
    description: "Notifications via EMAIL, SMS or PUSH. Reacts to product domain events."
    exposes:
      - method: PUT
        path: /notifications/{id}/read
        useCase: MarkNotificationRead

integrations:
  async:
    # Which module produces each event and which module consumes it
    - event: ProductPublishedEvent
      producer: product
      topic: PRODUCT_PUBLISHED
      consumers:
        - module: notification
          useCase: SendProductPublishedNotification
```

`eva build` reads this file and generates: modules with complete hexagonal architecture, Kafka dependencies, `KafkaConfig.java`, REST endpoints with their use cases, Integration Events, KafkaListeners and consumer CommandHandlers.

---

### `{module}.yaml` — The Domain Model

Each module has its own YAML that defines the complete domain model: entities, value objects, enums with lifecycle transitions, relationships, events and ports.

```yaml
# system/product.yaml
aggregates:
  - name: Product
    entities:
      - name: Product
        isRoot: true
        tableName: products
        audit:
          enabled: true
          trackUser: true
        fields:
          - name: id
            type: String
          - name: name
            type: String
            validations:
              - type: NotBlank
                message: "Product name is required"
          - name: price
            type: Price          # Value Object defined below
          - name: status
            type: ProductStatus  # Enum with lifecycle transitions
            readOnly: true       # Excluded from CreateDto and business constructor

    valueObjects:
      - name: Price
        fields:
          - name: amount
            type: BigDecimal
          - name: currency
            type: String
        methods:
          - name: isPositive
            returnType: boolean
            parameters: []
            body: "return this.amount.compareTo(BigDecimal.ZERO) > 0;"

    enums:
      - name: ProductStatus
        initialValue: DRAFT
        transitions:
          - from: DRAFT
            to: PUBLISHED
            method: publish
          - from: [DRAFT, PUBLISHED]
            to: DISCONTINUED
            method: discontinue
        values: [DRAFT, PUBLISHED, DISCONTINUED]

    events:
      - name: ProductPublishedEvent
        triggers: [publish]         # raise() automatically injected inside publish()
        fields:
          - name: productId
            type: String
          - name: publishedAt
            type: LocalDateTime

# Consuming external events
listeners:
  - event: OrderPlacedEvent
    producer: orders
    topic: ORDER_PLACED
    useCase: UpdateProductStock
    fields:
      - name: orderId
        type: String
      - name: quantity
        type: Integer

# Synchronous HTTP clients
ports:
  - name: findCategoryById
    service: CategoryService
    target: categories
    baseUrl: http://localhost:8040
    http: GET /categories/{id}
    fields:
      - name: id
        type: String
      - name: name
        type: String
```

`eva g entities product` generates from this single YAML: domain entity (no setters, no empty constructor), JPA entity, repository, lifecycle methods (`publish()`, `discontinue()`, `canPublish()`, `isPublished()`), Integration Event, `MessageBroker` port, `KafkaMessageBroker` adapter, consumer `KafkaListener`, `FeignClient` with ACL, `CreateProductCommand`, `ProductResponseDto`, Application↔Domain↔JPA mappers and `ProductController`.

---

### The AI → YAML → Code cycle

```bash
# 1. The AI agent generates the YAMLs from business requirements
#    → system/system.yaml, system/product.yaml, system/notification.yaml

# 2. One command turns the entire specification into code
eva build
#    ✅ Modules created with full hexagonal architecture
#    ✅ Kafka configured and wired
#    ✅ Entities, handlers, DTOs, mappers generated
#    ✅ The project compiles and starts immediately

./gradlew bootRun   # Endpoints already respond

# 3. The developer implements only the domain-specific business logic
#    Handlers have UnsupportedOperationException as a visible placeholder
#    Entities have the correct structure ready to be completed

# 4. When the domain evolves, update the YAMLs and regenerate
eva build           # Checksums protect manual modifications
```

### `eva build --mock` — Iterate without external infrastructure

Develop without needing to start Kafka or a real database:

```bash
eva build --mock               # DB → H2 in-memory  +  Kafka → Spring Event bus
eva build --mock --only-broker # Broker only, keeps the configured database
eva build                      # Restores the original configuration
```

| Flag | Database | Broker |
|---|---|---|
| `eva build --mock` | H2 in-memory | Spring Event bus |
| `eva build --mock --only-broker` | Unchanged (PostgreSQL/MySQL) | Spring Event bus |
| `eva build` (restore) | Original | Kafka |

The original configuration is saved to `.eva4j.json` and restored automatically.

---

## �📥 Installation

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
| `g temporal-flow` | Temporal workflow | [📖 GENERATE_TEMPORAL_FLOW.md](docs/commands/GENERATE_TEMPORAL_FLOW.md) |
| `g temporal-activity` | Temporal activity | [📖 GENERATE_TEMPORAL_ACTIVITY.md](docs/commands/GENERATE_TEMPORAL_ACTIVITY.md) |
| `detach` | Extract microservice | [📖 DETACH.md](docs/commands/DETACH.md) |

### 📘 Additional Resources

- **[DOMAIN_YAML_GUIDE.md](DOMAIN_YAML_GUIDE.md)** - Complete YAML syntax reference
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Command cheat sheet  
- **[examples/](examples/)** - 10+ YAML examples for different scenarios
- **[docs/CHOREOGRAPHY_SAGAS_GUIDE.md](docs/CHOREOGRAPHY_SAGAS_GUIDE.md)** - Choreography sagas: single, chained and parallel compensation patterns
- **[docs/KAFKA_PRODUCTION_CONFIG.md](docs/KAFKA_PRODUCTION_CONFIG.md)** - Kafka production configuration reference
- **[docs/RABBITMQ_PRODUCTION_CONFIG.md](docs/RABBITMQ_PRODUCTION_CONFIG.md)** - RabbitMQ production configuration reference

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
| **generate kafka-listener** (g kafka-listener) | Create Kafka event consumer | [📖 GENERATE_KAFKA_LISTENER.md](docs/commands/GENERATE_KAFKA_LISTENER.md) |
| **add kafka-client** | Add Kafka dependencies to module | Coming soon |
| **add temporal-client** | Add Temporal SDK and worker infrastructure | Coming soon |
| **generate temporal-flow** (g temporal-flow) | Create Temporal workflow with Saga | [📖 GENERATE_TEMPORAL_FLOW.md](docs/commands/GENERATE_TEMPORAL_FLOW.md) |
| **generate temporal-activity** (g temporal-activity) | Create Temporal activity (Light or Heavy) | [📖 GENERATE_TEMPORAL_ACTIVITY.md](docs/commands/GENERATE_TEMPORAL_ACTIVITY.md) |

### Quick Start Example

```bash
# 1. Create project
eva create my-ecommerce
cd my-ecommerce

# 2. Start development services
docker-compose up -d

# 3. Add modules
eva add module product
eva add module order
eva add module customer

# 4. Generate entities from YAML
eva g entities product

# 5. Run application
./gradlew bootRun
```

### Command Aliases

For faster development, most generate commands have short aliases:

```bash
eva g entities <name>           # generate entities
eva g usecase <name>            # generate usecase  
eva g resource <name>           # generate resource
eva g record <name>             # generate record
eva g http <name>               # generate http-exchange
eva g kafka-event <name>        # generate kafka-event
eva g kafka-listener <name>     # generate kafka-listener
eva g temporal-flow <module>    # generate temporal-flow
eva g temporal-activity <module># generate temporal-activity
```

---

## 📖 Detailed Command Reference

### 1. `create` - Create New Project

Initialize a new Spring Boot project with modular architecture.

```bash
eva create <project-name>
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
eva add module <module-name>
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
eva generate entities <aggregate-name>
eva g entities <aggregate-name>    # Short alias
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
eva add module product

# 2. Create YAML definition
# Edit examples/product.yaml

# 3. Generate entities
eva g entities product

# 4. Run and test
./gradlew bootRun
```

### Workflow 2: Add Custom Use Cases

```bash
# Generate additional commands
eva g usecase UpdateProductPrice --type command
eva g usecase DeactivateProduct --type command

# Generate custom queries
eva g usecase SearchProductsByCategory --type query
eva g usecase GetLowStockProducts --type query
```

### Workflow 3: Integrate External Service

```bash
# Create HTTP client
eva g http PaymentGateway

# Configure in application.yaml
# Implement client methods
# Use in domain through ports
```

### Workflow 4: Event-Driven Communication

```bash
# Publish events
eva g kafka-event OrderCreated

# Consume events in another module
eva g kafka-listener OrderCreated
```

### Workflow 5: Extract to Microservice

```bash
# When module is mature and needs independence
eva detach order

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
eva add kafka-client
```

**What it does:**
- Adds `spring-kafka` dependencies to build.gradle
- Creates kafka.yaml configuration for all environments
- Generates KafkaConfig.java in shared module
- Updates application-*.yaml to import kafka.yaml

**Generated Configuration:**
```yaml
# parameters/local/kafka.yaml
spring.kafka:
  bootstrap-servers: localhost:9092
  consumer:
    group-id: ${spring.application.name}
  topics:
    # Topics will be added by generate kafka-event
```

**Example:**
```bash
eva add kafka-client
```

---

### 4. `generate usecase` (alias: `g usecase`)

Create a use case (command or query) following CQRS pattern.

```bash
eva generate usecase <module-name> [usecase-name]
eva g usecase <module-name> [usecase-name]
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
eva g usecase user create-user      # Command
eva g usecase user find-user-by-id  # Query
eva g usecase product update-stock  # Command
```

---

### 5. `generate resource` (alias: `g resource`)

Generate complete REST resource with full CRUD operations.

```bash
eva generate resource <module-name>
eva g resource <module-name>
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
eva g resource user
eva g resource product
```

---

### 6. `generate http-exchange` (alias: `g http-exchange`)

Create HTTP client adapter using Spring Cloud OpenFeign.

```bash
eva generate http-exchange <module-name> [port-name]
eva g http-exchange <module-name> [port-name]
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
# parameters/local/urls.yaml
urls:
  product-service: http://localhost:8041
```

**Example:**
```bash
eva g http-exchange order product-service
eva g http-exchange user payment-gateway
```

---

### 7. `generate kafka-event` (alias: `g kafka-event`)

Create Kafka event publisher with topic configuration.

```bash
eva generate kafka-event <module-name> [event-name]
eva g kafka-event <module-name> [event-name]
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

// infrastructure/adapters/kafkaMessageBroker/UsersKafkaMessageBroker.java
@Component("usersKafkaMessageBroker")
public class UsersKafkaMessageBroker implements MessageBroker {
    public void publishUserCreatedEvent(UserCreatedEvent event) {
        kafkaTemplate.send("USER_CREATED", envelope);
    }
}
```

**Configuration Added:**
```yaml
# parameters/local/kafka.yaml
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
eva g kafka-event user user-created
eva g kafka-event order order-placed
eva g kafka-event product stock-updated
```

---

### 8. `generate kafka-listener` (alias: `g kafka-listener`)

Create individual Kafka event listener classes for consuming events from topics.

```bash
eva generate kafka-listener <module-name>
eva g kafka-listener <module-name>
```

**Prerequisites:** 
- Kafka client must be installed
- At least one topic must exist in kafka.yaml

**Interactive Prompts:**
- Select topics to listen to (checkbox, multiple selection)

**Generated Structure:**
```java
// infrastructure/kafkaListener/UserUserCreatedListener.java (one class per topic)
@Component("userUserCreatedListener")
public class UserUserCreatedListener {
    
    private final UseCaseMediator useCaseMediator;
    
    @Value("${topics.user-created}")
    private String userCreatedTopic;
    
    public UserUserCreatedListener(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }
    
    @KafkaListener(topics = "${topics.user-created}")
    public void handle(EventEnvelope<Map<String, Object>> event, Acknowledgment ack) {
        // Handle event
        useCaseMediator.dispatch(new YourCommand(event.data()));
        ack.acknowledge();
    }
}
```

**Key Features:**
- ✅ Individual class per topic (Open/Closed Principle)
- ✅ Module-prefixed names: `UserUserCreatedListener`, `NotificationUserCreatedListener`
- ✅ Explicit bean names to avoid conflicts: `@Component("userUserCreatedListener")`
- ✅ Manual acknowledgment control
- ✅ UseCaseMediator integration

**Example:**
```bash
eva g kafka-listener notification
# Select: user-created, order-placed
# Generates: NotificationUserCreatedListener.java, NotificationOrderPlacedListener.java
```

---

### 9. `detach` - Extract Module to Microservice

Extract a module from the monolith into an independent microservice.

```bash
eva detach [module-name]
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
7. Copies parameters folder (kafka.yaml, urls.yaml)
8. Updates Kafka configuration references
9. Removes Spring Modulith dependencies
10. Increments server port (+1)
11. Uses parent's database configuration

**Example:**
```bash
# In monolith project
eva detach user

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
        ├── application.yaml         # Updated port
        ├── application-develop.yaml # Copied from parent
        └── parameters/             # Copied and updated
            └── */kafka.yaml         # Package refs updated
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
eva info
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
eva create e-commerce
cd e-commerce

# 2. Add modules
eva add module user
eva add module product
eva add module order

# 3. Generate resources
eva g resource user
eva g resource product
eva g resource order

# 4. Add event-driven communication
eva add kafka-client
eva g kafka-event order order-placed
eva g kafka-listener notification

# 5. Add external service clients
eva g http-exchange order payment-service

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
eva detach user       # Port 8041
eva detach product    # Port 8042  
eva detach order      # Port 8043

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
├── docker-compose.yaml              # Local database
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
    │       ├── application.yaml                # Main config (port 8040)
    │       ├── application-local.yaml          # Local profile
    │       ├── application-develop.yaml        # Development profile
    │       ├── application-test.yaml           # Test profile
    │       ├── application-production.yaml     # Production profile
    │       └── parameters/
    │           ├── local/
    │           │   ├── kafka.yaml              # Kafka config (localhost)
    │           │   └── urls.yaml               # Service URLs (localhost)
    │           ├── develop/
    │           │   ├── kafka.yaml
    │           │   └── urls.yaml
    │           ├── test/
    │           │   ├── kafka.yaml
    │           │   └── urls.yaml
    │           └── production/
    │               ├── kafka.yaml
    │               └── urls.yaml
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
| **local** | `local` | Developer machine | `application-local.yaml` |
| **develop** | `develop` | Development server | `application-develop.yaml` |
| **test** | `test` | QA/Staging | `application-test.yaml` |
| **production** | `production` | Production | `application-production.yaml` |

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
│   ├── kafka.yaml     # bootstrap-servers: localhost:9092
│   └── urls.yaml      # product-service: http://localhost:8041
├── develop/
│   ├── kafka.yaml     # bootstrap-servers: dev-kafka.company.com:9092
│   └── urls.yaml      # product-service: https://dev-product.company.com
└── production/
    ├── kafka.yaml     # bootstrap-servers: prod-kafka.company.com:9092
    └── urls.yaml      # product-service: https://product.company.com
```

---

## 📋 Centralized Logging (AOP)

eva4j generates a **cross-cutting logging system** based on Spring AOP. Instead of scattering log statements across your codebase, you annotate methods with the desired logging behavior. All logging logic lives in a single aspect (`HandlerLogs`), keeping your business code clean.

### Generated Artifacts

```
shared/
├── domain/annotations/
│   ├── LogBefore.java      # Log before method execution
│   ├── LogAfter.java       # Log after successful execution (includes return value)
│   ├── LogExceptions.java  # Log on exception (includes error message)
│   ├── LogTimer.java       # Measure execution time
│   ├── Loggable.java       # Unified annotation (combines all of the above)
│   └── LogLevel.java       # Enum: TRACE, DEBUG, INFO, WARN
└── infrastructure/configurations/loggerConfig/
    └── HandlerLogs.java    # Single aspect that handles all log annotations
```

### Individual Annotations

#### `@LogBefore` — Log method entry

```java
@LogBefore
public User createUser(String username, String email) {
    return new User(username, email);
}
```
```
INFO  ▶ Entering createUser with args: [username=john, email=john@mail.com]
```

#### `@LogAfter` — Log successful completion with return value

```java
@LogAfter
public Order findOrder(String orderId) {
    return orderRepository.findById(orderId).orElseThrow();
}
```
```
INFO  ◀ Completed findOrder with args: [orderId=ORD-123] | return: Order{id=ORD-123, status=CONFIRMED}
```

#### `@LogExceptions` — Log failures with exception details

```java
@LogExceptions
public void processPayment(String orderId, BigDecimal amount) {
    // throws InsufficientFundsException
}
```
```
WARN  ✖ Method processPayment failed with args: [orderId=ORD-123, amount=500.00] | exception: InsufficientFundsException | message: Balance insuficiente para procesar el pago
```

#### `@LogTimer` — Measure execution time

```java
@LogTimer
public List<Product> searchProducts(String query) {
    return productRepository.fullTextSearch(query);
}
```
```
INFO  ⏱ Method searchProducts executed in 342 ms
```

### Protecting Sensitive Data with `excludeArgs`

All annotations (except `@LogTimer`) support `excludeArgs` to mask sensitive parameters. **By default all arguments are shown** — you only specify which ones to hide:

```java
@LogBefore(excludeArgs = {"password", "token"})
public void register(String username, String password, String token) {
    // ...
}
```
```
INFO  ▶ Entering register with args: [username=john, password=[PROTECTED], token=[PROTECTED]]
```

### Configurable Log Level

All annotations default to `INFO` (except `@LogExceptions` which defaults to `WARN`). Override with the `level` attribute:

```java
@LogBefore(level = LogLevel.DEBUG)
public void syncInventory(String warehouseId) {
    // frequent operation you don't want at INFO in production
}
```
```
DEBUG ▶ Entering syncInventory with args: [warehouseId=WH-001]
```

### `@Loggable` — Unified Annotation

When you need multiple logging behaviors on a single method, use `@Loggable` instead of stacking individual annotations:

```java
@Loggable(timer = true, excludeArgs = {"creditCard"})
public PaymentResult checkout(String orderId, String creditCard) {
    return new PaymentResult("PAY-789", "APPROVED");
}
```

**Successful execution:**
```
INFO  ▶ Entering checkout with args: [orderId=ORD-123, creditCard=[PROTECTED]]
INFO  ◀ Completed checkout with args: [orderId=ORD-123, creditCard=[PROTECTED]] | return: PaymentResult{id=PAY-789, status=APPROVED}
INFO  ⏱ Method checkout executed in 1205 ms
```

**On failure:**
```
INFO  ▶ Entering checkout with args: [orderId=ORD-123, creditCard=[PROTECTED]]
WARN  ✖ Method checkout failed with args: [orderId=ORD-123, creditCard=[PROTECTED]] | exception: PaymentDeclinedException | message: Card declined by issuer
```

`@Loggable` attributes and their defaults:

| Attribute | Default | Description |
|-----------|---------|-------------|
| `before` | `true` | Log method entry |
| `after` | `true` | Log successful return |
| `exceptions` | `true` | Log on exception |
| `timer` | `false` | Measure execution time |
| `level` | `INFO` | Log level for before/after/timer |
| `excludeArgs` | `{}` | Parameter names to mask as `[PROTECTED]` |

**Silent mode — only log failures and duration:**

```java
@Loggable(before = false, after = false, exceptions = true, timer = true)
public void importBulkData(List<String> records) {
    // silent batch process: only logs on failure or to measure duration
}
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
