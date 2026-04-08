# Temporal system.yaml — Complete Specification

Reference for building and validating `system/system.yaml` in a Temporal-based system.

> **PATH RULE:** The file MUST be saved as `system/system.yaml` — inside the `system/` directory at the project root. NEVER save as `system.yaml` at the project root.

---

## Complete structure

```yaml
system:
  name: project-name              # kebab-case
  groupId: com.example
  javaVersion: 21
  springBootVersion: 3.5.5
  database: postgresql             # h2 | postgresql | mysql

# ─── Temporal replaces both messaging (Kafka) and sync (Feign) ───────────────
orchestration:
  enabled: true
  engine: temporal
  temporal:
    target: localhost:7233
    namespace: project-name
    # Task queues are module-prefixed (module-scoped):
    #   {MODULE}_WORKFLOW_QUEUE    — Workflows of the module
    #   {MODULE}_LIGHT_TASK_QUEUE  — Fast activities (< 30s)
    #   {MODULE}_HEAVY_TASK_QUEUE  — Heavy activities (up to 2min)

modules:
  - name: orders                   # plural, kebab-case
    description: "Order lifecycle management"
    exposes:
      - method: GET                # GET | POST | PUT | PATCH | DELETE
        path: /orders/{id}
        useCase: GetOrder
        description: "Get order by ID"
      - method: POST
        path: /orders
        useCase: CreateOrder
        description: "Create a new order"

  - name: notifications
    description: "Notification delivery service"
    # No REST endpoints — only exposes activities

# ─── WORKFLOWS: Cross-module business flows orchestrated by Temporal ─────────
# Only REAL business flows — no data-sync workflows.
# Cross-module data is obtained on-demand with Remote Activities (reads).
workflows:

  - name: PlaceOrderWorkflow
    trigger:
      module: orders               # Module that triggers this workflow
      on: create                   # Business event: create | cancel | confirm | etc.
    taskQueue: ORDER_WORKFLOW_QUEUE
    saga: true                     # Enables compensation on failure
    steps:
      - activity: GetOrderDetails
        target: orders             # Module that owns this activity
        type: sync                 # sync = wait for result | async = fire-and-forget
        input: [orderId]
        output: [customerId, items, totalAmount]
        timeout: 5s

      - activity: GetCustomerById
        target: customers
        type: sync
        input: [customerId]
        output: [customerId, firstName, lastName, email]
        timeout: 5s

      - activity: ReserveStock
        target: inventory
        type: sync
        input: [orderId, items]
        compensation: ReleaseStock  # Activity to call on saga rollback
        timeout: 10s

      - activity: ProcessOrderPayment
        target: payments
        type: sync
        input: [orderId, customerId, totalAmount]
        output: [paymentId]
        compensation: RefundPayment
        timeout: 30s

      - activity: ConfirmOrder
        target: orders
        type: sync
        input: [orderId]

      - activity: NotifyOrderPlaced
        target: notifications
        type: async                 # Fire-and-forget — does NOT block saga
        input: [orderId, email, firstName, totalAmount]
```

---

## Sections NOT present in Temporal system.yaml

These sections from broker-based systems are **replaced** by Temporal:

| Absent section | Replacement |
|---|---|
| `messaging:` | `orchestration:` |
| `integrations.async:` | `workflows:` with cross-module steps |
| `integrations.sync:` | `workflows:` with Remote Activity steps |

---

## Naming conventions

| Element | Convention | Valid example | Invalid example |
|---|---|---|---|
| Modules | plural, kebab-case | `orders`, `order-items` | `Order`, `order_items` |
| Workflows | PascalCase + `Workflow` | `PlaceOrderWorkflow` | `placeOrderWorkflow` |
| Activities | PascalCase, verb + noun | `ReserveStock`, `GetCustomerById` | `reserveStock` |
| Task Queues | SCREAMING_SNAKE_CASE | `ORDER_WORKFLOW_QUEUE` | `order-queue` |
| Events (in domain.yaml) | PascalCase + past + `Event` | `OrderPlacedEvent` | `PlaceOrderEvent` |
| useCases | PascalCase, verb + noun | `CreateOrder`, `ConfirmOrder` | `createOrder` |

### Task Queue naming

```
{MODULE_SCREAMING_SNAKE}_WORKFLOW_QUEUE     → ORDER_WORKFLOW_QUEUE
{MODULE_SCREAMING_SNAKE}_LIGHT_TASK_QUEUE   → CUSTOMER_LIGHT_TASK_QUEUE
{MODULE_SCREAMING_SNAKE}_HEAVY_TASK_QUEUE   → PAYMENT_HEAVY_TASK_QUEUE
```

### Activity naming

| Type | Pattern | Example |
|------|---------|---------|
| Read singular | `Get{Entity}ById` | `GetCustomerById` |
| Read batch | `Get{Entities}ByIds` | `GetProductsByIds` |
| Write | `{Verb}{Noun}` | `ReserveStock`, `ProcessOrderPayment` |
| Compensation | `{InverseVerb}{Noun}` | `ReleaseStock`, `RefundPayment` |
| Reactor | `Notify{Event}` | `NotifyOrderPlaced` |
| Local | `{Verb}{Noun}` | `ConfirmOrder`, `RetryCharge` |

### Workflow naming

```
{Verb}{Entity}Workflow          → PlaceOrderWorkflow
{Entity}{Event}Workflow         → ProductCreatedWorkflow
```

---

## Workflow step properties

| Property | Required | Description |
|---|---|---|
| `activity` | ✅ | Name of the activity to invoke |
| `target` | ✅ | Module that owns the activity |
| `type` | ✅ | `sync` (wait for result) or `async` (fire-and-forget) |
| `input` | ✅ | List of input field names |
| `output` | ❌ | List of output field names (for sync steps that return data) |
| `compensation` | ❌ | Activity name to call on saga rollback |
| `timeout` | ❌ | Step timeout (e.g., `10s`, `30s`, `2m`) |
| `optional` | ❌ | `true` if the step can fail without failing the saga |
| `parallel` | ❌ | `true` to execute in parallel with adjacent parallel steps |

### Parallel steps

Steps marked `parallel: true` are executed concurrently using `Async.function()`:

```yaml
steps:
  - activity: GetProductsByIds
    target: products
    type: sync
    parallel: true                  # ⎫ executed in parallel
  - activity: ReserveStock          # ⎭
    target: inventory
    type: sync
    parallel: true
  - activity: ProcessOrderPayment    # after both parallel steps
    target: payments
    type: sync
```

---

## Structural restrictions

- ❌ **No `messaging:` section** — Temporal replaces Kafka/RabbitMQ
- ❌ **No `integrations:` section** — replaced by `workflows:`
- ❌ **No data-sync workflows** — use on-demand reads via Activities
- ❌ **No activities that do cross-module lookups** — workflow assembles data
- ✅ Each workflow step `target` must reference an existing module in `modules:`
- ✅ `compensation:` activities must be declared in the target module's domain.yaml
- ✅ `saga: true` workflows should have `compensation:` on reversible steps
- ✅ `type: async` only for non-critical steps (notifications, analytics)
- ✅ `ports:` only for external services (not between internal modules)
- ✅ All content in English

---

## Workflow patterns

### Pattern 1: Saga with Compensation

Multi-step flow where failure of a step reverses the previous ones.

```yaml
workflows:
  - name: PlaceOrderWorkflow
    saga: true
    steps:
      - activity: ReserveStock
        compensation: ReleaseStock
      - activity: ProcessOrderPayment
        compensation: RefundPayment
      - activity: ConfirmOrder           # last step — no compensation needed
```

### Pattern 2: Enrichment + Action

Obtain read data before executing the main action.

```yaml
steps:
  - activity: GetCustomerById           # read (enrichment)
    output: [firstName, email]
  - activity: ProcessOrderPayment       # action (uses enrichment data)
    input: [orderId, customerId, totalAmount]
```

### Pattern 3: Parallel Steps

Execute independent steps simultaneously.

```yaml
steps:
  - activity: GetProductsByIds
    parallel: true
  - activity: ReserveStock
    parallel: true
  - activity: ProcessOrderPayment       # after both complete
```

### Pattern 4: Single Business Effect

An event triggers a single action in another module.

```yaml
workflows:
  - name: ProductCreatedWorkflow
    trigger:
      module: products
      on: create
    steps:
      - activity: InitializeStock
        compensation: DeleteStock
```

### Pattern 5: Non-Blocking Notification

Last step, doesn't affect saga outcome.

```yaml
steps:
  - activity: NotifyOrderPlaced
    type: async                         # fire-and-forget
    # NO compensation — failure doesn't reverse the saga
```

---

## useCases — naming patterns

### Verbs by operation type

| Operation | Recommended verbs | Example |
|---|---|---|
| Create resource | `Create` | `CreateOrder` |
| Update | `Update` | `UpdateOrder` |
| Delete | `Delete` | `DeleteOrder` |
| Get by ID | `Get` | `GetOrder` |
| List with pagination | `FindAll` | `FindAllOrders` |
| State transition | `Confirm`, `Cancel`, `Approve` | `ConfirmOrder` |
| Punctual action | `Send`, `Process`, `Calculate` | `ProcessPayment` |

### CRUD standard — generates complete implementation:

| Pattern | HTTP | Implementation |
|---|---|---|
| `Create{Aggregate}` | POST `/resource` | Complete handler |
| `Update{Aggregate}` | PUT `/resource/{id}` | Complete handler |
| `Delete{Aggregate}` | DELETE `/resource/{id}` | Complete handler |
| `Get{Aggregate}` | GET `/resource/{id}` | Complete handler |
| `FindAll{PluralAggregate}` | GET `/resource` | Complete handler |

### Business useCases — generates scaffold:

```java
public class ConfirmOrderCommandHandler implements CommandHandler<ConfirmOrderCommand, Void> {
    @Override
    public Void handle(ConfirmOrderCommand command) {
        throw new UnsupportedOperationException("ConfirmOrderCommandHandler not implemented yet");
    }
}
```

---

## Validation checklist

- [ ] Modules in plural kebab-case
- [ ] `orchestration:` section present with `engine: temporal`
- [ ] No `messaging:` section
- [ ] No `integrations:` section
- [ ] All workflow steps have `activity:`, `target:`, `type:`
- [ ] All `target:` modules exist in `modules:`
- [ ] Saga workflows have `saga: true`
- [ ] Reversible steps in sagas have `compensation:`
- [ ] `type: async` only for non-critical steps
- [ ] No data-sync workflows
- [ ] Task queues follow module-prefixed naming
- [ ] useCases in PascalCase
- [ ] All content in English
- [ ] File saved inside `system/` directory as `system/system.yaml` (NEVER at the project root)
