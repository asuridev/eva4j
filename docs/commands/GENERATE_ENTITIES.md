# Command `generate entities` (alias: `g entities`)

---

## Table of Contents

1. [Description and purpose](#1-description-and-purpose)
2. [Syntax and YAML location](#2-syntax-and-yaml-location)
3. [Base domain.yaml structure](#3-base-domainyaml-structure)
4. [Supported data types](#4-supported-data-types)
5. [Field properties](#5-field-properties)
6. [JSR-303 Validations](#6-jsr-303-validations)
7. [Auditing](#7-auditing)
8. [Relationships](#8-relationships)
9. [Value Objects](#9-value-objects)
10. [Enums and state transitions](#10-enums-and-state-transitions)
11. [Domain events](#11-domain-events)
12. [Multiple aggregates](#12-multiple-aggregates)
13. [Generated files](#13-generated-files)
14. [Complete examples](#14-complete-examples)
15. [Prerequisites and common errors](#15-prerequisites-and-common-errors)

---

## 1. Description and purpose

`generate entities` is the core command of eva4j. From a `domain.yaml` file, it generates the complete hexagonal architecture for the module:

- **Domain layer** – Entities, Value Objects, Enums, repository interfaces
- **Application layer** – Commands, Queries, handlers, DTOs, mappers
- **Infrastructure layer** – JPA entities, Spring Data repositories, repository implementations, REST controllers

The generator understands relationships, auditing, field visibility, validations, state transitions, and domain events.

---

## 2. Syntax and YAML location

```bash
eva generate entities <module>
eva g entities <module>          # short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `<module>` | Yes | Module name (must already exist in the project) |

### Options

| Option | Description |
|--------|-------------|
| `--force` | Overwrite files that have developer changes |

### YAML location

The file is read from:

```
src/main/java/<package>/<module>/domain.yaml
```

> The generator detects developer changes via checksums. If a file was manually modified, it is **not overwritten** unless you use `--force`.

---

## 3. Base domain.yaml structure

```yaml
aggregates:                          # List of aggregates in the module
  - name: Order                      # Aggregate name (PascalCase)
    entities:                        # Entities of the aggregate
      - name: Order                  # Entity name (PascalCase)
        isRoot: true                 # true = aggregate root
        tableName: orders            # SQL table name (optional)
        audit:                       # Auditing (optional)
          enabled: true
          trackUser: false
        fields:                      # Entity fields
          - name: id
            type: String
          - name: status
            type: OrderStatus        # Reference to enum or VO
        relationships:               # JPA relationships (optional)
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY

      - name: OrderItem              # Secondary entity (no isRoot or isRoot: false)
        tableName: order_items
        fields:
          - name: id
            type: Long
          - name: quantity
            type: Integer

    valueObjects:                    # Aggregate Value Objects
      - name: Money
        fields:
          - name: amount
            type: BigDecimal
          - name: currency
            type: String

    enums:                           # Aggregate enums
      - name: OrderStatus
        values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]

    events:                          # Domain events (optional)
      - name: OrderPlaced
        fields:
          - name: customerId
            type: String
```

> **Supported synonyms**: `fields` = `properties`; `target` = `targetEntity`

### The `id` field rule

Every entity **must** have a field named exactly `id`:

| `id` type | Generated strategy |
|-----------|--------------------|
| `String` | `@GeneratedValue(strategy = GenerationType.UUID)` |
| `Long` | `@GeneratedValue(strategy = GenerationType.IDENTITY)` |

---

## 4. Supported data types

| YAML type | Java type | Notes |
|-----------|-----------|-------|
| `String` | `String` | For `id` generates UUID |
| `Integer` | `Integer` | For `id` generates IDENTITY |
| `Long` | `Long` | For `id` generates IDENTITY |
| `Double` | `Double` | |
| `BigDecimal` | `BigDecimal` | |
| `Boolean` | `Boolean` | |
| `LocalDate` | `LocalDate` | Auto-imported |
| `LocalDateTime` | `LocalDateTime` | Auto-imported |
| `LocalTime` | `LocalTime` | Auto-imported |
| `UUID` | `UUID` | Auto-imported |
| `List<String>` | `List<String>` | `@ElementCollection` |
| `List<VO>` | `List<VoJpa>` | `@ElementCollection` |
| Enum name | Module enum | `@Enumerated(STRING)` |
| VO name | Value Object | `@Embedded` |

---

## 5. Field properties

```yaml
fields:
  - name: fieldName        # camelCase, required
    type: String           # Java type, required
    readOnly: false        # default false
    hidden: false          # default false
    validations: []        # JSR-303 annotations
    annotations: []        # raw JPA annotations
    reference:             # semantic reference to another aggregate
      aggregate: Customer
      module: customers
    enumValues: []         # inline enum (alternative to enums:)
```

### Visibility matrix

| Field | Creation constructor | CreateDto/Command | Full constructor | ResponseDto |
|-------|---------------------|-------------------|------------------|-------------|
| normal | ✅ | ✅ | ✅ | ✅ |
| `readOnly: true` | ❌ | ❌ | ✅ | ✅ |
| `hidden: true` | ✅ | ✅ | ✅ | ❌ |
| `readOnly + hidden` | ❌ | ❌ | ✅ | ❌ |

### readOnly

Marks a field as calculated/derived: excluded from the business constructor and `CreateDto`/`CreateCommand`, but present in the full constructor (reconstruction from persistence) and in `ResponseDto`.

```yaml
fields:
  - name: totalAmount
    type: BigDecimal
    readOnly: true    # calculated from the sum of items
```

> When an enum has `initialValue`, the corresponding field is automatically treated as `readOnly`.

### hidden

Marks a field as sensitive: included on creation but does NOT appear in `ResponseDto`.

```yaml
fields:
  - name: passwordHash
    type: String
    hidden: true    # do not expose in API
```

### annotations (raw JPA)

Allows adding custom JPA annotations to the generated JPA entity.

```yaml
fields:
  - name: email
    type: String
    annotations:
      - "@Column(unique = true, nullable = false)"
```

### reference

Declares a semantic reference to a field in another aggregate. Generates a Javadoc comment indicating the relationship, without creating a code dependency.

```yaml
fields:
  - name: customerId
    type: String
    reference:
      aggregate: Customer
      module: customers
```

Generated in the domain entity:

```java
/** @see customers.Customer */
private String customerId;
```

---

## 6. JSR-303 Validations

Validations are declared on the field and applied to `CreateCommand` and `CreateDto`. They are **not** added to domain entities.

```yaml
fields:
  - name: name
    type: String
    validations:
      - type: NotBlank
        message: "Name is required"
      - type: Size
        min: 2
        max: 100
```

Auto-generates import: `import jakarta.validation.constraints.*;`

### Supported parameters

| Parameter | Description |
|-----------|-------------|
| `type` | Annotation name without `@` (required) |
| `message` | Custom error message |
| `value` | Single value (for `@Min`, `@Max`) |
| `min` | Minimum value (for `@Size`, `@DecimalMin`) |
| `max` | Maximum value (for `@Size`, `@DecimalMax`) |
| `regexp` | Regular expression (for `@Pattern`) |
| `integer` | Integer digits (for `@Digits`) |
| `fraction` | Decimal digits (for `@Digits`) |
| `inclusive` | Inclusive boundary (for `@DecimalMin`, `@DecimalMax`) |

### Examples by type

```yaml
# @NotBlank
- type: NotBlank
  message: "Field is required"

# @NotNull
- type: NotNull

# @Size
- type: Size
  min: 2
  max: 255

# @Email
- type: Email

# @Min / @Max (for numeric fields)
- type: Min
  value: 1
- type: Max
  value: 999

# @Pattern
- type: Pattern
  regexp: "^[A-Z]{2}[0-9]{6}$"
  message: "Invalid format"

# @DecimalMin / @DecimalMax
- type: DecimalMin
  min: "0.01"
  inclusive: true
- type: DecimalMax
  max: "9999.99"

# @Digits
- type: Digits
  integer: 6
  fraction: 2
```

---

## 7. Auditing

### Syntax

```yaml
# New (recommended)
audit:
  enabled: true       # adds createdAt, updatedAt
  trackUser: true     # also adds createdBy, updatedBy

# Legacy (equivalent to audit.enabled: true, trackUser: false)
auditable: true
```

### Generated JPA inheritance

| Configuration | JPA base class |
|---------------|----------------|
| No auditing | no inheritance |
| `audit.enabled: true` | `extends AuditableEntity` |
| `audit.trackUser: true` | `extends FullAuditableEntity` |

### Generated fields

| Field | `audit.enabled` | `audit.trackUser` | In ResponseDto |
|-------|-----------------|-------------------|----------------|
| `createdAt` | ✅ | ✅ | ✅ |
| `updatedAt` | ✅ | ✅ | ✅ |
| `createdBy` | ❌ | ✅ | ❌ |
| `updatedBy` | ❌ | ✅ | ❌ |

> `createdBy` and `updatedBy` are administrative metadata: they are never exposed in response DTOs.

### Infrastructure generated with `trackUser: true`

When `trackUser` is enabled, eva4j automatically generates:

| File | Purpose |
|------|---------|
| `UserContextHolder.java` | ThreadLocal for the current user |
| `UserContextFilter.java` | Captures the `X-User` header from each request |
| `AuditorAwareImpl.java` | Provides the current user to JPA Auditing |

`Application.java` is configured with `@EnableJpaAuditing(auditorAwareRef = "auditorProvider")`.

### Example

```yaml
entities:
  - name: Order
    isRoot: true
    tableName: orders
    audit:
      enabled: true
      trackUser: true
    fields:
      - name: id
        type: String
      - name: amount
        type: BigDecimal
```

> Audit fields **must not be defined manually** in `fields:`; they are inherited from the JPA base class.

---

## 8. Relationships

### Properties

| Property | Values | Description |
|----------|--------|-------------|
| `type` | `OneToMany`, `ManyToOne`, `OneToOne`, `ManyToMany` | Relationship type |
| `target` / `targetEntity` | Entity name | Related entity |
| `mappedBy` | field name | Inverse side of the relationship |
| `joinColumn` | column name | FK column name |
| `cascade` | array of `PERSIST`, `MERGE`, `REMOVE`, `REFRESH`, `DETACH`, `ALL` | Cascade operations |
| `fetch` | `LAZY` (default), `EAGER` | Loading strategy |

### Automatic inverse side generation

When you define `OneToMany` with `mappedBy`, eva4j automatically generates `@ManyToOne` in the target JPA entity. **Defining both sides is not required.**

```yaml
# ✅ Only this is needed
entities:
  - name: Order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY

# eva4j generates in OrderItemJpa:
# @ManyToOne(fetch = FetchType.LAZY)
# @JoinColumn(name = "order_id")
# private OrderJpa order;
```

> If you define `ManyToOne` manually, that definition takes priority over auto-generation.

### OneToMany

```yaml
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE, REMOVE]
    fetch: LAZY
```

Generated in domain:

```java
private List<OrderItem> orderItems = new ArrayList<>();
public void addOrderItem(OrderItem item) { orderItems.add(item); }
public void removeOrderItem(OrderItem item) { orderItems.remove(item); }
```

### ManyToOne (manual, when you need a specific FK)

```yaml
relationships:
  - type: ManyToOne
    target: Order
    joinColumn: fk_order_uuid
    fetch: LAZY
```

### OneToOne

```yaml
# Inverse side (with mappedBy)
relationships:
  - type: OneToOne
    target: OrderSummary
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY

# Owner side (with FK)
relationships:
  - type: OneToOne
    target: Order
    joinColumn: order_id
    fetch: LAZY
```

### When to define ManyToOne manually

| Scenario | Define ManyToOne? |
|----------|------------------|
| Standard relationship with `mappedBy` | ❌ eva4j generates it |
| FK with custom name | ✅ Yes, to control `joinColumn` |
| Multiple FKs to the same entity | ✅ Yes, for distinct names |
| Unidirectional relationship (no inverse) | ✅ Yes |

### Recommended cascade

```yaml
# Child has no meaning without parent → include REMOVE
cascade: [PERSIST, MERGE, REMOVE]

# Child has an independent lifecycle
cascade: [PERSIST, MERGE]
```

---

## 9. Value Objects

Immutable objects that represent domain concepts without their own identity.

```yaml
valueObjects:
  - name: Money
    fields:
      - name: amount
        type: BigDecimal
      - name: currency
        type: String
```

Generates:

- `Money.java` – immutable domain class with constructor, getters, `equals()`, `hashCode()`
- `MoneyJpa.java` – `@Embeddable` with Lombok

Usage in a field:

```yaml
- name: totalAmount
  type: Money    # automatically detected as @Embedded
```

### List of Value Objects

```yaml
- name: addresses
  type: List<Address>
```

Generates:

```java
@ElementCollection
@CollectionTable(name = "entity_addresses", joinColumns = @JoinColumn(name = "entity_id"))
@Builder.Default
private List<AddressJpa> addresses = new ArrayList<>();
```

---

## 10. Enums and state transitions

### Simple enum

```yaml
enums:
  - name: OrderStatus
    values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]
```

Generates `OrderStatus.java` with the enumerated values. In JPA: `@Enumerated(EnumType.STRING)`.

### Enum with state transitions

Transitions generate business methods in the entity, validation logic in the enum, and prevent invalid states.

```yaml
enums:
  - name: OrderStatus
    initialValue: PENDING          # assigns an initial value; field becomes readOnly
    values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]
    transitions:
      - from: PENDING              # can be a string or [array]
        to: CONFIRMED
        method: confirm            # name of the method generated in the entity
      - from: [PENDING, CONFIRMED]
        to: CANCELLED
        method: cancel
        guard: "this.status == OrderStatus.DELIVERED"  # throws BusinessException if true
      - from: CONFIRMED
        to: SHIPPED
        method: ship
```

#### What is generated in the Enum

```java
private static final Map<OrderStatus, List<OrderStatus>> VALID_TRANSITIONS = Map.of(
    PENDING,   List.of(CONFIRMED, CANCELLED),
    CONFIRMED, List.of(SHIPPED, CANCELLED),
    SHIPPED,   List.of(DELIVERED));

public boolean canTransitionTo(OrderStatus next) {
    return VALID_TRANSITIONS.getOrDefault(this, List.of()).contains(next);
}

public OrderStatus transitionTo(OrderStatus next) {
    if (!canTransitionTo(next)) {
        throw new InvalidStateTransitionException(this, next);
    }
    return next;
}
```

#### What is generated in the aggregate root

One method per transition, plus `is*()` and `can*()` helpers:

```java
public void confirm() {
    this.status = this.status.transitionTo(OrderStatus.CONFIRMED);
}

public void cancel() {
    if (this.status == OrderStatus.DELIVERED) {
        throw new BusinessException("Cannot cancel a delivered order");
    }
    this.status = this.status.transitionTo(OrderStatus.CANCELLED);
}

public boolean isPending() { return this.status == OrderStatus.PENDING; }
public boolean canConfirm() { return this.status.canTransitionTo(OrderStatus.CONFIRMED); }
```

### `initialValue`

Assigns a default value to the status field in the creation constructor. The field is automatically marked as `readOnly` (does not appear in `CreateDto`/`CreateCommand`).

```yaml
enums:
  - name: OrderStatus
    initialValue: PENDING
```

### `guard`

Java condition evaluated in the transition method. If the expression is `true`, a `BusinessException` is thrown.

```yaml
- from: [PENDING, CONFIRMED]
  to: CANCELLED
  method: cancel
  guard: "this.totalAmount.compareTo(BigDecimal.ZERO) == 0"
```

---

## 11. Domain events

Events are declared under the aggregate (at the same level as `entities:`, `enums:`, `valueObjects:`).

```yaml
aggregates:
  - name: Order
    events:
      - name: OrderPlaced        # "Event" suffix is added automatically
        fields:
          - name: customerId
            type: String
          - name: totalAmount
            type: BigDecimal
      - name: OrderCancelled
        fields:
          - name: reason
            type: String
    entities:
      - name: Order
        # ...
```

### Generated files

| File | Description |
|------|-------------|
| `shared/domain/DomainEvent.java` | Abstract base class (generated once per project) |
| `domain/models/events/OrderPlacedEvent.java` | Concrete event extending `DomainEvent` |
| `domain/models/events/OrderCancelledEvent.java` | Concrete event |
| `raise()` / `pullDomainEvents()` in the aggregate root | Event infrastructure in the entity |
| `OrderRepositoryImpl.java` | Calls `eventPublisher.publishEvent()` when saving |
| `OrderDomainEventHandler.java` | Class with `@TransactionalEventListener` per event |

### Generated event

```java
public final class OrderPlacedEvent extends DomainEvent {
    private final String customerId;
    private final BigDecimal totalAmount;

    public OrderPlacedEvent(String customerId, BigDecimal totalAmount) {
        this.customerId = customerId;
        this.totalAmount = totalAmount;
    }

    // getters
}
```

### How to raise an event in the entity

```java
public class Order {
    private final List<DomainEvent> domainEvents = new ArrayList<>();

    public void place(String customerId, BigDecimal totalAmount) {
        // business logic...
        raise(new OrderPlacedEvent(customerId, totalAmount));
    }

    protected void raise(DomainEvent event) {
        domainEvents.add(event);
    }

    public List<DomainEvent> pullDomainEvents() {
        List<DomainEvent> events = new ArrayList<>(domainEvents);
        domainEvents.clear();
        return events;
    }
}
```

---

## 12. Multiple aggregates

A `domain.yaml` can contain multiple aggregates. Each one generates its own set of files.

```yaml
aggregates:
  - name: Customer
    entities:
      - name: Customer
        isRoot: true
        fields:
          - name: id
            type: String
          - name: email
            type: String

  - name: Product
    entities:
      - name: Product
        isRoot: true
        fields:
          - name: id
            type: String
          - name: name
            type: String
    enums:
      - name: ProductCategory
        values: [ELECTRONICS, CLOTHING, FOOD]
```

> Enums and Value Objects are local to the aggregate where they are defined. If two aggregates need the same VO, it must be declared in each one.

---

## 13. Generated files

For each aggregate, approximately the following files are generated:

| File | Layer | Description |
|------|-------|-------------|
| `{Root}.java` | Domain | Aggregate root entity |
| `{Entity}.java` | Domain | Secondary entities |
| `{Vo}.java` | Domain | Value Objects |
| `{Enum}.java` | Domain | Enums (with VALID_TRANSITIONS if transitions exist) |
| `{Root}Repository.java` | Domain | Repository interface (port) |
| `Create{Root}Command.java` | Application | Create command |
| `Create{Root}CommandHandler.java` | Application | Command handler |
| `Get{Root}Query.java` | Application | Get by ID query |
| `Get{Root}QueryHandler.java` | Application | Query handler |
| `List{Root}Query.java` | Application | Paginated list query |
| `List{Root}QueryHandler.java` | Application | List handler |
| `{Root}ResponseDto.java` | Application | Response DTO |
| `Create{Root}Dto.java` | Application | Create DTO |
| `{Root}ApplicationMapper.java` | Application | Mapper Command/DTO ↔ Domain |
| `{Root}Jpa.java` | Infrastructure | JPA entity |
| `{Entity}Jpa.java` | Infrastructure | Secondary JPA entities |
| `{Vo}Jpa.java` | Infrastructure | JPA Value Objects (@Embeddable) |
| `{Root}Mapper.java` | Infrastructure | Mapper Domain ↔ JPA |
| `{Root}JpaRepository.java` | Infrastructure | Spring Data repository |
| `{Root}RepositoryImpl.java` | Infrastructure | Repository implementation |
| `{Root}Controller.java` | Infrastructure | REST controller |

### Generated REST endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/{module}/{entity}` | Create |
| `GET` | `/api/{module}/{entity}/{id}` | Get by ID |
| `GET` | `/api/{module}/{entity}?page=0&size=20` | Paginated list |
| `PUT` | `/api/{module}/{entity}/{id}` | Update |
| `DELETE` | `/api/{module}/{entity}/{id}` | Delete |

---

## 14. Complete examples

### Example 1: Order with transitions and events

```yaml
aggregates:
  - name: Order
    entities:
      - name: Order
        isRoot: true
        tableName: orders
        audit:
          enabled: true
        fields:
          - name: id
            type: String
          - name: customerId
            type: String
            reference:
              aggregate: Customer
              module: customers
          - name: status
            type: OrderStatus
          - name: totalAmount
            type: BigDecimal
            readOnly: true
        relationships:
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY

      - name: OrderItem
        tableName: order_items
        fields:
          - name: id
            type: Long
          - name: productId
            type: String
          - name: quantity
            type: Integer
            validations:
              - type: Min
                value: 1
          - name: unitPrice
            type: BigDecimal

    enums:
      - name: OrderStatus
        initialValue: PENDING
        values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]
        transitions:
          - from: PENDING
            to: CONFIRMED
            method: confirm
          - from: CONFIRMED
            to: SHIPPED
            method: ship
          - from: [PENDING, CONFIRMED]
            to: CANCELLED
            method: cancel
            guard: "this.status == OrderStatus.DELIVERED"

    events:
      - name: OrderPlaced
        fields:
          - name: customerId
            type: String
      - name: OrderCancelled
        fields:
          - name: reason
            type: String
```

### Example 2: User with auditing and a sensitive field

```yaml
aggregates:
  - name: User
    entities:
      - name: User
        isRoot: true
        tableName: users
        audit:
          enabled: true
          trackUser: true
        fields:
          - name: id
            type: String
          - name: username
            type: String
            validations:
              - type: NotBlank
              - type: Size
                min: 3
                max: 50
          - name: email
            type: String
            validations:
              - type: Email
            annotations:
              - "@Column(unique = true)"
          - name: passwordHash
            type: String
            hidden: true
          - name: role
            type: UserRole
          - name: active
            type: Boolean

    enums:
      - name: UserRole
        values: [ADMIN, USER, MODERATOR]
```

---

## 15. Prerequisites and common errors

### Prerequisites

- Project created with `eva create`
- Existing module (`eva add module <module>`)
- `domain.yaml` file at `src/main/java/<package>/<module>/`

### Common errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Module does not exist` | Module was not created | Run `eva add module <module>` |
| `YAML file not found` | No `domain.yaml` at the expected path | Check `src/main/java/<pkg>/<module>/domain.yaml` |
| `Invalid relationship target` | Target entity not defined in the same YAML | Define the target entity in the same `domain.yaml` |
| `Column 'x_id' is duplicated` | ManyToOne defined manually + auto-generated | Remove the manual ManyToOne; let eva4j generate it |
| File not regenerated | File was manually modified (checksum) | Use `--force` to overwrite |
| Import errors | Field `type` doesn't match name in `enums:` or `valueObjects:` | Verify names match exactly |
