# Command `generate entities` (alias: `g entities`)

## 📋 Description

Generates complete domain model from a YAML definition file, including entities, value objects, enums, JPA mappings, repositories, and CRUD operations with CQRS pattern.

## 🎯 Purpose

Automate the creation of domain models with full hexagonal architecture implementation, eliminating repetitive coding and ensuring consistency across all layers (domain, application, infrastructure).

## 📝 Syntax

```bash
eva4j generate entities <aggregate-name>
eva4j g entities <aggregate-name>        # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `aggregate-name` | Yes | Name of the aggregate (must match YAML file name) |

## 📄 YAML File Structure

The command expects a YAML file at `examples/<aggregate-name>.yaml` with the following structure:

```yaml
module: <module-name>      # Target module for generation

aggregates:
  - name: <AggregateName>
    tableName: <table_name>
    auditable: true|false
    
    entities:
      - name: <EntityName>
        isRoot: true|false
        tableName: <table_name>
        fields:
          - name: <fieldName>
            type: <JavaType|ValueObject|Enum>
            validations:
              - <@Annotation>
        relationships:
          - type: OneToMany|ManyToOne|OneToOne|ManyToMany
            target: <TargetEntity>
            mappedBy: <fieldName>       # For inverse side
            cascade: ALL|PERSIST|MERGE
            fetch: LAZY|EAGER
    
    valueObjects:
      - name: <ValueObjectName>
        fields:
          - name: <fieldName>
            type: <JavaType>
    
    enums:
      - name: <EnumName>
        values:
          - VALUE1
          - VALUE2
```

## 💡 Examples

### Example 1: Simple Customer Aggregate

**File:** `examples/customer.yaml`

```yaml
module: customer

aggregates:
  - name: Customer
    tableName: customers
    auditable: true
    
    entities:
      - name: customer
        isRoot: true
        fields:
          - name: id
            type: Long
          - name: firstName
            type: String
            validations:
              - "@NotBlank"
              - "@Size(max = 100)"
          - name: email
            type: String
            validations:
              - "@Email"
          - name: status
            type: CustomerStatus
```

**Generate:**
```bash
eva4j g entities customer
```

### Example 2: Complex Order with Relations

**File:** `examples/order.yaml`

```yaml
module: order

aggregates:
  - name: Order
    tableName: orders
    auditable: true
    
    entities:
      - name: order
        isRoot: true
        fields:
          - name: id
            type: Long
          - name: orderNumber
            type: String
          - name: totalAmount
            type: BigDecimal
          - name: status
            type: OrderStatus
        relationships:
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: ALL
            fetch: LAZY
      
      - name: orderItem
        isRoot: false
        tableName: order_items
        fields:
          - name: id
            type: Long
          - name: quantity
            type: Integer
          - name: unitPrice
            type: BigDecimal
        relationships:
          - type: ManyToOne
            target: Order
            fetch: LAZY
    
    enums:
      - name: OrderStatus
        values:
          - PENDING
          - CONFIRMED
          - SHIPPED
          - DELIVERED
          - CANCELLED
```

**Generate:**
```bash
eva4j g entities order
```

### Example 3: With Value Objects

**File:** `examples/evaluation.yaml`

```yaml
module: evaluation

aggregates:
  - name: Evaluation
    tableName: evaluations
    
    entities:
      - name: evaluation
        isRoot: true
        fields:
          - name: id
            type: String
          - name: score
            type: Integer
        relationships:
          - type: OneToMany
            target: EvaluationDoctor
            cascade: ALL
      
      - name: evaluationDoctor
        isRoot: false
        fields:
          - name: id
            type: Long
          - name: degrees
            type: List<Degrees>
    
    valueObjects:
      - name: Degrees
        fields:
          - name: title
            type: String
          - name: institution
            type: String
          - name: year
            type: Integer
          - name: typeDegrees
            type: TypeDegrees
    
    enums:
      - name: TypeDegrees
        values:
          - BACHELOR
          - MASTER
          - PHD
```

**Generate:**
```bash
eva4j g entities evaluation
```

## 📦 Generated Code Structure

```
src/main/java/com/example/project/<module>/
├── domain/
│   ├── models/
│   │   ├── Customer.java                    # Domain entity (root)
│   │   ├── OrderItem.java                   # Domain entity (secondary)
│   │   ├── valueobjects/
│   │   │   └── Degrees.java                 # Value object
│   │   └── enums/
│   │       └── OrderStatus.java             # Enum
│   └── repositories/
│       └── CustomerRepository.java          # Repository port (interface)
│
├── application/
│   ├── commands/
│   │   ├── CreateCustomerCommand.java       # Create command
│   │   └── CreateCustomerCommandHandler.java # Command handler
│   ├── queries/
│   │   ├── GetCustomerQuery.java            # Get query
│   │   ├── GetCustomerQueryHandler.java     # Get handler
│   │   ├── ListCustomersQuery.java          # List query
│   │   └── ListCustomersQueryHandler.java   # List handler
│   ├── dtos/
│   │   ├── CreateCustomerDto.java           # Create DTO
│   │   ├── CreateOrderItemDto.java          # Nested entity DTO
│   │   └── CustomerResponseDto.java         # Response DTO
│   └── mappers/
│       └── CustomerApplicationMapper.java   # Application mapper (Command/DTO → Domain)
│
└── infrastructure/
    ├── database/
    │   ├── entities/
    │   │   ├── CustomerJpa.java             # JPA entity (root)
    │   │   ├── OrderItemJpa.java            # JPA entity (secondary)
    │   │   └── valueobjects/
    │   │       └── DegreesJpa.java          # JPA value object
    │   ├── repositories/
    │   │   ├── CustomerJpaRepository.java   # Spring Data repository
    │   │   └── CustomerRepositoryImpl.java  # Repository implementation
    │   └── mappers/
    │       └── CustomerMapper.java          # Infrastructure mapper (Domain ↔ JPA)
    └── rest/
        └── controllers/
            └── CustomerController.java      # REST controller with CRUD endpoints
```

## ✨ Features

### 1. Domain Layer (Pure Business Logic)
- ✅ **Entities** - Aggregate root and secondary entities
- ✅ **Value Objects** - Immutable value types with `@Embedded` support
- ✅ **Enums** - Type-safe enumerations
- ✅ **Repository Interfaces** - Ports for persistence

### 2. Application Layer (Use Cases - CQRS)
- ✅ **Commands** - `CreateCustomerCommand` with validation
- ✅ **CommandHandlers** - Business logic orchestration
- ✅ **Queries** - `GetCustomerQuery`, `ListCustomersQuery`
- ✅ **QueryHandlers** - Read operations with pagination
- ✅ **DTOs** - Request/Response data transfer objects
- ✅ **Application Mappers** - Command/DTO → Domain transformations

### 3. Infrastructure Layer (Technical Details)
- ✅ **JPA Entities** - Persistence annotations (`@Entity`, `@Table`)
- ✅ **JPA Repositories** - Spring Data JPA implementation
- ✅ **Infrastructure Mappers** - Domain ↔ JPA bidirectional mapping
- ✅ **REST Controllers** - CRUD endpoints (`POST`, `GET`, `GET list`)

### 4. Advanced Capabilities
- ✅ **Relationships** - OneToMany, ManyToOne, OneToOne, ManyToMany
- ✅ **Nested Entities** - Secondary entities with their own relationships
- ✅ **Value Object Collections** - `List<ValueObject>` with `@ElementCollection`
- ✅ **Auditing** - `@CreatedDate`, `@LastModifiedDate` when `auditable: true`
- ✅ **Cascade Operations** - Configurable cascade types
- ✅ **Fetch Strategies** - LAZY/EAGER configuration
- ✅ **Validations** - Bean Validation annotations
- ✅ **Pagination** - Built-in pagination support for list queries

## 🔄 Supported Relationships

### OneToMany / ManyToOne (Bidirectional)

```yaml
# Parent entity
entities:
  - name: order
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order      # Field in OrderItem that owns the relationship
        cascade: ALL
        fetch: LAZY

# Child entity
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Order
        fetch: LAZY
```

### OneToOne

```yaml
entities:
  - name: user
    relationships:
      - type: OneToOne
        target: UserProfile
        cascade: ALL

  - name: userProfile
    relationships:
      - type: OneToOne
        target: User
```

### ManyToMany

```yaml
entities:
  - name: student
    relationships:
      - type: ManyToMany
        target: Course
        cascade: PERSIST

  - name: course
    relationships:
      - type: ManyToMany
        target: Student
        mappedBy: courses
```

### Relations Between Secondary Entities

```yaml
entities:
  - name: evaluationDoctor
    relationships:
      - type: OneToMany
        target: EvaluationBranch      # Another secondary entity
        cascade: ALL

  - name: evaluationBranch
    relationships:
      - type: ManyToOne
        target: EvaluationDoctor
```

## 🎯 Supported Data Types

### Primitive Types
- `String`, `Integer`, `Long`, `Double`, `Float`, `Boolean`
- `BigDecimal`, `BigInteger`
- `LocalDate`, `LocalDateTime`, `LocalTime`
- `ZonedDateTime`, `Instant`

### Collections
- `List<ValueObject>` - Generates `@ElementCollection`
- `List<Entity>` - Generates `@OneToMany`

### Custom Types
- Value Objects (defined in `valueObjects` section)
- Enums (defined in `enums` section)

## 🚀 Next Steps

After generating entities:

1. **Review generated code:**
   ```bash
   # Check domain models
   cat src/main/java/com/example/project/<module>/domain/models/*.java
   ```

2. **Add business logic:**
   - Edit domain entities to add business methods
   - Implement domain validations
   - Add domain events if needed

3. **Test the API:**
   ```bash
   ./gradlew bootRun
   # POST http://localhost:8080/api/<module>/<entity>
   # GET  http://localhost:8080/api/<module>/<entity>/{id}
   # GET  http://localhost:8080/api/<module>/<entity>
   ```

4. **Extend functionality:**
   ```bash
   eva4j g usecase UpdateCustomer --type command
   eva4j g usecase DeleteCustomer --type command
   ```

## ⚠️ Prerequisites

- Be in a project created with `eva4j create`
- Module must exist (created with `eva4j add module`)
- YAML file must exist at `examples/<aggregate-name>.yaml`

## 🔍 Validations

The command validates:
- ✅ Valid eva4j project
- ✅ Target module exists
- ✅ YAML file exists and is valid
- ✅ No syntax errors in YAML
- ✅ Entity names are unique
- ✅ Relationship targets exist
- ✅ Field types are valid

## 📚 See Also

- [DOMAIN_YAML_GUIDE.md](../../DOMAIN_YAML_GUIDE.md) - Complete YAML syntax reference
- [add-module](./ADD_MODULE.md) - Create modules
- [generate-usecase](./GENERATE_USECASE.md) - Add more use cases

## 🐛 Troubleshooting

**Error: "YAML file not found"**
- Solution: Create `examples/<aggregate-name>.yaml` file first

**Error: "Module does not exist"**
- Solution: Run `eva4j add module <module-name>` first

**Error: "Invalid relationship target"**
- Solution: Ensure the target entity is defined in the same aggregate

**Import errors after generation**
- Solution: This has been fixed in recent versions. Make sure you're using eva4j 1.0.3+
- If still happening, check that field types match defined ValueObjects/Enums

**Compilation errors with List<ValueObject>**
- Solution: Updated in latest version to use `List<ValueObjectJpa>` in JPA entities
  - Mapper name: `OrderMapper.java`
  - File organization
  - Generated code references

---

## Entities

### Root Entity (Aggregate Root)

The root entity is the entry point to the aggregate. All operations must go through it.

**⚠️ Important**: The root entity is defined within the `entities` array with `isRoot: true`.

```yaml
aggregates:
  - name: Order
    entities:
      - name: order              # Entity name (camelCase or snake_case)
        isRoot: true             # ← REQUIRED to mark the root
        tableName: orders        # Table name in DB (optional)
        
        fields:
          - name: id
            type: String         # String generates UUID, Long generates IDENTITY
            
          - name: orderNumber
            type: String
            
          - name: status
            type: OrderStatus    # Reference to an enum
            
          - name: totalAmount
            type: Money          # Reference to a value object
            
          - name: createdAt
            type: LocalDateTime
        
        relationships:
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY
```

### Secondary Entities

Entities that belong to the aggregate but are not the root. They are defined in the same `entities` array **without** `isRoot` (or with `isRoot: false`).

```yaml
aggregates:
  - name: Order
    entities:
      # ... root entity order with isRoot: true ...
      
      - name: orderItem          # ← Secondary entity
        tableName: order_items
        # Without isRoot or isRoot: false = secondary
        
        fields:
          - name: id
            type: Long
            
          - name: productId
            type: String
            
          - name: quantity
            type: Integer
            
          - name: unitPrice
            type: Money
        
        relationships:
          - type: ManyToOne
            target: Order
            joinColumn: order_id
            fetch: LAZY
```

### Fields

#### Syntax

```yaml
fields:
  - name: fieldName          # Field name (camelCase) - REQUIRED
    type: String             # Java data type - REQUIRED
```

**Supported properties:**
- `name`: Field name (required)
- `type`: Java data type (required)

#### Automatic Type Detection

eva4j automatically detects field types based **only** on `type`:

**✅ Value Objects** - Automatically detected
```yaml
fields:
  - name: totalAmount
    type: Money        # If Money is in valueObjects → automatic @Embedded
```

**✅ Enums** - Automatically detected
```yaml
fields:
  - name: status
    type: OrderStatus  # If OrderStatus is in enums → @Enumerated(STRING)
```

**✅ Primitive types**
```yaml
fields:
  - name: name
    type: String       # → VARCHAR
  - name: age
    type: Integer      # → INTEGER
  - name: price
    type: BigDecimal   # → DECIMAL
```

**✅ Date types** - Automatically imported
```yaml
fields:
  - name: createdAt
    type: LocalDateTime  # → timestamp + import java.time.LocalDateTime
```

**✅ Collections** - Automatic @ElementCollection
```yaml
fields:
  - name: tags
    type: List<String>   # → @ElementCollection with secondary table
```

#### ❌ NO need to specify

eva4j automatically generates the correct JPA annotations:
- `@Embedded` for Value Objects
- `@Enumerated(EnumType.STRING)` for Enums
- `@ElementCollection` for lists
- Required imports

#### ⚠️ MANDATORY RULE: `id` Field

**All entities MUST have a field named exactly `id`.**

```yaml
# ✅ CORRECT - All entities have 'id'
entities:
  - name: order
    isRoot: true
    fields:
      - name: id          # ← REQUIRED
        type: String      # String = UUID, Long = IDENTITY
      - name: orderNumber
        type: String
  
  - name: orderItem
    fields:
      - name: id          # ← REQUIRED also in secondary entities
        type: Long
      - name: productId
        type: String
```

**Reasons:**
- ✅ JPA requires `@Id` in all entities
- ✅ Eva4j automatically generates `@Id` and `@GeneratedValue` for the `id` field
- ✅ Clear and consistent convention across the domain

**Supported types for `id`:**
- `String` → Generates `@GeneratedValue(strategy = GenerationType.UUID)`
- `Long` → Generates `@GeneratedValue(strategy = GenerationType.IDENTITY)`

**❌ INCORRECT:**
```yaml
# ❌ Without 'id' field - Application will fail
fields:
  - name: orderNumber
    type: String
  # ← Missing 'id' field

# ❌ Different name - Won't work
fields:
  - name: orderId     # ← Must be named exactly 'id'
    type: String
```

**💡 Business Identifiers:**

If you need a business identifier in addition to the technical ID:

```yaml
fields:
  - name: id              # ← Technical ID (required)
    type: String
  - name: orderNumber     # ← Business ID (optional)
    type: String
  - name: invoiceNumber   # ← Another business identifier
    type: String
```

---

#### Correct Examples

```yaml
# Value Object
fields:
  - name: totalAmount
    type: Money              # ✅ Sufficient - eva4j automatically detects

# Enum
fields:
  - name: status
    type: OrderStatus        # ✅ Sufficient - eva4j automatically detects

# Primitive type
fields:
  - name: description
    type: String             # ✅ Basic type

# Collection
fields:
  - name: tags
    type: List<String>       # ✅ Automatic @ElementCollection
```

---

### Automatic Auditing

eva4j supports automatic entity auditing using the `auditable` property. When set to `true`, the entity will automatically include creation and modification date fields.

#### Syntax

```yaml
entities:
  - name: order
    isRoot: true
    auditable: true  # ← Activates automatic auditing
    fields:
      - name: orderNumber
        type: String
```

#### What `auditable: true` Generates

**In the domain entity (`Order.java`):**
```java
public class Order {
    private String orderNumber;
    private LocalDateTime createdAt;   // ← Automatically added
    private LocalDateTime updatedAt;   // ← Automatically added
    
    // getters/setters automatically generated
}
```

**In the JPA entity (`OrderJpa.java`):**
```java
@Entity
@Table(name = "orders")
public class OrderJpa extends AuditableEntity {  // ← Extends base class
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String orderNumber;
    
    // createdAt/updatedAt fields inherited from AuditableEntity
}
```

**Generated base class (`AuditableEntity.java`):**
```java
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class AuditableEntity {
    
    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
    
    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
    
    // getters/setters
}
```

#### Features

✅ **Fully automatic**: Timestamps update without additional code  
✅ **Entity level**: Can be enabled for specific entities  
✅ **Spring Data JPA**: Uses `@CreatedDate` and `@LastModifiedDate`  
✅ **Mapper included**: Audit fields are automatically mapped between domain and JPA  

#### Required Configuration

The Spring Boot application already has JPA auditing enabled in the main class:

```java
@SpringBootApplication
@EnableJpaAuditing  // ← Already configured by eva4j
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

#### Complete Example

```yaml
aggregates:
  - name: Product
    entities:
      - name: product
        isRoot: true
        auditable: true  # ← Enables auditing
        fields:
          - name: productId
            type: String
          - name: name
            type: String
          - name: price
            type: BigDecimal
          # createdAt and updatedAt are automatically added
      
      - name: review
        auditable: true  # ← Secondary entities can also have auditing
        fields:
          - name: reviewId
            type: Long
          - name: comment
            type: String
        relationships:
          - type: ManyToOne
            target: product
            fetch: LAZY
            joinColumn: product_id
```

**Resultado en la tabla:**
```sql
CREATE TABLE products (
    product_id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255),
    price DECIMAL(19,2),
    created_at TIMESTAMP NOT NULL,  -- ← Automático
    updated_at TIMESTAMP NOT NULL   -- ← Automático
);

CREATE TABLE reviews (
    review_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    comment TEXT,
    product_id VARCHAR(36),
    created_at TIMESTAMP NOT NULL,  -- ← Automático
    updated_at TIMESTAMP NOT NULL,  -- ← Automático
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);
```

#### Notas importantes

- ✅ `auditable` es **opcional** - por defecto es `false`
- ✅ Puede usarse en **entidad raíz** o **entidades secundarias**
- ✅ Los campos `createdAt` y `updatedAt` **no deben** definirse manualmente en `fields`
- ✅ El tipo es siempre `LocalDateTime`
- ❌ **No incluye** auditoría de usuario (createdBy/updatedBy) - ver [FUTURE_FEATURES.md](FUTURE_FEATURES.md) para esa funcionalidad

---

## Value Objects

Los Value Objects son objetos inmutables que representan conceptos del dominio sin identidad propia.

### Definición básica

```yaml
valueObjects:
  - name: Money
    fields:
      - name: amount
        type: BigDecimal
      
      - name: currency
        type: String
```

### Generated Value Object (Domain)

```java
public class Money {
    private final BigDecimal amount;
    private final String currency;
    
    public Money(BigDecimal amount, String currency) {
        this.amount = amount;
        this.currency = currency;
    }
    
    // Getters
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    
    // equals() and hashCode() based on all fields
}
```

### Value Object JPA (@Embeddable)

```java
@Embeddable
public class MoneyJpa {
    private BigDecimal amount;
    private String currency;
    
    // Constructor, getters, setters (Lombok)
}
```

### Usage in Entities

```yaml
fields:
  - name: totalAmount
    type: Money        # Automatically detected as VO
```

Generates in JPA:
```java
@Embedded
private MoneyJpa totalAmount;
```

### Example: Complex Value Object

```yaml
valueObjects:
  - name: Address
    fields:
      - name: street
        type: String
      
      - name: city
        type: String
      
      - name: state
        type: String
      
      - name: zipCode
        type: String
      
      - name: country
        type: String
```

---

## Enums

### Definition

```yaml
enums:
  - name: OrderStatus
    values:
      - PENDING
      - CONFIRMED
      - SHIPPED
      - DELIVERED
      - CANCELLED
```

### Generated Enum

```java
package com.example.myapp.order.domain.models.enums;

public enum OrderStatus {
    PENDING,
    CONFIRMED,
    SHIPPED,
    DELIVERED,
    CANCELLED
}
```

### Uso en entidades

```yaml
fields:
  - name: status
    type: OrderStatus  # Se detecta y se importa automáticamente
```

Genera en JPA:
```java
@Enumerated(EnumType.STRING)
private OrderStatus status;
```

### Múltiples enums

```yaml
enums:
  - name: OrderStatus
    values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]
  
  - name: PaymentMethod
    values: [CREDIT_CARD, DEBIT_CARD, CASH, BANK_TRANSFER]
  
  - name: ShippingMethod
    values: [STANDARD, EXPRESS, OVERNIGHT]
```

---

## Relaciones

eva4j soporta relaciones JPA bidireccionales completas con generación automática del lado inverso.

### 🎯 Relaciones Bidireccionales Automáticas

**Característica clave**: Cuando defines una relación OneToMany con `mappedBy`, eva4j genera AUTOMÁTICAMENTE la relación inversa ManyToOne en la entidad target.

**Solo necesitas definir UN lado:**

```yaml
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order          # ← eva4j crea automáticamente ManyToOne en OrderItem
        cascade: [PERSIST, MERGE]
        fetch: LAZY
```

**eva4j genera automáticamente en OrderItem:**

```java
// OrderItemJpa.java (automatically generated)
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "order_id")
private OrderJpa order;
```

**Ventajas:**
- ✅ No necesitas definir ambos lados manualmente
- ✅ Evita inconsistencias entre relaciones
- ✅ JPA persiste correctamente la relación bidireccional
- ✅ Menos código YAML, misma funcionalidad

**Nota**: Si defines manualmente ambos lados en el YAML, la definición manual tiene prioridad sobre la autogeneración.

---

### OneToMany (Uno a Muchos)

**Definición en la entidad que tiene la colección:**

```yaml
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem        # Entidad relacionada
        mappedBy: order          # Campo en OrderItem que apunta a Order
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY
```

**Genera en dominio:**
```java
private List<OrderItem> orderItems = new ArrayList<>();

public void addOrderItem(OrderItem orderItem) {
    this.orderItems.add(orderItem);
}

public void removeOrderItem(OrderItem orderItem) {
    this.orderItems.remove(orderItem);
}
```

**Genera en JPA:**
```java
@OneToMany(mappedBy = "order", cascade = {CascadeType.PERSIST, CascadeType.MERGE, CascadeType.REMOVE}, fetch = FetchType.LAZY)
@Builder.Default
private List<OrderItemJpa> orderItems = new ArrayList<>();
```

**Genera automáticamente en OrderItem (lado inverso):**
```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "order_id")  // Inferido desde mappedBy
private OrderJpa order;
```

### ManyToOne (Muchos a Uno)

**Definición manual (opcional si ya usaste mappedBy en OneToMany):**

```yaml
entities:
  - name: orderItem
    # Sin isRoot = entidad secundaria
    relationships:
      - type: ManyToOne
        target: Order
        joinColumn: order_id   # Columna FK en la tabla
        fetch: LAZY
```

**Genera en JPA:**
```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "order_id")
private OrderJpa order;
```

**💡 Tip**: Si ya definiste `OneToMany` con `mappedBy` en Order, NO necesitas definir manualmente el `ManyToOne` en OrderItem. eva4j lo genera automáticamente.

---

### ⚠️ REGLA CRÍTICA: Relaciones Bidireccionales

**Para relaciones bidireccionales OneToMany/ManyToOne:**

#### ✅ CORRECTO - Solo definir en la entidad raíz

```yaml
entities:
  - name: invoice
    isRoot: true
    relationships:
      - type: OneToMany
        target: InvoiceItem
        mappedBy: invoice      # ← Solo esta definición
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY
  
  - name: invoiceItem
    fields:
      - name: id
        type: Long
    # ← SIN relationships definidas
    # Eva4j genera automáticamente el ManyToOne en InvoiceItemJpa
```

**Resultado generado:**
```java
// InvoiceJpa.java
@OneToMany(mappedBy = "invoice", cascade = {...})
private List<InvoiceItemJpa> invoiceItems;

// InvoiceItemJpa.java (automatically generated)
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "invoice_id")
private InvoiceJpa invoice;
```

#### ❌ INCORRECTO - Definir en ambos lados

```yaml
entities:
  - name: invoice
    isRoot: true
    relationships:
      - type: OneToMany
        target: InvoiceItem
        mappedBy: invoice      # ← Primera definición
  
  - name: invoiceItem
    relationships:
      - type: ManyToOne        # ← ❌ DUPLICADO - Causará error
        target: Invoice
        joinColumn: invoice_id
```

**Problema:** Genera DOS relaciones `@ManyToOne` en `InvoiceItemJpa`, ambas mapeando a `invoice_id`:

```java
// InvoiceItemJpa.java (INCORRECTO - Duplicado)
@ManyToOne
@JoinColumn(name = "invoice_id")
private InvoiceJpa invoice;   // ← Del mappedBy

@ManyToOne
@JoinColumn(name = "invoice_id")
private InvoiceJpa invoices;  // ← Del ManyToOne explícito

// Error de Hibernate:
// "Column 'invoice_id' is duplicated in mapping"
```

#### 📋 Regla de Oro

| Escenario | Definir en Raíz | Definir en Secundaria | Eva4j Genera |
|-----------|-----------------|----------------------|-------------|
| **Bidireccional** | `OneToMany` con `mappedBy` | ❌ NADA | `@OneToMany` en raíz + `@ManyToOne` en JPA de secundaria |
| **Unidireccional** | Opcional | `ManyToOne` con `joinColumn` | Solo lo definido |

#### 💡 Separación Dominio/Persistencia

**Importante:** Eva4j sigue correctamente DDD:

- **Capa de Dominio:** Las entidades secundarias NO tienen referencia a la raíz
  ```java
  // InvoiceItem.java (dominio puro)
  public class InvoiceItem {
      private Long id;
      private String description;
      // ← SIN private Invoice invoice
  }
  ```

- **Capa de Persistencia (JPA):** Solo aquí existe la relación
  ```java
  // InvoiceItemJpa.java (persistencia)
  public class InvoiceItemJpa {
      private Long id;
      
      @ManyToOne
      @JoinColumn(name = "invoice_id")
      private InvoiceJpa invoice;  // ← Solo en capa JPA
  }
  ```

**Ventajas:**
- ✅ Sin dependencias circulares en dominio
- ✅ Modelo de dominio más simple
- ✅ Relación bidireccional solo donde se necesita (persistencia)
- ✅ Cumple principios de DDD y arquitectura hexagonal

---

### OneToOne (Uno a Uno)

**Bidireccional con mappedBy:**

```yaml
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToOne
        target: OrderSummary
        mappedBy: order
        cascade: [PERSIST, MERGE]
        fetch: LAZY
```

**Sin mappedBy (owner):**

```yaml
entities:
  - name: orderSummary
    relationships:
      - type: OneToOne
        target: Order
        joinColumn: order_id
        fetch: LAZY
```

### Relationship Options

| Option | Values | Description |
|--------|--------|-------------|
| `type` | OneToMany, ManyToOne, OneToOne, ManyToMany | Relationship type |
| `target` | EntityName | Related entity |
| `mappedBy` | fieldName | For the inverse side of the relationship |
| `joinColumn` | column_name | FK column name |
| `cascade` | [PERSIST, MERGE, REMOVE, REFRESH, DETACH, ALL] | Cascade operations |
| `fetch` | LAZY, EAGER | Loading strategy |

---

### 🔥 Cascade Options (Cascade Operations)

The `cascade` options determine which operations on the parent are automatically propagated to related entities.

#### **⚠️ IMPORTANT: Cascade and Persistence**

If you DON'T define `cascade`, related entities will **NOT be persisted automatically**. This is the most common error:

```yaml
# ❌ BAD - OrderItems will NOT be saved in DB
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: []        # ← Empty array = no cascade
    fetch: LAZY

# ✅ GOOD - OrderItems are saved automatically with Order
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE, REMOVE]  # ← Required to persist
    fetch: LAZY
```

#### **Cascade Options:**

| Option | Description | When to use? |
|--------|-------------|--------------|
| `PERSIST` | When saving the parent, saves new children | ✅ **Always in OneToMany** to create items |
| `MERGE` | When updating the parent, updates children | ✅ **Always in OneToMany** to edit items |
| `REMOVE` | When deleting the parent, deletes children | ✅ If children don't make sense without the parent |
| `REFRESH` | When refreshing the parent, refreshes children | ⚠️ Rarely needed |
| `DETACH` | When detaching the parent, detaches children | ⚠️ Rarely needed |
| `ALL` | All of the above operations | ⚠️ Only if you're sure |

#### **Recommended Configurations:**

```yaml
# 🎯 RECOMMENDED for OneToMany (Order → OrderItem)
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE, REMOVE]  # ← Creates, updates and deletes items
    fetch: LAZY

# 🎯 RECOMMENDED for entities with independent lifecycle
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]  # ← Without REMOVE, items persist
    fetch: LAZY

# ⚠️ CAREFUL with ALL - includes REMOVE
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [ALL]  # ← Deleting Order removes all OrderItems
    fetch: LAZY

# ❌ AVOID empty array if you want to persist children
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: []  # ← Requires manually saving OrderItem
    fetch: LAZY
```

#### **What happens without Cascade?**

```yaml
# Without cascade: [PERSIST]
cascade: []

# Behavior:
order.addOrderItem(item);
repository.save(order);  // ❌ Order is saved, OrderItem is NOT
```

```yaml
# With cascade: [PERSIST, MERGE]
cascade: [PERSIST, MERGE]

# Behavior:
order.addOrderItem(item);
repository.save(order);  // ✅ Order and OrderItem are saved automatically
```

---

### 🚀 Fetch Options (Loading Strategy)

The `fetch` options determine WHEN related entities are loaded from the database.

#### **Fetch Options:**

| Option | Description | Behavior | When to use? |
|--------|-------------|----------|--------------|
| `LAZY` | Load on demand (when accessed) | Only fetches parent initially | ✅ **Recommended by default** |
| `EAGER` | Immediate load (always) | Fetches parent + children in same query | ⚠️ Only if you ALWAYS need children |

#### **LAZY Example (Recommended):**

```yaml
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY  # ← Loads items only when accessed
```

**Generated SQL:**
```sql
-- First query: Only fetches Order
SELECT * FROM orders WHERE id = ?

-- Second query: Only if you access order.getOrderItems()
SELECT * FROM order_items WHERE order_id = ?
```

**✅ Advantages:**
- Better initial performance
- Only loads what you need
- Avoids loading unnecessary data

**⚠️ Disadvantage:**
- Can cause N+1 queries if you don't use `JOIN FETCH`

#### **Ejemplo EAGER (Usar con cuidado):**

```yaml
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: EAGER  # ← Always loads items with Order
```

**Generated SQL:**
```sql
-- Single query: Fetches Order + OrderItems
SELECT o.*, i.* 
FROM orders o 
LEFT JOIN order_items i ON i.order_id = o.id
WHERE o.id = ?
```

**✅ Advantage:**
- Single SQL query
- Data available immediately

**❌ Disadvantages:**
- Loads data even if unused
- Heavier queries
- Can cause performance issues

#### **Recommended Configurations by Type:**

```yaml
# OneToMany: ALWAYS LAZY
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY  # ← Avoids loading all items always

# ManyToOne: LAZY by default, EAGER only if always needed
relationships:
  - type: ManyToOne
    target: Customer
    joinColumn: customer_id
    fetch: LAZY  # ← LAZY by default

# OneToOne: LAZY if optional, EAGER if always exists
relationships:
  - type: OneToOne
    target: OrderSummary
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY  # ← LAZY if not always used
```

#### **N+1 Problem and how to solve it:**

**Problem:**
```java
// With LAZY fetch
List<Order> orders = orderRepository.findAll();  // 1 query
orders.forEach(order -> {
    order.getOrderItems().forEach(item -> {      // N queries (one per Order)
        System.out.println(item.getProductName());
    });
});
// Total: 1 + N queries = N+1 problem
```

**Solution - Use JOIN FETCH in queries:**
```java
@Query("SELECT o FROM OrderJpa o LEFT JOIN FETCH o.orderItems WHERE o.id = :id")
OrderJpa findByIdWithItems(@Param("id") String id);
```

---

### When to manually define inverse relationships?

#### ❌ You DON'T need to define ManyToOne if:

You already defined `OneToMany` with `mappedBy` on the "parent" side. eva4j automatically generates the inverse relationship.

**Example - Only define OneToMany:**

```yaml
# ✅ SUFFICIENT: Only define this in Order
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order          # ← eva4j generates ManyToOne automatically
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY

# ❌ DON'T NEED this in OrderItem (generated automatically)
#   - name: orderItem
#     relationships:
#       - type: ManyToOne
#         target: Order
#         joinColumn: order_id
#         fetch: LAZY
```

**Result:** Complete bidirectional relationship with FK `order_id` generated automatically.

**✅ Advantages:**
- Less YAML code (only define one side)
- No duplication or inconsistencies
- Works the same as defining both sides
- FK inferred automatically: `{mappedBy}_id`

---

#### ✅ You SHOULD define ManyToOne manually if:

##### 1. **You need a specific FK column name**

```yaml
# Define both sides to control FK name
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order
        cascade: [PERSIST, MERGE]
        fetch: LAZY
  
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Order
        joinColumn: fk_pedido_uuid    # ← Custom name
        fetch: LAZY
```

**When to use:**
- Your DB has specific conventions (`fk_*`, prefixes, etc.)
- Need to maintain compatibility with existing schema
- Migration from another tool/framework

---

##### 2. **Multiple FKs to the same entity**

```yaml
# Transaction has 'from' and 'to' Account
entities:
  - name: transaction
    tableName: transactions
    
    fields:
      - name: id
        type: String
      - name: amount
        type: BigDecimal
    
    relationships:
      # First relationship
      - type: ManyToOne
        target: Account
        joinColumn: from_account_id    # ← Explicit name required
        fetch: LAZY
      
      # Second relationship to same entity
      - type: ManyToOne
        target: Account
        joinColumn: to_account_id      # ← Different FK name
        fetch: LAZY
```

**When to use:**
- Self-relationships (category tree, org chart)
- Multiple relationships to same type (from/to, parent/child)
- Can't use `mappedBy` (which one would it be?)

---

##### 3. **Unidirectional relationship (no inverse side)**

```yaml
# OrderItem needs Product, but Product DOESN'T need OrderItems
entities:
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Product         # Product has NO List<OrderItem>
        joinColumn: product_id
        fetch: LAZY
  
  # In Product DON'T define OneToMany
  - name: product
    isRoot: true
    fields:
      - name: id
        type: String
      - name: name
        type: String
    # No relationships to OrderItem
```

**When to use:**
- Performance: avoid loading unnecessary collections
- Product is not part of Order aggregate
- Only need navigation in one direction

---

#### 📊 Quick Comparison

| Scenario | Define ManyToOne? | Why? |
|----------|-------------------|------|
| Standard relationship with `mappedBy` | ❌ No | eva4j generates it automatically |
| FK with custom name | ✅ Yes | To control `joinColumn` |
| Multiple FKs to same entity | ✅ Yes | Need explicit names |
| Unidirectional relationship | ✅ Yes | No inverse side (`mappedBy`) |
| Specific DB conventions | ✅ Yes | To comply with standards |
| Simple standard case | ❌ No | Let eva4j generate it |

---

#### ⚠️ Error Común

**NO hagas esto:**

```yaml
# ❌ INCORRECTO: Inconsistencia entre ambos lados
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order         # ← Espera campo "order" en OrderItem
        fetch: LAZY
  
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Order
        joinColumn: pedido_id  # ← Pero la FK se llama diferente
        fetch: LAZY
```

**Problema:** `mappedBy: order` busca un campo llamado `order`, pero `pedido_id` no coincide con la convención de nombres.

**✅ Soluciones:**

**Opción A - Deja que eva4j genere automáticamente:**
```yaml
# Solo define OneToMany, eva4j genera ManyToOne correctamente
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order
        fetch: LAZY
```

**Opción B - Define ambos lados consistentemente:**
```yaml
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: pedido        # ← Coincide con el nombre del campo
        fetch: LAZY
  
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Order
        joinColumn: pedido_id
        fetch: LAZY
```

---

#### 💡 Recomendación General

**Para el 90% de los casos:**

```yaml
# ✅ MEJOR PRÁCTICA: Solo define OneToMany
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY

# NO definas ManyToOne en OrderItem
# eva4j lo genera automáticamente con:
# - @JoinColumn(name = "order_id")
# - @ManyToOne(fetch = FetchType.LAZY)
```

**Solo define ambos lados cuando necesites control específico.**

---

## Tipos de Datos

### Tipos primitivos Java

| YAML | Java | JPA | Observaciones |
|------|------|-----|---------------|
| `String` | String | VARCHAR | En ID genera UUID |
| `Integer` | Integer | INTEGER | En ID genera IDENTITY |
| `Long` | Long | BIGINT | En ID genera IDENTITY |
| `Double` | Double | DOUBLE | - |
| `Float` | Float | FLOAT | - |
| `Boolean` | Boolean | BOOLEAN | - |
| `BigDecimal` | BigDecimal | DECIMAL | Importa automáticamente |

### Tipos de fecha/hora

| YAML | Java | Importa automáticamente |
|------|------|------------------------|
| `LocalDate` | LocalDate | java.time.LocalDate |
| `LocalDateTime` | LocalDateTime | java.time.LocalDateTime |
| `LocalTime` | LocalTime | java.time.LocalTime |

### Tipos especiales

| YAML | Java | Uso |
|------|------|-----|
| `UUID` | UUID | IDs únicos |
| Cualquier Enum | Enum personalizado | Estados, tipos |
| Cualquier VO | Value Object | Conceptos de dominio |

### Colecciones

#### Lista de primitivos

```yaml
fields:
  - name: tags
    type: List<String>
```

Genera:
```java
@ElementCollection
@CollectionTable(name = "order_tags", joinColumns = @JoinColumn(name = "order_id"))
@Column(name = "tags")
@Builder.Default
private List<String> tags = new ArrayList<>();
```

#### Lista de Value Objects

```yaml
fields:
  - name: addresses
    type: List<Address>  # Address es un VO definido
```

Genera:
```java
@ElementCollection
@CollectionTable(name = "customer_addresses", joinColumns = @JoinColumn(name = "customer_id"))
@Builder.Default
private List<AddressJpa> addresses = new ArrayList<>();
```

---

## Ejemplos Completos

### Ejemplo 1: E-Commerce (Order)

```yaml
aggregates:
  - name: Order
    entities:
      - name: order
        isRoot: true
        tableName: orders
        
        fields:
          - name: id
            type: String
          
          - name: orderNumber
            type: String
          
          - name: customerId
            type: String
          
          - name: status
            type: OrderStatus
          
          - name: totalAmount
            type: Money
          
          - name: shippingAddress
            type: Address
          
          - name: createdAt
            type: LocalDateTime
          
          - name: updatedAt
            type: LocalDateTime
        
        relationships:
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY
      
      - name: orderItem
        tableName: order_items
        
        fields:
          - name: id
            type: Long
          
          - name: productId
            type: String
          
          - name: productName
            type: String
          
          - name: quantity
            type: Integer
          
          - name: unitPrice
            type: Money
          
          - name: subtotal
            type: Money
        
        relationships:
          - type: ManyToOne
            target: Order
            joinColumn: order_id
            fetch: LAZY
    
    valueObjects:
      - name: Money
        fields:
          - name: amount
            type: BigDecimal
          - name: currency
            type: String
      
      - name: Address
        fields:
          - name: street
            type: String
          - name: city
            type: String
          - name: state
            type: String
          - name: zipCode
            type: String
          - name: country
            type: String
    
    enums:
      - name: OrderStatus
        values:
          - PENDING
          - CONFIRMED
          - PROCESSING
          - SHIPPED
          - DELIVERED
          - CANCELLED
          - REFUNDED
```

### Ejemplo 2: Blog (Post)

```yaml
aggregates:
  - name: Post
    entities:
      - name: post
        isRoot: true
        tableName: posts
        
        fields:
          - name: id
            type: Long
          
          - name: title
            type: String
          
          - name: slug
            type: String
          
          - name: content
            type: String
          
          - name: authorId
            type: String
          
          - name: status
            type: PostStatus
          
          - name: publishedAt
            type: LocalDateTime
          
          - name: tags
            type: List<String>
          
          - name: metadata
            type: PostMetadata
        
        relationships:
          - type: OneToMany
            target: Comment
            mappedBy: post
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY
      
      - name: comment
        tableName: comments
        
        fields:
          - name: id
            type: Long
          
          - name: authorId
            type: String
          
          - name: authorName
            type: String
          
          - name: content
            type: String
          
          - name: createdAt
            type: LocalDateTime
          
          - name: approved
            type: Boolean
        
        relationships:
          - type: ManyToOne
            target: Post
            joinColumn: post_id
            fetch: LAZY
    
    valueObjects:
      - name: PostMetadata
        fields:
          - name: viewCount
            type: Integer
          - name: likeCount
            type: Integer
          - name: shareCount
            type: Integer
    
    enums:
      - name: PostStatus
        values: [DRAFT, PUBLISHED, ARCHIVED, DELETED]
```

### Ejemplo 3: Banking (Account)

```yaml
aggregates:
  - name: Account
    entities:
      - name: account
        isRoot: true
        tableName: accounts
        
        fields:
          - name: id
            type: String
          
          - name: accountNumber
            type: String
          
          - name: customerId
            type: String
          
          - name: accountType
            type: AccountType
          
          - name: balance
            type: Money
          
          - name: status
            type: AccountStatus
          
          - name: openedAt
            type: LocalDate
        
        relationships:
          - type: OneToMany
            target: Transaction
            mappedBy: account
            cascade: [PERSIST, MERGE]
            fetch: LAZY
      
      - name: transaction
        tableName: transactions
        
        fields:
          - name: id
            type: String
          
          - name: transactionNumber
            type: String
          
          - name: type
            type: TransactionType
          
          - name: amount
            type: Money
          
          - name: description
            type: String
          
          - name: timestamp
            type: LocalDateTime
          
          - name: balanceAfter
            type: Money
        
        relationships:
          - type: ManyToOne
            target: Account
            joinColumn: account_id
            fetch: LAZY
    
    valueObjects:
      - name: Money
        fields:
          - name: amount
            type: BigDecimal
          - name: currency
            type: String
    
    enums:
      - name: AccountType
        values: [CHECKING, SAVINGS, INVESTMENT, CREDIT]
      
      - name: AccountStatus
        values: [ACTIVE, INACTIVE, SUSPENDED, CLOSED]
      
      - name: TransactionType
        values: [DEPOSIT, WITHDRAWAL, TRANSFER, FEE, INTEREST]
```

### Ejemplo 4: Múltiples Agregados en un módulo

```yaml
aggregates:
  - name: Customer
    entities:
      - name: customer
        isRoot: true
        fields:
          - name: id
            type: String
          - name: name
            type: String
          - name: email
            type: String
          - name: phone
            type: String
          - name: registeredAt
            type: LocalDateTime
    
    valueObjects:
      - name: ContactInfo
        fields:
          - name: email
            type: String
          - name: phone
            type: String
  
  - name: Product
    entities:
      - name: product
        isRoot: true
        fields:
          - name: id
            type: String
          - name: name
            type: String
          - name: description
            type: String
          - name: price
            type: Money
          - name: stock
            type: Integer
          - name: category
            type: ProductCategory
    
    valueObjects:
      - name: Money
        fields:
          - name: amount
            type: BigDecimal
          - name: currency
            type: String
    
    enums:
      - name: ProductCategory
        values: [ELECTRONICS, CLOTHING, FOOD, BOOKS, TOYS]
```

---

## Comando de Generación

```bash
# Generar todas las entidades del módulo
eva4j generate entities <module-name>
```

### Salida generada

```
✓ Found 1 aggregate(s) and 1 enum(s)

📦 Aggregates to generate:
  ├── Order (Root: Order)
  │   ├── OrderItem
  │   └── Money (VO)

⠋ Generating files...

✅ Successfully generated 13 files for module 'order'

📁 Generated Files:
  ✓ Enum: OrderStatus
  ✓ Domain Entity: Order
  ✓ JPA Entity: OrderJpa
  ✓ Domain Entity: OrderItem
  ✓ JPA Entity: OrderItemJpa
  ✓ Domain VO: Money
  ✓ JPA VO: MoneyJpa
  ✓ Mapper: OrderMapper
  ✓ Repository: OrderRepository
  ✓ JPA Repository: OrderJpaRepository
  ✓ Repository Impl: OrderRepositoryImpl
```

---

## Tips y Mejores Prácticas

### ✅ Hacer

1. **Usa nombres descriptivos**: `orderNumber` en lugar de `number`
2. **PascalCase para tipos**: `OrderStatus`, `Money`, `Address`
3. **camelCase para campos**: `totalAmount`, `createdAt`
4. **snake_case para tablas**: `order_items`, `customer_addresses`
5. **Define IDs apropiados**: String para UUIDs, Long para secuencias
6. **Usa Value Objects**: Para conceptos cohesivos (Money, Address)
7. **Cascade apropiado**: PERSIST, MERGE para agregados; evita ALL

### ❌ Evitar

1. **Don't use Long for UUIDs**: Use String
2. **Don't create bidirectional relationships without mappedBy**: Define the owner
3. **Don't use EAGER without reason**: LAZY is better for performance
4. **Don't mix concepts**: One aggregate = one transaction
5. **Don't use @Column in domain.yaml**: It's for JPA, generated automatically

---

## Current Support and Limitations

### ✅ Supported

- Aggregates with root and secondary entities
- Embedded Value Objects
- Enums with values
- OneToMany, ManyToOne, OneToOne relationships
- Java primitive and date types
- Collections of primitives and VOs
- IDs: String (UUID), Long/Integer (IDENTITY)
- Custom Cascade and Fetch

### 🚧 Coming Soon

- JSR-303 validations
- Automatic auditing
- Soft delete
- Custom query methods
- Indexes and constraints
- Entity inheritance

---

## Frequently Asked Questions

**Q: Can I have multiple aggregates in one domain.yaml?**  
A: Yes, define multiple entries in the `aggregates` array.

**Q: How do I reference an enum from another aggregate?**  
A: Enums are global to the module, just use the name: `type: OrderStatus`

**Q: Can I use a VO in multiple aggregates?**  
A: Yes, but you must define it in each aggregate (for now).

**Q: What happens if I regenerate the code?**  
A: Files are overwritten. Modify only in templates, not in generated code.

**Q: Can I customize generated entities?**  
A: Yes, modify the templates in `templates/aggregate/`.

---

## Additional Resources

- [Implementation Guide](IMPLEMENTATION_SUMMARY.md)
- [Testing Guide](TESTING_GUIDE.md)
- [Quick Reference](QUICK_REFERENCE.md)
- [DDD Documentation](https://martinfowler.com/bliki/DomainDrivenDesign.html)

---

**Ready to start?** Create your `domain.yaml` and run:

```bash
eva4j generate entities <your-module>
```
