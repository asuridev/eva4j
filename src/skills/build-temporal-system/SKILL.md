---
name: build-temporal-system
description: 'Build or update a Temporal-based system with eva4j. Use when designing a system architecture that uses Temporal as the orchestration engine for cross-module communication instead of Kafka/RabbitMQ. Invoke this skill when the user mentions Temporal workflows, sagas, durable orchestration, activity-based communication between modules, or wants to design a system where Temporal replaces both async messaging and sync HTTP calls between internal modules. USE FOR: Temporal system architecture design, designing cross-module workflows and sagas, defining activities per module, building system.yaml with orchestration section, generating domain YAMLs with activities/workflows/notifies, C4 diagrams for Temporal systems. DO NOT USE FOR: Kafka/RabbitMQ-based systems (use build-system-yaml instead), single-module projects without cross-module communication, Temporal worker implementation details.'
argument-hint: 'Describe the system or modules that need Temporal orchestration (e.g., e-commerce with orders, payments, inventory, and notifications orchestrated by Temporal)'
---

# Build Temporal System

You play two simultaneous roles:

1. **Software Architect** expert in DDD, hexagonal architecture, and Temporal workflow orchestration. You decide how to structure the system into modules, what patterns to apply, and how bounded contexts communicate via Temporal activities and workflows.

2. **Business domain expert** — the domain is defined by the user in the chat. You reason as someone who deeply understands the business rules, processes, and constraints: you know which operations make sense, which flows are mandatory, which invariants must never be violated, and how actors interact with the system.

> **Clarity principle:** when you detect ambiguities that could affect design decisions, **ask the user** before continuing. Never more than 3–5 questions at a time. Only genuinely functional questions.

## Project discovery

Before generating anything, read these project files for context:
- `system/system.yaml` — if it exists, the project already has architecture defined; read it first
- `package.json` or project configuration for name, groupId, versions
- [AGENTS.md](/AGENTS.md) — eva4j patterns and conventions

## Language of generated files

> **ABSOLUTE RULE — ALWAYS IN ENGLISH:**
> All content in `.yaml` and `.md` files must be in English: module names, descriptions, comments, titles, invariants, narrative text. The conversation can be in any language; the files, always in English.

## When to use this skill

- Design the initial architecture of a new system using Temporal
- Add modules to an existing Temporal-based project
- Define cross-module workflows (sagas, orchestrated processes)
- Define activities that modules expose for inter-module communication
- Define single-module internal workflows (retries, timeouts, scheduling)
- Review or refactor module structure in a Temporal system
- Generate C4 diagrams for Temporal systems

---

## Core Architecture: Temporal as Orchestration Engine

Temporal replaces **both** Kafka (async messaging) and Feign (sync HTTP) for inter-module communication. The key changes from a broker-based system:

| Concept | Kafka/RabbitMQ System | Temporal System |
|---------|----------------------|-----------------|
| Cross-module communication | Events (async) + Feign (sync) | Remote Activities + Child Workflows |
| Data synchronization | Read Models (local projections) | On-demand reads via Activities |
| Saga / compensation | Manual event choreography | Durable Saga with `compensation:` |
| Fire-and-forget | Publish event + consumer group | `type: async` activity (Async.function) |
| Retry with backoff | Consumer retry config | Activity `retryPolicy:` |
| Timeout handling | TTL + dead letter queue | `Workflow.await()` + timeout |

### Key Principles

1. **No Read Models** — data from other modules is fetched on-demand via Remote Activities of type read (`GetCustomerById`, `GetProductsByIds`). No local projections needed.
2. **No listeners/consumers** — modules don't subscribe to events. Workflows invoke activities directly.
3. **No Feign/HTTP between modules** — `ports:` is only for **external** services (payment gateways, email providers, third-party APIs).
4. **Events use `notifies:`** — Domain Events reference the workflow they trigger, not a topic.
5. **Activities = module capabilities** — each module declares what it can do. Workflows compose these capabilities.
6. **Activities are workflow-only** — handlers, use cases, and REST controllers NEVER invoke activities directly. If a handler needs cross-module data, it emits a Domain Event → triggers a workflow → workflow invokes the required activities. Even local activities are invoked from single-module workflows in `domain.yaml`, not from handlers.

---

## Workflow — complete step sequence

All generated files go inside the `system/` directory at the project root. **NEVER** place files at the project root level.

| Step | Generated file (inside `system/` dir) | Reference |
|------|----------------------------------------|-----------||
| 1 | _(information gathering)_ | This file |
| 2–5 | `system/system.yaml` | This file + `references/temporal-system-yaml-spec.md` |
| 6 | `system/system.md` | `references/temporal-module-spec.md` (system.md section) |
| 6.5 | `system/c4-context.mmd` + `system/c4-container.mmd` | This file (C4 section) |
| 7 | `system/{module}.yaml` (one per module) | `references/temporal-domain-yaml-spec.md` |
| 8 | `system/{module}.md` (one per module) | `references/temporal-module-spec.md` |
| 9a | `AGENTS.md` (project root — rewrite) | This file (Step 9) |
| 9b | `system/VALIDATION_FLOWS.md` | This file (Step 9) |
| 9c | `system/USER_FLOWS.md` | This file (Step 9) |

Execute **all** steps in order before returning control to the user.

---

## Step 1 — Gather information

If the user didn't provide all the data, **ask** before generating:

0. **Business context** — What is the domain? Actors, key processes, important rules.
1. **List of modules** with their responsibility (plural, kebab-case)
2. **Endpoints REST** per module (method + path + use case)
3. **Cross-module flows**: What business events trigger multi-module processes? Which modules participate?
4. **Internal module flows**: Retries, timeouts, scheduling, verification flows?
5. **External services**: Payment gateways, email providers, third-party APIs?
6. **Temporal configuration**: Namespace, target address?

> If `system/system.yaml` already exists, read it and ask only about changes.

Apply the functional role: suggest necessary modules not mentioned, propose coherent workflows, anticipate invariants. Confirm before adding unsolicited elements.

### Decision Matrix: Workflow vs Domain Event

For each business event, ask: **Does something MUST happen in ANOTHER module when this occurs?**

| Answer | Result |
|--------|--------|
| YES — multi-step process, needs consistency | **Cross-module Workflow** (in system.yaml) |
| YES — single effect in one other module | **Simple Workflow** with 1 step (in system.yaml) |
| NO — internal module process needing durability | **Single-module Workflow** (in domain.yaml) |
| NO — nothing external reacts | **Domain Event internal** (no `notifies:`) |

> **⚠️ CRITICAL:** If a handler needs data from another module (e.g., cart handler needs product prices), do NOT invoke the activity directly from the handler. Instead, design a workflow that orchestrates the read activity (e.g., `GetProductsByIds`) and passes the result to subsequent steps. Activities are ONLY invoked from workflows.

### Decision: Activity Type

| Question | Type |
|----------|------|
| Only reads data from this module? | **Read** (`GetXById`, `GetXsByIds`) |
| Modifies data and can be undone? | **Write** + `compensation:` |
| Modifies data irreversibly? | **Write** without compensation |
| Is the reverse of another activity? | **Compensation** (referenced in `compensation:`) |
| Is a non-critical side effect? | **Reactor** (invoked as `type: async`) |
| Is an internal module operation? | **Local** (invoked by module's own workflows) |

---

## Step 2 — Structure of system.yaml

Read `references/temporal-system-yaml-spec.md` for the complete structure, naming conventions, structural restrictions, and useCase patterns.

**Key structure:**

```yaml
system:
  name: project-name
  groupId: com.example
  javaVersion: 21
  springBootVersion: 3.5.5
  database: postgresql

orchestration:
  enabled: true
  engine: temporal
  temporal:
    target: localhost:7233
    namespace: project-name

modules:
  - name: orders
    description: "Order lifecycle management"
    exposes:
      - method: POST
        path: /orders
        useCase: CreateOrder

workflows:
  - name: PlaceOrderWorkflow
    trigger:
      module: orders
      on: create
    taskQueue: ORDER_WORKFLOW_QUEUE
    saga: true
    steps:
      - activity: ReserveStock
        target: inventory
        type: sync
        input: [orderId, items]
        compensation: ReleaseStock
        timeout: 10s
```

---

## Step 3 — Mandatory rules (summary)

| Element | Convention | Example |
|---------|-----------|---------|
| Modules | plural, kebab-case | `orders`, `product-catalog` |
| Workflows | PascalCase + `Workflow` | `PlaceOrderWorkflow` |
| Activities | PascalCase, verb+noun | `ReserveStock`, `GetCustomerById` |
| Task Queues | SCREAMING_SNAKE + suffix | `ORDER_WORKFLOW_QUEUE` |
| Events | PascalCase + past + `Event` | `OrderPlacedEvent` |
| useCases | PascalCase, verb+noun | `CreateOrder`, `ConfirmOrder` |

**Critical restrictions:**
- Cross-module workflows go in `system.yaml`, single-module workflows go in `{domain}.yaml`
- Activities declare what the module **can do**, workflows compose them
- `ports:` only for **external** services (non-Temporal)
- No `listeners:`, no `readModels:`, no `messaging:` section
- Events use `notifies:` to reference workflows, not topics
- All activities accessed ONLY their own module's data
- Activities are invoked ONLY from workflows (`system.yaml` or `domain.yaml`). Handlers and use cases do NOT have access to activity interfaces
- Compensation must be explicitly declared for reversible steps in sagas

---

## Step 4 — Validation checklist

Before proposing the `system.yaml`, verify:

- [ ] Modules in plural kebab-case
- [ ] `orchestration:` section with `engine: temporal`
- [ ] No `messaging:` section (Temporal replaces it)
- [ ] No `integrations:` section (Temporal replaces async and sync)
- [ ] Each workflow has `trigger:` with `module:` and `on:`
- [ ] Each workflow step has `activity:`, `target:`, `type:`, `input:`
- [ ] Saga workflows have `saga: true` and steps with `compensation:` where needed
- [ ] Activities with `type: async` for non-critical steps (fire-and-forget)
- [ ] Activities with `type: sync` for steps that need results
- [ ] Task queues follow module-prefixed naming
- [ ] No workflows that only sync data — use on-demand reads instead
- [ ] No handler or use case directly invokes an activity — all activity calls go through workflows
- [ ] All in English
- [ ] File in `system/system.yaml`
- [ ] Each `modules[].exposes[]` has an HTTP use case planned in `system.md` and `system/{module}.md`
- [ ] Each cross-module `workflows[]` has a technical specification planned in `system.md` and `system/{module}.md`
- [ ] All HTTP Commands declare `Response body: none`
- [ ] All HTTP Queries declare detailed `Response body`
- [ ] All Workflows declare `Trigger`, `Task Queue`, `Steps` with activities and target modules, and expected outcome per step
- [ ] `Exposed Endpoints` used only as index/summary — does not duplicate full contracts
- [ ] All use case parameter details expressed in Markdown tables or `none` when not applicable

---

## Step 5 — Present and continue

> **CRITICAL PATH RULE:** ALL generated files live inside the `system/` directory at the project root.
> NEVER create `system.yaml` at the project root. The correct path is ALWAYS `system/system.yaml`.
> Same for module files: `system/{module}.yaml`, `system/{module}.md`, `system/system.md`, etc.

1. Create the `system/` directory at the project root if it doesn't exist
2. Save the file as `system/system.yaml` (INSIDE the `system/` directory, NOT at the project root)
3. Show the complete YAML
4. Explain non-obvious decisions
5. Mention warnings (coupling, diffuse responsibilities)
6. Proceed immediately to steps 6 → 6.5 → 7 → 8

---

## Step 6 — Create system.md

Read `references/temporal-module-spec.md` (section "system.md structure") for the mandatory structure.

Save as `system/system.md` (inside the `system/` directory). The `system/system.md` is the **narrative technical specification** of the system. One `##` section per module with: detailed role, use cases, endpoints, activities exposed, workflows triggered.

Mandatory rules for `system/system.md`:
- HTTP use cases are the **canonical source** of HTTP contracts.
- Each `HTTP Command` must include within the use case: `Endpoint`, `Path params`, `Query params`, `Request body` and `Response body: none`.
- Each `HTTP Query` must include within the use case: `Endpoint`, `Path params`, `Query params`, `Request body: none` and detailed `Response body`.
- Each `Workflow Trigger` use case must include: `Trigger event`, `Task Queue`, `Steps` (activity + target module + expected result), and `Compensation` when applicable.
- The detail of `Path params`, `Query params`, `Request body`, `Response body`, and workflow `Steps` must be presented in **Markdown tables** to facilitate reading and comparison between use cases.
- The `Exposed Endpoints` section in `system.md` is only a **navigable index/summary** and must never repeat tables, JSON schemas or detailed contracts already defined in `Use Cases`.

---

## Step 6.5 — C4 Diagrams (Context + Container)

Immediately after `system.md`, generate **two Mermaid files** with C4 diagrams:

### `system/c4-context.mmd` — Context Diagram

Shows the system as a **single box** surrounded by actors and external systems.

```mermaid
C4Context
    title System Context diagram for {System Name}

    Person(user, "User", "Primary user who interacts with the system")

    System(system, "{System Name}", "Core platform that manages {domain}")

    System_Ext(paymentGw, "Payment Gateway", "Processes payments")

    Rel(user, system, "Places orders", "HTTPS")
    Rel(system, paymentGw, "Processes payments", "HTTPS")
```

**Rules:**
- System is **one node** — don't decompose into modules here
- `System_Ext()` only for truly external services (from `ports:`)
- Derive actors from who consumes `exposes[]`

### `system/c4-container.mmd` — Container Diagram

Decomposes the system into containers. Key difference from broker-based: **Temporal Server replaces the Message Broker**.

```mermaid
C4Container
    title Container diagram for {System Name}

    Person(user, "User", "Primary user of the system")

    System_Boundary(boundary, "{System Name}") {
        Container(orders, "orders", "Spring Boot Module", "Order lifecycle management")
        Container(payments, "payments", "Spring Boot Module", "Payment processing")

        ContainerDb(db, "Database", "PostgreSQL", "Stores all module data")
        Container(temporal, "Temporal Server", "Temporal", "Durable workflow orchestration")
    }

    System_Ext(paymentGw, "Payment Gateway", "External payment processing")

    Rel(user, orders, "Places orders", "REST/HTTPS")

    Rel(orders, temporal, "Starts", "PlaceOrderWorkflow")
    Rel(temporal, payments, "Invokes", "ProcessOrderPayment")
    Rel(temporal, orders, "Invokes", "ConfirmOrder")

    Rel(orders, db, "Reads/Writes", "JDBC")
    Rel(payments, db, "Reads/Writes", "JDBC")

    Rel(payments, paymentGw, "Charges", "HTTPS")
```

**Rules for Temporal Container diagram:**
- `Container(temporal, "Temporal Server", "Temporal", "Durable workflow orchestration")` — always inside the boundary
- Workflow arrows: `module → temporal` with "Starts" + workflow name
- Activity arrows: `temporal → module` with "Invokes" + activity name
- Direct arrows between modules are **forbidden** — all communication flows through Temporal
- `ports:` (external services) are direct arrows from module to `System_Ext()`
- No `ContainerQueue` — Temporal replaces the message broker

---

## Step 7 — Create domain.yaml per module

Read `references/temporal-domain-yaml-spec.md` for the complete specification.

For each module in `modules:`, generate `system/{module-name}.yaml` (**inside the `system/` directory**, e.g., `system/orders.yaml`, `system/payments.yaml`) with: aggregates, entities, valueObjects, enums (with transitions if applicable), events (with `notifies:` if applicable), activities, single-module workflows, endpoints, and ports (only for external services).

### Endpoints in multi-aggregate modules

If the module has **2 or more aggregates** (e.g., `Product` + `Category`), the `endpoints:` section must use `basePath: ""` (empty string) and **absolute** paths per operation:

```yaml
# Module with 2+ aggregates → empty basePath
endpoints:
  basePath: ""
  versions:
    - version: v1
      operations:
        - useCase: CreateProduct
          method: POST
          path: /products
        - useCase: CreateCategory
          method: POST
          path: /categories
```

If the module has **a single aggregate**, use `basePath: /resource` with relative paths (e.g., `/`, `/{id}`).

**NEVER use `basePath: /`** (with slash) — it produces a trailing slash in `@RequestMapping`. Use `basePath: ""` (empty).

### Key differences from broker-based domain.yaml

| Section | Broker-based | Temporal-based |
|---------|-------------|----------------|
| `events:` | `triggers:` / `lifecycle:` + `topic:` | `triggers:` / `lifecycle:` + `notifies:` (no topic) |
| `listeners:` | Present — Kafka consumers | **ABSENT** — Temporal replaces this |
| `readModels:` | Present — local projections | **ABSENT** — on-demand reads via activities |
| `ports:` | Internal + external HTTP calls | **Only external** services (non-Temporal) |
| `activities:` | Not present | **NEW** — module capabilities |
| `workflows:` | Not present | **NEW** — single-module internal flows |

### Activities section in domain.yaml

Each module declares its capabilities as activities:

```yaml
activities:
  - name: GetCustomerById
    type: light                     # light (<30s) | heavy (up to 2min)
    description: "Gets a customer by ID"
    input:
      - name: customerId
        type: String
    output:
      - name: customerId
        type: String
      - name: firstName
        type: String
      - name: email
        type: String
    timeout: 5s

  - name: ReserveStock
    type: light
    description: "Reserves stock for an order"
    input:
      - name: orderId
        type: String
      - name: items
        type: List<OrderItemDetail>
    output:
      - name: success
        type: Boolean
    externalTypes:
      - name: OrderItemDetail
        module: orders
    timeout: 10s
    compensation: ReleaseStock
```

### Workflows section in domain.yaml (single-module only)

```yaml
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
```

### Events with `notifies:`

```yaml
events:
  - name: OrderPlacedEvent
    lifecycle: create
    fields:
      - name: orderId
        type: String
    notifies:
      - workflow: PlaceOrderWorkflow    # cross-module workflow in system.yaml

  - name: CustomerUpdatedEvent
    lifecycle: update
    fields:
      - name: customerId
        type: String
    # NO notifies → Domain Event internal (no cross-module effect)
```

---

## Step 8 — Create technical specification per module

Read `references/temporal-module-spec.md` for the mandatory structure.

For each module, generate `system/{module-name}.md` (**inside the `system/` directory**, e.g., `system/orders.md`, `system/payments.md`) with: module role, invariants, state machine, interaction diagram, sequence diagram, use cases, endpoints, activities exposed, and workflows.

### Key differences in module specs for Temporal

- **Activities Exposed** section replaces "Emitted Events" and "Ports"
- **Workflows Triggered** section describes what workflows each event triggers
- **Interaction diagrams** show workflow invocations instead of event flows
- **Sequence diagrams** show activity invocations through Temporal

Mandatory rules for `system/{module}.md`:
- `Use Cases` are the **single source of truth** for HTTP contracts.
- Each endpoint defined in `system.yaml → modules[].exposes[]` must map to exactly one use case of type `HTTP Command` or `HTTP Query` in the corresponding module.
- Each cross-module workflow where this module is the trigger must map to exactly one use case of type `Workflow Trigger`.
- The parameter detail of each use case must be presented in **Markdown tables** within the use case itself. Only `none` is allowed when the section does not apply.
- `Exposed Endpoints` must function as a navigable index: `Use case`, `Purpose` and reference to the contract embedded in the use case. It must not duplicate `Path params`, `Query params`, `Request body`, `Response body` or activity tables.
- If an HTTP use case does not declare `Endpoint`, `Path params`, `Query params` and `Request body`, the generation is incomplete.

---

## Anti-patterns to avoid

### Do NOT create data-sync workflows

```yaml
# ❌ DON'T — workflow that only syncs data
- name: CustomerUpdatedWorkflow
  steps:
    - activity: SyncCustomerReadModel

# ✅ DO — on-demand read in the workflow that needs the data
# PlaceOrderWorkflow → GetCustomerById → customers
```

### Do NOT make activities do cross-module lookups

```yaml
# ❌ DON'T — activity internally queries another module's DB
activities:
  - name: NotifyOrderPlaced
    input: [orderId, customerId]
    # Internally: fetch customer data → HIDDEN COUPLING

# ✅ DO — workflow assembles data and passes it
activities:
  - name: NotifyOrderPlaced
    input: [orderId, customerEmail, customerName, totalAmount]
```

### Do NOT put cross-module orchestration in domain.yaml

```yaml
# ❌ DON'T — saga in module YAML
# orders.yaml
saga:
  workflow: PlaceOrderWorkflow

# ✅ DO — cross-module orchestration in system.yaml
# The domain.yaml only declares the event with notifies:
```

### Do NOT use `notifies:` for events without cross-module effects

```yaml
# ❌ DON'T
events:
  - name: CustomerUpdatedEvent
    notifies:
      - workflow: CustomerUpdatedWorkflow  # only syncs data

# ✅ DO — Domain Event internal
events:
  - name: CustomerUpdatedEvent
    # NO notifies
```

### Do NOT forget `compensation:` in saga activities

```yaml
# ❌ DON'T — no compensation in saga
steps:
  - activity: ReserveStock              # what if payment fails?

# ✅ DO
steps:
  - activity: ReserveStock
    compensation: ReleaseStock
```

### Do NOT invoke activities directly from handlers or use cases

Activities are Temporal constructs — they can ONLY be invoked from within a workflow execution context. Handlers and use cases interact with their own module's repository and domain entities, and trigger workflows via Domain Events. They never call activity interfaces.

```java
// ❌ DON'T — handler injecting an activity to get cross-module data
public class AddToCartCommandHandler {
    private final ProductActivity productActivity; // ❌ WRONG

    public void handle(AddToCartCommand cmd) {
        // ❌ Activity invoked outside a workflow — will fail at runtime
        var product = productActivity.GetProductById(cmd.productId());
        cart.addItem(product.name(), product.price());
        repository.save(cart);
    }
}

// ✅ DO — handler persists + emits event → workflow orchestrates activities
public class AddToCartCommandHandler {
    public void handle(AddToCartCommand cmd) {
        cart.addItem(cmd.productId(), cmd.quantity());
        repository.save(cart);  // Domain Event triggers AddToCartWorkflow
    }
}

// ✅ Workflow invokes the activity through Temporal
public class AddToCartWorkflowImpl implements AddToCartWorkflow {
    private final ProductActivity productActivity; // ✅ Temporal stub

    public void execute(String cartId, String productId) {
        var product = productActivity.GetProductById(productId); // ✅ CORRECT
        var enrichment = cartActivity.EnrichCartItem(cartId, product);
    }
}
```

**Rule:** If a handler needs data from another module, design a workflow that reads the data via an activity and then acts on it. The handler's job is to persist domain state and emit events that trigger workflows.

---

## Step 9 — Post-design artifacts

Immediately after completing Step 8, generate three final artifacts that contextualize the newly designed system.

### Step 9a — Rewrite AGENTS.md (project-specific)

Rewrite the `AGENTS.md` file at the **project root** with content specific to the designed system.

**Process:**

1. Read the current `AGENTS.md` as a base template
2. Analyze `system/system.yaml` and all `system/{module}.yaml` to detect which features are used:
   - Temporal orchestration (always true for this skill)
   - `activities:` section with types (light/heavy, compensation)
   - `workflows:` section (single-module internal workflows)
   - Events with `notifies:` (cross-module workflow triggers)
   - `ports:` (external services only — not internal HTTP)
   - `hasSoftDelete` on any entity
   - `audit.trackUser` on any entity
   - Value Objects with `methods:`
   - Enums with `transitions:` and `initialValue`
   - Field flags: `readOnly`, `hidden`, `defaultValue`, `validations`, `reference`
3. **Prune** sections about unused features:

| Condition | Section to remove |
|---|---|
| Temporal system (always) | Kafka/RabbitMQ messaging sections, `listeners:`, `readModels:` |
| No `ports:` for external services | Ports/Feign subsections |
| No `hasSoftDelete` | Soft delete section and checklist items |
| No `audit.trackUser` | UserContextFilter/UserContextHolder/AuditorAwareImpl infrastructure (keep basic audit if `audit.enabled`) |
| No VO `methods:` | "Value Objects with Methods" subsection |
| No enum `transitions:` | "Enums with Lifecycle" subsection |

4. **Add Temporal-specific content** (always):
   - Activities section: light/heavy types, compensation pattern, input/output
   - Workflows section: cross-module (system.yaml) vs single-module (domain.yaml)
   - `notifies:` pattern in events (replaces `topic:`)
   - Activity as collaboration mechanism (replaces events/listeners)
5. **Specialize** remaining content:
   - Replace generic examples (`User`, `Order`) with actual project entities/modules
   - Update `eva` command examples with real module names
   - Update `domain.yaml` example with actual project structure
   - Reduce checklist to only relevant items for this project
6. Add a **project context header** at the top:

```markdown
# AI Agent Guide — {System Name}

## Project Overview
- **System:** {name} — {brief description from system.yaml}
- **Modules:** {list of modules with 1-line descriptions}
- **Orchestration:** Temporal ({namespace}, {target address})
- **Database:** {database type}
- **Java:** {javaVersion} / **Spring Boot:** {springBootVersion}
```

7. **Always keep** (universal): DDD principles, hexagonal architecture, mapper rules, DTO rules, data flow diagrams (Command write / Query read), testing patterns
8. Write **everything in English**
9. **Limit: ≤ 1000 lines** — prune aggressively, compress examples, avoid redundancy

---

### Step 9b — Create system/VALIDATION_FLOWS.md

Generate `system/VALIDATION_FLOWS.md` with technical validation flows for the system. All information is derived from `system.yaml` and the `{module}.yaml` files.

**Mandatory structure:**

```markdown
# Validation Flows — {System Name}

## Prerequisites
- Services: {required infrastructure — DB, Temporal Server, external services}
- Temporal: namespace={namespace}, target={address}
- Startup order: {if relevant}
- Base URLs: {per module if different}

## 1. Module Validation

### 1.1 {Module Name}

#### CRUD Operations
| # | Operation | Endpoint | Payload/Params | Expected Result | Validates |
|---|-----------|----------|----------------|-----------------|-----------||
| 1 | Create | POST /x | {key fields} | 201 + entity | {invariant} |
| 2 | Get by ID | GET /x/{id} | — | 200 + entity | — |
| 3 | List | GET /x | — | 200 + page | — |
| 4 | Update | PUT /x/{id} | {fields} | 200 + updated | — |
| 5 | Delete | DELETE /x/{id} | — | 204 | — |

#### State Transitions (if module has enum transitions)
| # | Transition | Endpoint | Precondition | Expected | Event / Workflow Triggered |
|---|-----------|----------|--------------|----------|----------------------------|
| 1 | DRAFT→PUBLISHED | PUT /x/{id}/publish | exists in DRAFT | 200, status=PUBLISHED | XPublishedEvent → PlaceXWorkflow |

#### Business Rules
| # | Rule | How to Trigger | Expected Error |
|---|------|----------------|----------------|

(repeat per module)

## 2. Workflow Validation

### 2.1 {WorkflowName}
**Trigger:** {event} from {module}
**Saga:** {yes/no}
**Task Queue:** {QUEUE_NAME}
**Steps:**
1. Activity: {ActivityName} → {target module} — expected: {result}
2. Activity: {ActivityName} → {target module} — expected: {result}
**Compensation (if saga fails at step N):**
- Step N-1: {CompensationActivity} reverses {what}
**Verify:**
- {expected final state in each affected module}

(repeat per cross-module workflow)

## 3. On-Demand Read Validation (if read activities exist)
### 3.1 {ReadActivityName}: {caller workflow} → {target module}
| Input | Expected Output | Error Case |
|---|---|---|
| valid ID | entity data returned | 404 → workflow handles gracefully |

## 4. External Service Calls (if ports exist)
### 4.1 {PortName}: {module} → {external service}
| Method | Expected | Fallback |
|---|---|---|

## 5. Error & Edge Cases
| # | Scenario | Steps | Expected Error |
|---|----------|-------|----------------|
| 1 | Create with missing required field | POST /x without {field} | 400 + validation message |
| 2 | Invalid state transition | PUT /x/{id}/action when invalid state | 400/409 + business error |
| 3 | Saga compensation on failure | Trigger workflow, fail at step N | Previous steps compensated |
| 4 | Activity timeout | Simulate slow activity | Temporal retries per retryPolicy |
```

**Rules:**
- Each flow must be concrete: real paths, real event names, real workflow/activity names from the project
- Include suggested JSON payloads where useful
- Omit entire sections if not applicable (e.g., no ports → omit section 4)
- Everything in English

---

### Step 9c — Create system/USER_FLOWS.md

Generate `system/USER_FLOWS.md` with end-to-end flows from the user’s perspective.

**Mandatory structure:**

```markdown
# User Flows — {System Name}

## Actors
| Actor | Description | Modules Interacted |
|-------|-------------|--------------------|
| {Actor 1} | {role description} | {module list} |

## Flow 1: {Business Process Name}
**Actor:** {who}
**Goal:** {what they want to achieve}
**Preconditions:** {initial state}

### Happy Path
| Step | User Action | System Response | Behind the Scenes |
|------|-------------|-----------------|-------------------|
| 1 | {does X} | {sees Y} | {endpoint called, workflow started, activities invoked} |
| 2 | {does Z} | {sees W} | {activity completes, state changes} |

### Alternative Paths
| Condition | At Step | What Happens |
|-----------|---------|---------- ---|
| {condition} | {N} | {alternative outcome} |

### Error Paths
| Error | At Step | User Sees |
|-------|---------|----------|
| {error} | {N} | {error message/behavior, saga rollback visible effect} |

(repeat per major business flow)
```

**Rules:**
- Derive actors from who consumes the `exposes[]` endpoints (same source as C4 Context `Person()` nodes)
- Each flow is a **complete business scenario** crossing modules where applicable
- "Behind the Scenes" column references **workflows and activities** instead of events and topics
- Saga compensation reflected as **user-observable rollback behavior** (e.g., "Payment reversed, stock released")
- Include at least one flow per major use case path through the system
- Focus on user-observable behavior, not internal implementation
- Everything in English

---

## Refinement cycle

After delivering v1, if the user requests adjustments:
- Apply the **minimum change** necessary
- Revalidate the checklist from Step 4
- Update `system.md`, `c4-context.mmd`, `c4-container.mmd`, `{module}.yaml` and `{module}.md` affected
- Update `AGENTS.md`, `VALIDATION_FLOWS.md` and `USER_FLOWS.md` if affected by the change
- Deliver only the explained diff
