# Command `add module`

## 📋 Description

Adds a new domain module to the existing project with complete hexagonal architecture (domain, application, infrastructure).

## 🎯 Purpose

Create independent and self-contained modules that encapsulate a specific business capability, facilitating modular development and future extraction to microservices.

## 📝 Syntax

```bash
eva4j add module <module-name>
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `module-name` | No* | Module name (kebab-case or camelCase). If omitted, will be prompted interactively |

*If omitted, the command will prompt for the name interactively.

## 🔧 Interactive Options

If module name is not provided:

```
? Enter module name (lowercase, kebab-case allowed): customer
```

**Accepted formats:**
- `customer` ✅
- `user-profile` ✅
- `orderItem` ✅ (will convert to `order-item`)
- `Customer` ❌ (uppercase not allowed)

## 📦 Generated Structure

```
src/main/java/com/example/myproject/
└── <module-name>/
    ├── application/
    │   ├── commands/       # Commands and CommandHandlers (CQRS Write)
    │   ├── queries/        # Queries and QueryHandlers (CQRS Read)
    │   └── mappers/        # Mappers between layers
    ├── domain/
    │   ├── models/         # Entities, ValueObjects, Enums
    │   ├── repositories/   # Repository interfaces (ports)
    │   └── events/         # Domain events
    └── infrastructure/
        ├── database/
        │   ├── entities/   # JPA entities
        │   ├── repositories/ # JPA implementations
        │   └── mappers/    # Domain ↔ JPA mappers
        └── rest/
            └── controllers/ # REST Controllers
```

## 💡 Examples

### Example 1: Customer module

```bash
eva4j add module customer
```

**Result:**
```
✅ Module 'customer' created successfully!

📁 Structure created:
   ├── domain/models/
   ├── domain/repositories/
   ├── domain/events/
   ├── application/commands/
   ├── application/queries/
   ├── application/mappers/
   ├── infrastructure/database/entities/
   ├── infrastructure/database/repositories/
   └── infrastructure/rest/controllers/
```

### Example 2: Module with compound name

```bash
eva4j add module order-item
```

**Generates:**
- Package: `com.example.myproject.orderitem`
- Directory: `order-item/`
- Classes with prefix: `OrderItem`

### Example 3: Without parameters (interactive)

```bash
eva4j add module
```

**Interaction:**
```
? Enter module name (lowercase, kebab-case allowed): product
✅ Module 'product' created successfully!
```

## ✨ Generated Module Features

### 1. Complete Hexagonal Architecture
Each module follows the ports and adapters pattern:
- **Domain** - Pure business logic (no external dependencies)
- **Application** - Use cases (CQRS: Commands and Queries)
- **Infrastructure** - Adapters (REST, JPA, Kafka, etc.)

### 2. CQRS Ready
- `commands/` and `queries/` folders ready
- Clear separation between writes and reads
- Pre-organized handlers

### 3. Validated Boundaries
- Spring Modulith validates the module has no forbidden dependencies
- Each module can become an independent microservice

### 4. Automatic Configuration
- `settings.gradle` update if needed
- Package scanning configured
- JPA entity scan includes the new module

## 🔄 Integration with Other Commands

After creating a module, you'll typically run:

### Option 1: Generate entities from YAML
```bash
# Create domain.yaml with your domain model
eva4j g entities <aggregate-name>
```

### Option 2: Generate use cases manually
```bash
eva4j g usecase CreateCustomer --type command
eva4j g usecase GetCustomer --type query
```

### Option 3: Generate complete REST resources
```bash
eva4j g resource Customer
```

## 🎯 Common Use Cases

### E-commerce
```bash
eva4j add module product
eva4j add module order
eva4j add module customer
eva4j add module inventory
eva4j add module payment
```

### Management System
```bash
eva4j add module user
eva4j add module document
eva4j add module workflow
eva4j add module notification
```

### Fintech
```bash
eva4j add module account
eva4j add module transaction
eva4j add module card
eva4j add module loan
```

## 🚀 Next Steps

1. **Define domain model:**
   - Create YAML file with entities, value objects, and relationships
   
2. **Generate entities:**
   ```bash
   eva4j g entities <aggregate-name>
   ```

3. **Implement business logic:**
   - Edit generated entities
   - Add business methods
   - Implement validations

4. **Generate use cases:**
   ```bash
   eva4j g usecase CreateCustomer --type command
   eva4j g usecase ListCustomers --type query
   ```

5. **Expose REST API:**
   ```bash
   eva4j g resource Customer
   ```

## ⚠️ Prerequisites

- Be in a project directory created with `eva4j create`
- Have write permissions in the directory

## 🔍 Validations

The command validates:
- ✅ You're in a valid eva4j project (checks `build.gradle`)
- ✅ Module does not exist previously
- ✅ Module name is valid (lowercase, kebab-case)
- ✅ Can determine the project's base package

## 📚 See Also

- [generate-entities](./GENERATE_ENTITIES.md) - Generate entities from YAML
- [generate-usecase](./GENERATE_USECASE.md) - Create use cases
- [generate-resource](./GENERATE_RESOURCE.md) - Generate REST controllers
- [detach](./DETACH.md) - Extract module to microservice

## 🐛 Troubleshooting

**Error: "Not in a Spring Boot project directory"**
- Solution: Run the command inside a project created with `eva4j create`

**Error: "Module already exists"**
- Solution: The module was already created. Use another name or delete the existing one

**Error: "Invalid module name"**
- Solution: Use only lowercase letters and hyphens (kebab-case)
  - ✅ `customer`, `order-item`
  - ❌ `Customer`, `order_item`, `123module`
