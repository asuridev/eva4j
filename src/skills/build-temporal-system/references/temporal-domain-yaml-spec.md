# Temporal domain.yaml per module — Complete Specification

Reference for building `system/{module}.yaml` in a Temporal-based system. This file is the input for `eva g entities <module>`.

> **PATH RULE:** Each module file MUST be saved inside the `system/` directory as `system/{module-name}.yaml` (e.g., `system/orders.yaml`, `system/payments.yaml`). NEVER save module YAML files at the project root.

---

## Expert role per module

When building each `system/{module}.yaml`, activate the domain expert role:

- **`orders`** → lifecycles, states, invariants, item relationships, calculated totals
- **`payments`** → payment methods, retries, terminal states, double-charge prevention
- **`inventory`** → available vs. reserved stock, movements, replenishment
- **`notifications`** → channels, templates, idempotency, retries

Propose necessary fields not mentioned, expressive Value Objects, implicit invariants, realistic state transitions. If you need specific business rules, ask.

---

## Absolute restrictions

1. ❌ **No `@ManyToOne`/`@OneToMany` between aggregates** — cross-aggregate references are IDs with `reference:`
2. ❌ **No audit fields in `fields:`** — `audit.enabled: true` generates them
3. ❌ **No `defaultValue` on non `readOnly` fields**
4. ❌ **No `transitions` without `initialValue`** in the enum
5. ❌ **No invented modules in `reference.module`** — only those in `system/system.yaml`
6. ❌ **No duplicate `endpoints:` from `system.yaml → exposes:`**
7. ❌ **`endpoints:` NEVER a flat list** — always `{ basePath, versions: [{ version, operations }] }`
8. ❌ **No `listeners:` section** — Temporal replaces Kafka consumers
9. ❌ **No `readModels:` section** — on-demand reads via Activities replace local projections
10. ❌ **No `ports:` for internal modules** — only for external services (non-Temporal)
11. ❌ **All in English**
12. ❌ **No `lifecycle:` and `triggers:` on the same event** — mutually exclusive
13. ❌ **No `lifecycle: softDelete` without `hasSoftDelete: true`** on root entity
14. ❌ **No `lifecycle: delete` with `hasSoftDelete: true`**
15. ❌ **No fields in lifecycle events not in the root entity** — `C2-010`
16. ❌ **No `topic:` on events** — Temporal replaces Kafka topics
17. ❌ **Events with `notifies:` must reference workflows in system.yaml** — never arbitrary names
18. ❌ **Activities must not do cross-module data lookups** — all data comes via input

---

## Inference from system.yaml

| Source in system.yaml | Destination in domain.yaml |
|---|---|
| `modules[x].exposes[]` | `endpoints:` with `basePath` + `versions[].operations[]` |
| `workflows[].steps[]` where `target = module` | `activities:` — the module's capabilities |
| `workflows[].trigger` where `module = module` | `events:` with `notifies:` |
| None — internal processes | `workflows:` — single-module internal flows |

---

## Complete module.yaml structure

```yaml
aggregates:
  - name: Order                         # PascalCase
    entities:
      - name: order                     # camelCase — root entity
        isRoot: true
        tableName: orders               # snake_case
        hasSoftDelete: false
        audit:
          enabled: true
          trackUser: false
        fields:
          - name: id
            type: String
          - name: customerId
            type: String
            reference:
              aggregate: Customer
              module: customers
          - name: totalAmount
            type: BigDecimal
            readOnly: true
            defaultValue: "0.00"
          - name: status
            type: OrderStatus
            readOnly: true
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
            type: String
          - name: productId
            type: String
            reference:
              aggregate: Product
              module: products

    valueObjects:
      - name: ShippingAddress
        fields:
          - name: street
            type: String
          - name: city
            type: String

    enums:
      - name: OrderStatus
        initialValue: PENDING
        transitions:
          - from: PENDING
            to: CONFIRMED
            method: confirm
          - from: PENDING
            to: CANCELLED
            method: cancel
        values: [PENDING, CONFIRMED, CANCELLED]

    events:
      # Events WITH notifies: → trigger cross-module workflows
      - name: OrderPlacedEvent
        lifecycle: create
        fields:
          - name: orderId
            type: String
          - name: placedAt
            type: LocalDateTime
        notifies:
          - workflow: PlaceOrderWorkflow

      # Events with triggers: → state transitions
      - name: OrderCancelledEvent
        triggers:
          - cancel
        fields:
          - name: orderId
            type: String
        notifies:
          - workflow: CancelOrderWorkflow

      # Events WITHOUT notifies: → internal Domain Events
      - name: CustomerUpdatedEvent
        lifecycle: update
        fields:
          - name: customerId
            type: String
        # NO notifies → Domain Event internal

# ─── Activities this module EXPOSES ──────────────────────────────────────────
activities:
  - name: GetOrderDetails
    type: light
    description: "Gets full order details including items"
    input:
      - name: orderId
        type: String
    output:
      - name: customerId
        type: String
      - name: items
        type: List<OrderItemDetail>
      - name: totalAmount
        type: BigDecimal
    nestedTypes:
      - name: OrderItemDetail
        fields:
          - name: productId
            type: String
          - name: quantity
            type: Integer
          - name: unitPrice
            type: BigDecimal
    timeout: 5s

  - name: ConfirmOrder
    type: light
    description: "Confirms the order after successful payment"
    input:
      - name: orderId
        type: String
    timeout: 5s

  - name: CancelExpiredOrder
    type: light
    description: "Cancels order that did not receive payment in time"
    input:
      - name: orderId
        type: String
    timeout: 5s

# ─── Single-module workflows (internal) ─────────────────────────────────────
workflows:
  - name: ExpireOrderWorkflow
    description: "Cancels order if payment not received within timeout"
    trigger:
      on: orderCreated
    taskQueue: ORDER_WORKFLOW_QUEUE
    steps:
      - wait: paymentCompleted
        timeout: 30m
      - activity: CancelExpiredOrder
        timeout: 5s

endpoints:
  basePath: /orders
  versions:
    - version: v1
      operations:
        - useCase: CreateOrder
          method: POST
          path: /
        - useCase: GetOrder
          method: GET
          path: /{id}
        - useCase: FindAllOrders
          method: GET
          path: /

# ─── ports: ONLY for EXTERNAL services ──────────────────────────────────────
# ports:
#   - name: processCharge
#     service: PaymentGatewayService
#     target: payment-gateway
#     baseUrl: https://api.payments.example.com
#     http: POST /charges
```

---

## Activities section — detailed specification

### Activity properties

| Property | Required | Description |
|---|---|---|
| `name` | ✅ | PascalCase activity name |
| `type` | ✅ | `light` (< 30s) or `heavy` (up to 2min) |
| `description` | ❌ | What the activity does |
| `input` | ✅ | List of input fields with `name` and `type` |
| `output` | ❌ | List of output fields (omit for void activities) |
| `timeout` | ❌ | Activity timeout (e.g., `5s`, `30s`) |
| `compensation` | ❌ | Name of the compensating activity |
| `retryPolicy` | ❌ | Retry configuration |
| `nestedTypes` | ❌ | Complex types used in input/output |
| `externalTypes` | ❌ | Types defined in another module |

### Retry policy

```yaml
retryPolicy:
  maxAttempts: 3
  initialInterval: 1s
  backoffCoefficient: 2.0
```

### External types

When an activity receives types defined in another module:

```yaml
activities:
  - name: ReserveStock
    input:
      - name: items
        type: List<OrderItemDetail>
    externalTypes:
      - name: OrderItemDetail
        module: orders
```

### Activity type classification

| Module role | Activity types | Examples |
|---|---|---|
| Data provider | Read activities | `GetCustomerById`, `GetProductsByIds` |
| Executor | Write + compensation | `ReserveStock` / `ReleaseStock` |
| Reactor | Notification activities | `NotifyOrderPlaced` |
| Orchestrator (local) | State transition activities | `ConfirmOrder`, `CancelExpiredOrder` |

---

## Events with `notifies:` — detailed specification

### When to use `notifies:`

- The event triggers a **cross-module workflow** defined in `system.yaml`
- There is a **real business effect** in another module (not data sync)

### When NOT to use `notifies:`

- The event is purely internal (no cross-module reaction)
- The data is only needed for sync (use on-demand reads instead)

```yaml
events:
  # ✅ Real business effect → notifies
  - name: OrderPlacedEvent
    lifecycle: create
    notifies:
      - workflow: PlaceOrderWorkflow

  # ✅ Internal event → NO notifies
  - name: CustomerUpdatedEvent
    lifecycle: update
    # On-demand reads: GetCustomerById activity
```

---

## Workflows section (single-module) — detailed specification

### When a workflow is single-module

- All its activities belong to the **same module**
- It doesn't need data from other bounded contexts
- It's an internal process (retry, timeout, scheduling, verification)
- Other modules don't need to know it exists

### Step types in single-module workflows

| Step type | Property | Description |
|---|---|---|
| Activity | `activity:` | Invoke a local activity |
| Wait | `wait:` + `timeout:` | Wait for a signal with timeout |

```yaml
workflows:
  - name: RetryChargeWorkflow
    trigger:
      on: chargeFailed
    taskQueue: PAYMENT_WORKFLOW_QUEUE
    steps:
      - activity: RetryCharge
        retryPolicy:
          maxAttempts: 3
          initialInterval: 2s
          backoffCoefficient: 2.0
      - activity: MarkPaymentFailed
```

---

## Visibility of fields

| Configuration | Business constructor | CreateDto | ResponseDto |
|---|---|---|---|
| Normal | ✅ | ✅ | ✅ |
| `readOnly: true` | ❌ | ❌ | ✅ |
| `readOnly` + `defaultValue` | ⚡ assigned with default | ❌ | ✅ |
| `hidden: true` | ✅ | ✅ | ❌ |
| Both flags | ❌ | ❌ | ❌ |

---

## Supported data types

| YAML | Java |
|---|---|
| `String` | String |
| `Integer` | Integer |
| `Long` | Long |
| `BigDecimal` | BigDecimal |
| `Boolean` | Boolean |
| `LocalDate` | LocalDate |
| `LocalDateTime` | LocalDateTime |
| `LocalTime` | LocalTime |
| `Instant` | Instant |
| `UUID` | UUID |

---

## JSR-303 Validations

Declare in `fields[].validations` — applied **only** in Command and CreateDto.

```yaml
validations:
  - type: NotBlank
    message: "Required"
  - type: Email
    message: "Invalid email"
  - type: Size
    min: 3
    max: 50
  - type: Positive
```

---

## Checklist per module

- [ ] Root entity has `id` field of type String
- [ ] `isRoot: true` on exactly one entity per aggregate
- [ ] `audit:` section present on root entity
- [ ] `readOnly:` fields with `defaultValue:` where appropriate
- [ ] `reference:` on cross-aggregate ID fields
- [ ] `endpoints:` as object with `basePath` + `versions` (NOT flat list)
- [ ] `events:` with `notifies:` only for cross-module workflow triggers
- [ ] `events:` without `notifies:` for internal Domain Events
- [ ] `activities:` section declares all capabilities referenced in system.yaml workflows
- [ ] Activity `input:` contains all data the activity needs (no cross-module lookups)
- [ ] `compensation:` declared for reversible activities
- [ ] `workflows:` only for single-module internal flows
- [ ] No `listeners:` section (Temporal replaces it)
- [ ] No `readModels:` section (on-demand reads replace it)
- [ ] `ports:` only for external services (if any)
- [ ] No `topic:` on events
- [ ] All in English
