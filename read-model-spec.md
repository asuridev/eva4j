# Local Read Model Convention — Specification

## Purpose

This document defines the standard convention for implementing the **Local Read Model** pattern (also known as Materialized View or Event-Driven Cache) in eva4j projects.

A Local Read Model is a **projection of data owned by another bounded context**, maintained via domain events. It eliminates synchronous (HTTP) dependencies between modules, improving autonomy, resilience, and performance.

---

## When to Use

Use a Local Read Model when:

- A module needs data from another module to **validate preconditions** or **enrich entities** at creation time
- The data is read-only from the consumer's perspective (the source module owns mutations)
- Eventual consistency (milliseconds of delay) is acceptable for the business domain
- You want to eliminate `ports:` (sync HTTP calls) to prepare for microservice extraction (`eva detach`)

Do **NOT** use a Local Read Model when:

- You need **strong consistency** (e.g., financial transactions that require real-time balance checks)
- The source data changes so frequently that the event volume becomes a bottleneck
- A single sync call at an infrequent operation is simpler and sufficient

---

## YAML Schema — `readModels` Section

The `readModels` section is declared in `{module}.yaml` as a **sibling** of `aggregates`, `listeners`, and `ports`.

### Location in File

```yaml
# {module}.yaml

aggregates:
  - name: ...       # Domain aggregates (business entities)

readModels:          # ← NEW SECTION — Local Read Models
  - name: ...

listeners:
  - event: ...      # External event consumers (non-cache)

# ports:            # ← REMOVED when replaced by readModels
```

### Full Schema

```yaml
readModels:
  - name: ProductReadModel                 # PascalCase + "ReadModel" suffix (REQUIRED)
    source:                                # Origin traceability (REQUIRED)
      module: products                     # Source module name (kebab-case)
      aggregate: Product                   # Source aggregate name (PascalCase)
    tableName: rm_products                 # Database table name (REQUIRED, must use rm_ prefix)
    fields:                                # Projected fields — subset of source (REQUIRED, min 1)
      - name: id
        type: String
      - name: name
        type: String
      - name: price
        type: BigDecimal
      - name: status
        type: String
    syncedBy:                              # Events that maintain this table (REQUIRED, min 1)
      - event: ProductCreatedEvent         # Event name (PascalCase + Event suffix)
        action: UPSERT                     # Sync action: UPSERT | DELETE | SOFT_DELETE
      - event: ProductUpdatedEvent
        action: UPSERT
      - event: ProductDeactivatedEvent
        action: UPSERT
```

### Property Reference

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | String | YES | Read model name. MUST end with `ReadModel` suffix. PascalCase. |
| `source` | Object | YES | Traceability to the owning module and aggregate. |
| `source.module` | String | YES | Module that owns the source data. Kebab-case. |
| `source.aggregate` | String | YES | Aggregate in the source module. PascalCase. |
| `tableName` | String | YES | Database table name. MUST use `rm_` prefix. Snake_case. |
| `fields` | Array | YES | Fields to project. Must include `id`. Subset of source aggregate fields. |
| `fields[].name` | String | YES | Field name. CamelCase. |
| `fields[].type` | String | YES | Java type (String, BigDecimal, Long, Integer, Boolean, LocalDateTime, etc.) |
| `syncedBy` | Array | YES | Events that trigger sync operations on this read model. |
| `syncedBy[].event` | String | YES | Event name. PascalCase, must end with `Event`. |
| `syncedBy[].action` | String | YES | One of: `UPSERT`, `DELETE`, `SOFT_DELETE`. |

---

## Sync Actions

Only three actions are supported — keep it simple:

| Action | Meaning | SQL Equivalent | When to Use |
|---|---|---|---|
| `UPSERT` | Insert if new, update if exists | `INSERT ... ON CONFLICT (id) DO UPDATE` | Creation, updates, status changes |
| `DELETE` | Remove the record permanently | `DELETE FROM rm_x WHERE id = ?` | Hard deletes in source module |
| `SOFT_DELETE` | Mark as inactive with timestamp | `UPDATE rm_x SET deleted_at = NOW() WHERE id = ?` | Source uses soft delete pattern |

---

## Naming Conventions

### Database Tables

| Element | Convention | Example |
|---|---|---|
| Table prefix | `rm_` (Read Model) | `rm_products` |
| Table name body | Source module name, snake_case | `rm_customers` |
| Uniqueness | Prefix + source module ensures no collision | `rm_products` in orders ≠ `rm_products` in deliveries (different DBs in microservice mode) |

Visual identification in database:
```
myapp_db=# \dt
 Schema |      Name       | Type  
--------+-----------------+-------
 public | orders          | table   ← domain
 public | order_items     | table   ← domain
 public | rm_products     | table   ← read model (projection from products)
 public | rm_customers    | table   ← read model (projection from customers)
```

### Java Classes

| Artifact | Convention | Example | Package |
|---|---|---|---|
| JPA Entity | `{Name}Jpa` | `ProductReadModelJpa` | `infrastructure/database/entities/` |
| JPA Repository | `{Name}JpaRepository` | `ProductReadModelJpaRepository` | `infrastructure/database/repositories/` |
| Domain Interface | `{Name}Repository` | `ProductReadModelRepository` | `domain/repositories/` |
| Repository Impl | `{Name}RepositoryImpl` | `ProductReadModelRepositoryImpl` | `infrastructure/database/repositories/` |
| Sync Handler | `Sync{Source}ReadModelHandler` | `SyncProductReadModelHandler` | `application/usecases/` |
| Sync Command | `Sync{Source}ReadModelCommand` | `SyncProductReadModelCommand` | `application/commands/` |

### File Structure in Module

```
orders/
├── domain/
│   ├── models/
│   │   ├── entities/
│   │   │   └── Order.java                        ← Domain entity
│   │   └── readmodels/                            ← NEW directory
│   │       ├── ProductReadModel.java              ← Domain read model (record or simple class)
│   │       └── CustomerReadModel.java
│   └── repositories/
│       ├── OrderRepository.java                   ← Domain repository
│       ├── ProductReadModelRepository.java         ← Read model repository interface
│       └── CustomerReadModelRepository.java
├── application/
│   ├── commands/
│   │   └── SyncProductReadModelCommand.java       ← Sync command
│   └── usecases/
│       └── SyncProductReadModelHandler.java        ← Sync handler (one per read model)
└── infrastructure/
    └── database/
        ├── entities/
        │   ├── OrderJpa.java                      ← Domain JPA entity
        │   ├── ProductReadModelJpa.java            ← Read model JPA entity
        │   └── CustomerReadModelJpa.java
        └── repositories/
            ├── OrderJpaRepository.java
            ├── ProductReadModelJpaRepository.java
            └── CustomerReadModelJpaRepository.java
```

---

## Read Model vs Aggregate — Comparison

| Characteristic | Aggregate | Read Model |
|---|---|---|
| YAML section | `aggregates:` | `readModels:` |
| Table prefix | None (`orders`) | `rm_` (`rm_products`) |
| Has business logic | Yes (methods, invariants) | No (data only) |
| Emits events | Yes | Never |
| Has REST endpoints | Can | Never |
| Domain class | Rich entity | Record or anemic class |
| Modified by | Use cases within the module | Events from another module |
| Has `source:` property | No | Yes (mandatory) |
| Has `syncedBy:` property | No | Yes (mandatory) |
| Constructor pattern | Business + reconstruction | Full constructor only (for reconstruction) |
| Audit fields | Optional (`audit:`) | Never (not business data) |

---

## Generated Code Expectations

### Domain Read Model Class

A simple class or record — no business logic, no setters, no empty constructor:

```java
// domain/models/readmodels/ProductReadModel.java
package com.example.myapp.orders.domain.models.readmodels;

public class ProductReadModel {
    private final String id;
    private final String name;
    private final BigDecimal price;
    private final String status;

    // Full constructor (reconstruction only)
    public ProductReadModel(String id, String name, BigDecimal price, String status) {
        this.id = id;
        this.name = name;
        this.price = price;
        this.status = status;
    }

    // Getters only — NO setters, NO business methods
    public String getId() { return id; }
    public String getName() { return name; }
    public BigDecimal getPrice() { return price; }
    public String getStatus() { return status; }

    // Query helpers (read-only checks, not mutations)
    public boolean isActive() { return "ACTIVE".equals(this.status); }
}
```

### JPA Read Model Entity

Uses Lombok. No audit fields. No soft delete on the read model itself (the `SOFT_DELETE` action is for when the **source** uses soft delete):

```java
// infrastructure/database/entities/ProductReadModelJpa.java
@Entity
@Table(name = "rm_products")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProductReadModelJpa {

    @Id
    private String id;       // Same ID as source entity — no auto-generation

    @Column(name = "name")
    private String name;

    @Column(name = "price")
    private BigDecimal price;

    @Column(name = "status")
    private String status;

    // For SOFT_DELETE action only:
    // @Column(name = "deleted_at")
    // private LocalDateTime deletedAt;
}
```

> **Important:** The `@Id` is NOT auto-generated. It mirrors the source entity's ID exactly.

### Repository Interface

```java
// domain/repositories/ProductReadModelRepository.java
public interface ProductReadModelRepository {
    void upsert(ProductReadModel readModel);           // For UPSERT action
    void deleteById(String id);                         // For DELETE action
    Optional<ProductReadModel> findById(String id);     // For consumer queries
    boolean existsById(String id);                      // For existence validation
}
```

### Sync Handler

One handler per read model. Handles all `syncedBy` events via separate listener methods:

```java
// application/usecases/SyncProductReadModelHandler.java
@Service
public class SyncProductReadModelHandler {

    private final ProductReadModelRepository repository;

    // One method per syncedBy entry
    public void onProductCreated(ProductCreatedIntegrationEvent event) {
        ProductReadModel model = new ProductReadModel(
            event.id(), event.name(), event.price(), event.status()
        );
        repository.upsert(model);
    }

    public void onProductUpdated(ProductUpdatedIntegrationEvent event) {
        ProductReadModel model = new ProductReadModel(
            event.id(), event.name(), event.price(), event.status()
        );
        repository.upsert(model);
    }

    public void onProductDeactivated(String id) {
        repository.softDeleteById(id);
    }
}
```

### Kafka Listeners (one per event, delegates to sync handler)

```java
// infrastructure/kafkaListener/ProductCreatedReadModelListener.java
@Component("ordersProductCreatedReadModelListener")
public class ProductCreatedReadModelListener {

    private final SyncProductReadModelHandler handler;

    @KafkaListener(topics = "${topics.product-created}")
    public void handle(EventEnvelope<Map<String, Object>> event, Acknowledgment ack) {
        // Deserialize and delegate
        handler.onProductCreated(/* mapped event */);
        ack.acknowledge();
    }
}
```

---

## Interaction with `listeners:` Section

Read model sync events are declared in `syncedBy` within `readModels`, **not** in the `listeners:` section. The `listeners:` section is reserved for business event handling (events that trigger domain use cases).

```yaml
readModels:
  - name: ProductReadModel
    syncedBy:                              # ← Sync events live HERE
      - event: ProductCreatedEvent
        action: UPSERT

listeners:
  - event: StockReservedEvent              # ← Business events live HERE
    producer: inventory
    useCase: HandleStockReserved
```

The code generator should:
1. Read `syncedBy` entries and generate Kafka listeners + sync handler
2. Read `listeners` entries and generate Kafka listeners + business command/handler
3. Both produce listener classes but in conceptually different categories

---

## Impact on `system.yaml`

When a read model replaces a sync call, `system.yaml` changes:

### Remove from `integrations.sync`

```yaml
# BEFORE
integrations:
  sync:
    - caller: orders
      calls: products
      port: OrderProductService
      using:
        - GET /products/{id}

# AFTER — entry removed entirely
```

### Add to `integrations.async`

```yaml
# New events for read model sync
integrations:
  async:
    - event: ProductCreatedEvent
      producer: products
      topic: PRODUCT_CREATED
      consumers:
        - module: orders
          readModel: ProductReadModel    # ← New field: indicates read model sync, not business use case

    - event: ProductUpdatedEvent
      producer: products
      topic: PRODUCT_UPDATED
      consumers:
        - module: orders
          readModel: ProductReadModel

    - event: ProductDeactivatedEvent
      producer: products
      topic: PRODUCT_DEACTIVATED
      consumers:
        - module: orders
          readModel: ProductReadModel
```

> **Note:** Consumer entries for read model sync use `readModel:` instead of `useCase:`. This distinguishes infrastructure sync from business logic in the system diagram.

---

## Impact on Source Module

The source module (`products`, `customers`) must emit the events referenced in `syncedBy`. These events should be declared in the source module's `domain.yaml` under `events:`.

### Minimum Events Required

| Source Lifecycle | Required Events |
|---|---|
| Entity can be created | `{Aggregate}CreatedEvent` |
| Entity can be updated | `{Aggregate}UpdatedEvent` |
| Entity can be deleted (hard) | `{Aggregate}DeletedEvent` |
| Entity can be deactivated (soft) | `{Aggregate}DeactivatedEvent` |
| Entity has status transitions | One event per relevant transition |

### Event Field Convention

Events consumed by read models for **UPSERT** actions should include **all fields declared in the read model's `fields`** section. The event payload is the source of truth for the projection.

For **DELETE** and **SOFT_DELETE** actions, the listener only deserializes the `id` field — the event only needs to carry the entity identifier. The `SyncHandler` calls `repository.deleteById(id)` or `repository.softDeleteById(id)` respectively.

```yaml
# In products.yaml — event must carry all fields that rm_products needs
events:
  - name: ProductCreatedEvent
    topic: PRODUCT_CREATED
    fields:
      - name: productId        # Maps to readModel field "id"
        type: String
      - name: name
        type: String
      - name: price
        type: BigDecimal
      - name: status
        type: String
      - name: createdAt         # Extra fields are fine — consumer ignores them
        type: LocalDateTime
```

---

## Impact on C4 Diagrams

### `c4-container.mmd`

Replace direct sync relationships with broker-mediated relationships:

```mermaid
%% BEFORE (sync)
Rel(orders, products, "GET /products/{id}", "HTTP/JSON")

%% AFTER (async via read model)
Rel(products, broker, "ProductCreatedEvent, ProductUpdatedEvent", "Kafka")
Rel(broker, orders, "Sync ProductReadModel", "Kafka")
```

---

## Design Decisions to Document

When adopting the Local Read Model pattern, document these decisions in the module's `.md` file:

### Eventual Consistency Acknowledgment

Add an "Architectural Decisions" section:

```markdown
## Architectural Decisions

### ADR-001: Local Read Model for Product Data

**Context:** Orders needs product name, price, and status to validate and create orders.

**Decision:** Use event-driven Local Read Model (`rm_products`) instead of sync HTTP call.

**Consequences:**
- (+) Orders module is fully autonomous — no runtime dependency on products
- (+) Lower latency — local DB query vs HTTP roundtrip
- (+) Resilient — orders can be created even if products service is down
- (-) Eventual consistency — in a window of milliseconds, a newly created/updated
  product may not be reflected in the read model
- (-) Additional infrastructure — Kafka listeners, sync handlers, extra table

**Accepted risk:** A product price change or deactivation may not be reflected for
a few milliseconds. This is acceptable for this business domain.
```

---

## Validation Rules for Code Generator

The code generator should validate the following when processing `readModels`:

| Code | Severity | Rule |
|---|---|---|
| RM-001 | ERROR | `name` must end with `ReadModel` suffix |
| RM-002 | ERROR | `tableName` must start with `rm_` prefix |
| RM-003 | ERROR | `source.module` must reference an existing module in `system.yaml` |
| RM-004 | ERROR | `fields` must include an `id` field |
| RM-005 | ERROR | `syncedBy` must have at least one entry |
| RM-006 | ERROR | `syncedBy[].action` must be one of `UPSERT`, `DELETE`, `SOFT_DELETE` |
| RM-007 | WARNING | `syncedBy[].event` references an event not declared in the source module's `events:` |
| RM-008 | WARNING | Read model field not present in any `syncedBy` event's `fields` — may always be null |
| RM-009 | INFO | `ports:` section still contains sync calls to the same module referenced in `source:` — consider removing |
| RM-010 | ERROR | `source.module` and current module are the same — read models are for cross-module projections only |

---

## Migration Path: Sync to Read Model

When converting an existing sync dependency to a read model:

### Step 1 — Add events to source module
Edit `{source}.yaml`: add `events:` entries for Created/Updated/Deleted.

### Step 2 — Add read model to consumer module
Edit `{consumer}.yaml`: add `readModels:` section with fields and `syncedBy`.

### Step 3 — Remove sync port from consumer module
Edit `{consumer}.yaml`: remove the port entry from `ports:`.

### Step 4 — Update system.yaml
- Remove entry from `integrations.sync[]`
- Add entries to `integrations.async[]` with `readModel:` consumer type

### Step 5 — Update module narrative
Edit `{consumer}.md`: update use case flows, sequence diagrams, and interaction diagrams to reflect local queries instead of HTTP calls.

### Step 6 — Update C4 diagrams
Edit `c4-container.mmd`: replace direct `Rel()` with broker-mediated relationships.

### Step 7 — Regenerate code
```bash
eva g entities {source}      # Generates event classes
eva g entities {consumer}    # Generates read model entities, repos, listeners, sync handler
```

---

## Complete Example

### Before (sync dependency)

```yaml
# orders.yaml
ports:
  - name: findProductById
    service: OrderProductService
    target: products
    baseUrl: http://localhost:8080
    http: GET /products/{id}
    fields:
      - name: id
        type: String
      - name: name
        type: String
      - name: price
        type: BigDecimal
      - name: status
        type: String
```

### After (event-driven read model)

```yaml
# products.yaml — add events
events:
  - name: ProductCreatedEvent
    topic: PRODUCT_CREATED
    fields:
      - name: productId
        type: String
      - name: name
        type: String
      - name: price
        type: BigDecimal
      - name: status
        type: String
      - name: createdAt
        type: LocalDateTime

  - name: ProductUpdatedEvent
    topic: PRODUCT_UPDATED
    fields:
      - name: productId
        type: String
      - name: name
        type: String
      - name: price
        type: BigDecimal
      - name: status
        type: String
      - name: updatedAt
        type: LocalDateTime

  - name: ProductDeactivatedEvent
    topic: PRODUCT_DEACTIVATED
    triggers:
      - deactivate
    fields:
      - name: productId
        type: String
      - name: deactivatedAt
        type: LocalDateTime
```

```yaml
# orders.yaml — replace port with readModel
readModels:
  - name: ProductReadModel
    source:
      module: products
      aggregate: Product
    tableName: rm_products
    fields:
      - name: id
        type: String
      - name: name
        type: String
      - name: price
        type: BigDecimal
      - name: status
        type: String
    syncedBy:
      - event: ProductCreatedEvent
        action: UPSERT
      - event: ProductUpdatedEvent
        action: UPSERT
      - event: ProductDeactivatedEvent
        action: UPSERT

# ports: ← REMOVED (no more sync call to products)
```

```yaml
# system.yaml — update integrations
integrations:
  async:
    - event: ProductCreatedEvent
      producer: products
      topic: PRODUCT_CREATED
      consumers:
        - module: orders
          readModel: ProductReadModel

    - event: ProductUpdatedEvent
      producer: products
      topic: PRODUCT_UPDATED
      consumers:
        - module: orders
          readModel: ProductReadModel

    - event: ProductDeactivatedEvent
      producer: products
      topic: PRODUCT_DEACTIVATED
      consumers:
        - module: orders
          readModel: ProductReadModel

  # sync: ← orders→products entry REMOVED
```

---

**Convention version:** 1.0.0
**Created:** 2026-03-24
**Applicable to:** eva4j projects using `readModels` pattern
