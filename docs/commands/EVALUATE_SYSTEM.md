# Command `evaluate system`

---

## Table of Contents

1. [Description and purpose](#1-description-and-purpose)
2. [Syntax and options](#2-syntax-and-options)
3. [system.yaml structure required](#3-systemyaml-structure-required)
4. [system.yaml evaluation criteria (S1–S5)](#4-systemyaml-evaluation-criteria-s1s5)
   - [S1 — Module integrity](#s1--module-integrity)
   - [S2 — Async event graph integrity](#s2--async-event-graph-integrity)
   - [S3 — Sync call integrity](#s3--sync-call-integrity)
   - [S4 — Endpoint coherence](#s4--endpoint-coherence)
   - [S5 — Global system coherence](#s5--global-system-coherence)
5. [Domain evaluation criteria (C1–C4) — `--domain`](#5-domain-evaluation-criteria-c1c4----domain)
   - [C1 — Kafka event contracts](#c1--kafka-event-contracts)
   - [C2 — Behavior gaps](#c2--behavior-gaps)
   - [C3 — Cross-reference integrity](#c3--cross-reference-integrity)
   - [C4 — Audit & traceability](#c4--audit--traceability)
6. [Score calculation](#6-score-calculation)
7. [Report output](#7-report-output)
8. [Practical examples with real findings](#8-practical-examples-with-real-findings)
9. [Common errors and how to fix them](#9-common-errors-and-how-to-fix-them)

---

## 1. Description and purpose

`evaluate system` statically analyzes a `system.yaml` file to detect architectural problems in a microservices design **before writing a single line of Java code**.

The command is domain-agnostic: it works for any system described in `system.yaml`, whether it's a cinema booking platform, an e-commerce system, a fintech application, or any other domain.

**What it produces:**

- A **quality score** (0–100%) based on checks passed vs. total
- A list of **critical errors** (broken references, self-loops, duplicate routes)
- A list of **warnings** (potential design problems that aren't necessarily wrong)
- A list of **info notes** (observations that do not affect the score)
- A list of **passed validations** (proof that good practices are in place)
- An **interactive HTML report** served on a local HTTP server
- A **`assets/system-evaluation.md`** file with only errors and warnings for quick review

The HTML report contains four interactive tabs:

| Tab | Contents |
|-----|----------|
| **Validación** | Score cards, collapsible sections for errors / warnings / info / passed |
| **Simulador de flujos** | Step-by-step playback of each async event flow |
| **Arquitectura** | Module dependency explorer, sync dependency cards, Kafka topic map, interactive network diagram |
| **Dominio** | Per-module Mermaid diagrams (only with `--domain` flag) |

---

## 2. Syntax and options

```bash
eva evaluate system
eva evaluate system --port 8080              # serve the report on a custom port (default: 3000)
eva evaluate system --output ./report.html   # write HTML to a custom path
eva evaluate system --domain                 # also validate domain.yaml files in system/
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--port <n>` | `3000` | Port for the local HTTP preview server |
| `--output <path>` | `./system-report.html` | Where to write the generated HTML file |
| `--domain` | off | Also load and cross-validate domain YAML files from `system/` |

### Requirements

- Must be run from a directory containing a `system/system.yaml` file
- No eva4j project scaffold is required — `system.yaml` can be a standalone design file

---

## 3. system.yaml structure required

The minimal structure the evaluator expects:

```yaml
system:
  name: my-system           # used as report title

messaging:
  enabled: true
  broker: kafka
  kafka:
    topicPrefix: myapp      # used by S2-007 topic prefix check

modules:
  - name: orders            # unique module identifier
    description: "..."      # required by S1-003
    exposes:                # REST endpoints this module offers
      - method: POST
        path: /orders
        useCase: CreateOrder
        description: "..."      # required by S4-004
      - method: GET
        path: /orders/{id}
        useCase: GetOrder
        description: "..."

integrations:
  async:
    - event: OrderCreatedEvent    # must follow PascalCase + Event suffix (S2-006)
      producer: orders
      topic: ORDER_CREATED
      consumers:
        - module: payments
          useCase: HandleOrderCreated
        - module: notifications
          useCase: NotifyOrderCreated

  sync:
    - caller: payments
      calls: orders
      port: OrderService
      using:
        - GET /orders/{id}        # must exist in orders.exposes[] (S3-002)
```

All fields are optional except `modules[].name`. The evaluator gracefully handles missing sections.

---

## 4. system.yaml evaluation criteria (S1–S5)

These rules evaluate **only** `system.yaml`. For the domain-level criteria applied when using `--domain`, see [section 5](#5-domain-evaluation-criteria-c1c4----domain).

The evaluator runs **5 rule groups (S1–S5)** with a total of **20 rules** across three severity levels:

| Severity | Symbol | Affects score | Description |
|----------|--------|--------------|-------------|
| **error** | 🔴 | Yes (counts as 1) | Must be fixed |
| **warning** | 🟡 | Yes (counts as 0.5) | Should be reviewed |
| **info** | 🔵 | No | Observation only |

---

### S1 — Module integrity

Verifies that all modules declared in `modules[]` have defined responsibilities and all modules referenced in `integrations` are declared.

| Rule | Severity | Description |
|------|----------|-------------|
| S1-001 | 🔴 error | Module referenced in `integrations` but not declared in `modules[]` |
| S1-002 | 🔴 error | Module with no responsibilities — no exposes, no events produced or consumed |
| S1-003 | 🟡 warning | Module without a `description` field |
| S1-004 | 🟡 warning | Purely reactive module (only consumes events) not documented explicitly in its description |

#### S1-001 — Undeclared module referenced in integrations

Covers producers, consumers, sync callers, and sync callees.

```yaml
# ❌ ERROR — 'billing' is not declared in modules[]
- event: InvoiceCreatedEvent
  producer: billing
```

**Message:** `[S1-001] Módulo 'billing' referenciado en integrations pero no declarado en modules[]`

**Fix:** Add the missing module to `modules[]` or correct the name typo.

#### S1-002 — Module with no responsibilities

A module that doesn't expose endpoints, doesn't produce events, and doesn't consume events serves no purpose in the design.

**Message:** `[S1-002] Módulo 'reporting' no tiene ninguna responsabilidad — no expone endpoints, no produce ni consume eventos`

**Fix:** Add endpoints to `exposes[]`, connect it to an async event, or remove the module.

#### S1-003 — Module without description

**Message:** `[S1-003] Módulo 'payments' no tiene campo description declarado`

**Fix:** Add a `description` field summarizing the module's responsibility.

#### S1-004 — Purely reactive module not documented

A module that only consumes events (no REST endpoints, no events produced) should say so explicitly in its description.

**Message:** `[S1-004] Módulo 'notifications' es puramente reactivo (solo consume eventos) pero su description no lo documenta explícitamente`

**Fix:** Add words like "consumes", "reacts to", or "event-driven" to the description.

---

### S2 — Async event graph integrity

Verifies that the producer → consumer graph declared in `integrations.async` is coherent: no orphan events, no topic collisions, no self-loops.

| Rule | Severity | Description |
|------|----------|-------------|
| S2-001 | 🔴 error | Event declared in `integrations.async` with no consumers |
| S2-002 | 🔴 error | Same `topic` value declared for two different events |
| S2-003 | 🔴 error | Module listed as consumer of its own event (self-loop) |
| S2-004 | 🟡 warning | Module that produces events but consumes none |
| S2-005 | 🟡 warning | Module that consumes events but produces none |
| S2-006 | 🟡 warning | Event name not following PascalCase + `Event` suffix convention |
| S2-007 | 🔵 info | Topic name does not include the prefix declared in `messaging.kafka.topicPrefix` |

#### S2-001 — Event with no consumers

```yaml
# ❌ ERROR — no consumers declared
- event: OrderShippedEvent
  producer: shipping
  topic: ORDER_SHIPPED
  consumers: []
```

**Message:** `[S2-001] Evento 'OrderShippedEvent' declarado en integrations.async sin consumidores`

#### S2-002 — Duplicate topic value

```yaml
# ❌ ERROR — both events share the same topic
- event: OrderCreatedEvent
  topic: ORDER_EVENTS
- event: OrderCancelledEvent
  topic: ORDER_EVENTS   # ← collision
```

**Message:** `[S2-002] Topic 'ORDER_EVENTS' está declarado para dos eventos distintos: 'OrderCreatedEvent' y 'OrderCancelledEvent'`

#### S2-003 — Self-loop (module consuming its own event)

```yaml
# ❌ ERROR — orders producing AND consuming its own event
- event: OrderCreatedEvent
  producer: orders
  consumers:
    - module: orders   # ← self-loop
```

**Message:** `[S2-003] Módulo 'orders' está listado como consumidor de su propio evento 'OrderCreatedEvent' (self-loop)`

#### S2-004/S2-005 — Unbalanced producer/consumer roles

- `[S2-004]` — Module produces events but never consumes any (may be intentional)
- `[S2-005]` — Module consumes events but never produces any (may be intentional for sinks like notifications)

#### S2-006 — Event name convention

Event names must follow `PascalCase` with an `Event` suffix.

**Examples of violations:** `orderCreated`, `ORDER_CREATED`, `OrderCreated` (missing `Event`), `Order_Created_Event`

**Message:** `[S2-006] Nombre de evento 'orderCreated' no sigue la convención PascalCase con sufijo 'Event'`

#### S2-007 — Topic without configured prefix (info)

When `messaging.kafka.topicPrefix` is declared, every topic name should include it for consistency.

**Message:** `[S2-007] Topic 'ORDER_CREATED' (evento 'OrderCreatedEvent') no incluye el prefijo configurado 'myapp'`

---

### S3 — Sync call integrity

Verifies that all synchronous dependencies declared in `integrations.sync` reference existing modules and endpoints, and do not generate circular or excessive coupling.

| Rule | Severity | Description |
|------|----------|-------------|
| S3-001 | 🔴 error | Sync call to a module that declares no `exposes[]` |
| S3-002 | 🔴 error | Path in `sync[].using[]` does not exist in target module's `exposes[]` |
| S3-003 | 🟡 warning | Bidirectional sync coupling — A calls B and B calls A |
| S3-004 | 🟡 warning | Module with more than 3 distinct outgoing sync dependencies |
| S3-005 | 🔵 info | Module consulted synchronously but emits no events when its state changes |

#### S3-001 — Sync call to module without endpoints

```yaml
# ❌ ERROR — 'notifications' has no exposes[]
sync:
  - caller: orders
    calls: notifications
    using:
      - POST /notifications
```

**Message:** `[S3-001] 'orders' llama síncronamente a 'notifications' pero este módulo no declara exposes[]`

#### S3-002 — Endpoint not declared in target module

```yaml
sync:
  - caller: payments
    calls: orders
    using:
      - GET /orders/{id}/items   # ❌ not in orders.exposes[]
```

**Message:** `[S3-002] Endpoint 'GET /orders/{id}/items' usado por 'payments' no está declarado en exposes[] de 'orders'`

**Fix:** Add the endpoint to `orders.exposes[]` or remove it from `using[]`.

#### S3-003 — Bidirectional sync coupling

```yaml
# ❌ WARNING — A↔B mutual sync dependency
sync:
  - caller: orders
    calls: inventory
  - caller: inventory
    calls: orders
```

**Message:** `[S3-003] Acoplamiento síncrono bidireccional: 'orders' llama a 'inventory' y viceversa`

**Fix:** Replace one direction with an async event, or extract the shared data into a third read-model module.

#### S3-004 — Too many outgoing sync dependencies

A module calling more than 3 distinct modules synchronously is tightly coupled and fragile under partial failures.

**Message:** `[S3-004] Módulo 'reservations' tiene 4 dependencias síncronas salientes distintas (>3): screenings, customers, payments, inventory`

#### S3-005 — Module consulted synchronously but emits no events (info)

When other modules depend synchronously on a module but that module never publishes events, downstream consumers have no way to react to its state changes.

**Message:** `[S3-005] Módulo 'movies' es consultado síncronamente pero no emite ningún evento cuando su estado cambia`

---

### S4 — Endpoint coherence

Verifies that endpoints declared in `modules[].exposes[]` are internally coherent: no route collisions, complete operation pairs, minimal documentation.

| Rule | Severity | Description |
|------|----------|-------------|
| S4-001 | 🔴 error | Two endpoints with the same HTTP method and path in the same module |
| S4-002 | 🟡 warning | Module with `PUT /{id}` but no `GET /{id}` for the same resource |
| S4-003 | 🟡 warning | `DELETE` endpoint exposed without a description indicating physical vs. logical deletion |
| S4-004 | 🔵 info | Endpoint without a `description` field |
| S4-005 | 🔵 info | Module with a `POST` creation endpoint but no `GET /{id}` to retrieve the created resource |

#### S4-001 — Duplicate route

```yaml
exposes:
  - method: GET
    path: /orders/{id}
    useCase: GetOrder
  - method: GET
    path: /orders/{id}   # ❌ duplicate
    useCase: GetOrderDetail
```

**Message:** `[S4-001] Módulo 'orders' tiene dos endpoints con el mismo método y path: GET /orders/{id}`

#### S4-002 — PUT without GET for same resource

```yaml
exposes:
  - method: PUT
    path: /orders/{id}
    useCase: UpdateOrder
  # ❌ no GET /orders/{id} declared
```

**Message:** `[S4-002] Módulo 'orders' tiene PUT /orders/{id} sin el correspondiente GET /orders/{id}`

#### S4-003 — DELETE without description

```yaml
exposes:
  - method: DELETE
    path: /products/{id}
    useCase: DeleteProduct
    # ❌ no description — is this physical or soft delete?
```

**Message:** `[S4-003] Endpoint DELETE /products/{id} en 'products' no tiene description que indique si el borrado es físico o lógico`

**Fix:** Add a description: `"Eliminación lógica: marca el producto como inactivo (soft delete)"` or `"Eliminación física del registro de base de datos"`.

#### S4-004 — Endpoint without description (info)

**Message:** `[S4-004] Endpoint POST /orders en 'orders' no tiene campo description`

#### S4-005 — POST without GET /{id} (info)

**Message:** `[S4-005] Módulo 'shipments' tiene POST de creación pero no declara GET /{id} para recuperar el recurso creado`

---

### S5 — Global system coherence

Verifies properties that can only be evaluated by observing the entire system: contradictions between configuration and declarations, flows without failure coverage, and disconnected modules.

| Rule | Severity | Description |
|------|----------|-------------|
| S5-001 | 🟡 warning | `messaging.enabled: false` with async events declared in `integrations.async` |
| S5-002 | 🟡 warning | Critical business flow with a success event but no corresponding failure event for compensation |
| S5-003 | 🔵 info | Module handling authentication with no declared integration with any other module |
| S5-004 | 🔵 info | Module with no connection to the system graph — neither async nor sync |

#### S5-001 — Messaging disabled but events declared

```yaml
messaging:
  enabled: false    # ❌ contradicts async events below

integrations:
  async:
    - event: OrderCreatedEvent
      …
```

**Message:** `[S5-001] messaging.enabled está en false pero hay 3 eventos declarados en integrations.async`

#### S5-002 — Success event without matching failure event

When a flow has a success event (`*ConfirmedEvent`, `*ApprovedEvent`, `*PlacedEvent`, `*CompletedEvent`), there should be a failure/compensation event for the same subject so consumers can react to the unhappy path.

```yaml
# ⚠️ WARNING — success exists but no failure counterpart
- event: PaymentApprovedEvent    # ✅ success
  producer: payments
  …
# If PaymentRejectedEvent or PaymentFailedEvent were missing → S5-002 fires
```

**Message:** `[S5-002] Evento de éxito 'PaymentApprovedEvent' existe pero no hay un evento de fallo correspondiente para el sujeto 'payment' que permita compensación`

#### S5-003 — Auth module without integrations (info)

Modules whose names match `auth`, `security`, `identity`, or `session` that have no declared integrations may be siloed or forgotten.

**Message:** `[S5-003] Módulo 'auth' parece manejar autenticación/seguridad pero no tiene ninguna integración declarada con otros módulos`

#### S5-004 — Isolated module (info)

A module with no async events (produced or consumed) and no sync calls (as caller or callee) is completely disconnected from the system graph.

**Message:** `[S5-004] Módulo 'reporting' no tiene ninguna conexión al grafo del sistema — ni async ni sync`

---

## 5. Domain evaluation criteria (--domain)

When `--domain` is passed, the evaluator additionally loads a `domain.yaml` file from each module subdirectory under `system/` and cross-validates them against each other and against `system.yaml`.

**Requirements:**
- Each module subdirectory under `system/` must contain a `domain.yaml` file to be included
- Modules without a `domain.yaml` are silently skipped — their rules will not fire
- Domain findings appear in the **Dominio** tab of the HTML report

Domain rules are organized in **4 rule groups (C1–C4)** with a total of **19 rules**:

| Severity | Symbol | Affects score | Description |
|----------|--------|--------------|-------------|
| **error** | 🔴 | Yes (counts as 1) | Must be fixed |
| **warning** | 🟡 | Yes (counts as 0.5) | Should be reviewed |
| **info** | 🔵 | No | Observation only |

---

### C1 — Kafka event contracts

Verifies that the producer → consumer graph is coherent at the code level: events declared in `domain.yaml` match what `system.yaml` declares, and field-level contracts are consistent between producers and consumers.

| Rule | Severity | Description |
|------|----------|-------------|
| C1-001 | 🟡 warning | Domain event produced by a module but has no consumers registered in `system.yaml` |
| C1-002 | 🔴 error | `listeners[]` references an event that no domain module produces |
| C1-003 | 🔴 error | Field in `listener.fields` does not exist in the producer event |
| C1-004 | 🔴 error | Field exists in both producer and consumer but with incompatible types |
| C1-005 | 🔴 error | `system.yaml` registers a module as consumer but that module has no matching `listener` or `readModels[].syncedBy` |
| C1-006 | 🔴 error | `listener.producer` references the wrong producer module |

#### C1-001 — Produced event with no consumers in system.yaml

```yaml
# orders/domain.yaml
aggregates:
  - name: Order
    events:
      - name: OrderConfirmed   # ⚠️ WARNING — not registered in system.yaml
        fields: [...]
```

**Message:** `[C1-001] El evento 'OrderConfirmed' no tiene consumidores registrados en system.yaml`

**Fix:** Add the event to `integrations.async` in `system.yaml` with at least one consumer, or remove it from `domain.yaml` if unused.

#### C1-002 — Listener references event no module produces

```yaml
# notifications/domain.yaml
listeners:
  - event: StockDepletedEvent   # ❌ ERROR — no domain.yaml in the system produces this
    producer: inventory
```

**Message:** `[C1-002] Listener de 'StockDepletedEvent' pero ningún módulo en los domain.yaml lo produce`

**Fix:** Declare `StockDepletedEvent` in the `inventory` module's `domain.yaml`, or correct the event name.

#### C1-003 — Field in listener missing in producer event

```yaml
# Producer (payments/domain.yaml):
events:
  - name: PaymentApprovedEvent
    fields:
      - { name: paymentId, type: String }

# Consumer (reservations/domain.yaml):
listeners:
  - event: PaymentApprovedEvent
    fields:
      - { name: approvedAt, type: LocalDateTime }  # ❌ ERROR — not in producer
```

**Message:** `[C1-003] Campo 'approvedAt' en listener de 'PaymentApprovedEvent' no existe en los campos del evento del productor (payments)`

**Fix:** Remove the field from the listener, or add it to the producer event declaration.

#### C1-004 — Incompatible field types between producer and consumer

```yaml
# Producer declares:  amount: BigDecimal
# Consumer declares:  amount: String     # ❌ ERROR
```

**Message:** `[C1-004] Campo 'amount' en listener de 'PaymentApprovedEvent': tipo incompatible — Productor declara 'BigDecimal', listener declara 'String'`

**Fix:** Align the field type in the listener with the type declared in the producer event.

#### C1-005 — Registered consumer has no listener or readModel.syncedBy in domain.yaml

For `useCase:` consumers, the module must have a matching `listeners[]` entry:

```yaml
# system.yaml registers notifications as consumer:
consumers:
  - module: notifications
    useCase: NotifyOrderCreated
# notifications/domain.yaml has no listeners[] for OrderCreatedEvent  ❌ ERROR
```

**Message:** `[C1-005] system.yaml registra 'notifications' como consumidor de 'OrderCreatedEvent' pero el módulo no tiene listener declarado`

**Fix:** Add a `listeners[]` entry for `OrderCreatedEvent` in `notifications/domain.yaml`.

For `readModel:` consumers, the module must have a matching `readModels[].syncedBy[]` entry:

```yaml
# system.yaml registers orders as readModel consumer:
consumers:
  - module: orders
    readModel: ProductReadModel
# orders/domain.yaml must have readModels[].syncedBy[].event matching the event
```

**Message:** `[C1-005] system.yaml registra 'orders' como consumidor readModel de 'ProductCreatedEvent' pero el módulo no tiene readModels[].syncedBy con ese evento`

**Fix:** Add a `readModels[]` entry with a `syncedBy[]` entry for the event in the consumer module's `domain.yaml`.

#### C1-006 — listener.producer references wrong module

```yaml
listeners:
  - event: PaymentApprovedEvent
    producer: orders   # ❌ ERROR — this event is actually produced by 'payments'
```

**Message:** `[C1-006] Listener declara producer: 'orders' pero 'PaymentApprovedEvent' es producido por 'payments'`

**Fix:** Update `producer:` to match the actual producing module.

---

### C2 — Behavior gaps

Verifies that every transition method and every use case has a traceable activation mechanism — either an HTTP endpoint or an async listener — ensuring no business behavior is accidentally unreachable.

| Rule | Severity | Description |
|------|----------|-------------|
| C2-001 | 🟡 warning | Transition method with no matching HTTP endpoint or listener |
| C2-002 | 🔵 info | Listener `useCase` has no equivalent REST endpoint in a module that exposes REST |
| C2-003 | 🟡 warning | Value in a `*Type` enum with no traceable Kafka event as origin |
| C2-004 | 🔴 error | Event `triggers[]` references a transition method that does not exist |
| C2-005 | 🔵 info | Transition method without any associated Domain Event (no `triggers`) |

> **Note on C2-001:** Silenced automatically when the transition method already has an event `trigger` declared — the trigger itself is sufficient design evidence.

#### C2-001 — Transition with no endpoint or listener

```yaml
enums:
  - name: OrderStatus
    transitions:
      - from: CONFIRMED
        to: CANCELLED
        method: cancel   # ⚠️ WARNING — nothing calls 'cancel'
```

**Message:** `[C2-001] Transición 'cancel' de OrderStatus (CONFIRMED → CANCELLED) no tiene endpoint HTTP ni listener asociado`

**Fix:** Add a `POST /orders/{id}/cancel` endpoint or connect it to a listener with `useCase: CancelOrder`.

#### C2-004 — Trigger references non-existent transition method

```yaml
events:
  - name: OrderShipped
    triggers:
      - ship   # ❌ ERROR — no transition method named 'ship' exists
```

**Message:** `[C2-004] Evento 'OrderShipped' tiene trigger 'ship' que no corresponde a ningún método de transición`

**Fix:** Add a transition with `method: ship`, or update the trigger to reference an existing method.

#### C2-005 — Transition without a Domain Event (info)

**Message:** `[C2-005] Transición 'confirm' (OrderStatus: PENDING → CONFIRMED) no tiene ningún Domain Event asociado`

**Recommendation:** Declare a domain event with `triggers: [confirm]` so downstream modules can react to this state change.

#### C2-002 / C2-003 — Completeness checks (info / warning)

- `[C2-002]` — Listener `useCase` has no REST equivalent in the same module (info; acceptable when the module is purely event-driven)
- `[C2-003]` — Value in a `*Type` enum (e.g., `PaymentType.BANK_TRANSFER`) has no Kafka event whose name or fields overlap — suggests the value originates from an external trigger not yet documented

---

### C3 — Cross-reference integrity

Verifies that all declared dependencies between modules are consistent: cross-aggregate field references have a corresponding port or listener, port calls target declared endpoints, and there is no hidden circular coupling.

| Rule | Severity | Description |
|------|----------|-------------|
| C3-001 | 🟡 warning | Field with `reference.module=X` but no port or listener connecting to X |
| C3-002 | 🔴 error | `port.target` refers to an internal module with no `domain.yaml` loaded |
| C3-003 | 🟡 warning | Port calls an endpoint not declared in the target module |
| C3-004 | 🟡 warning | Sync dependency on a module that emits no Kafka events |
| C3-005 | 🔴 error | Bidirectional sync coupling between two modules (A calls B **and** B calls A) |
| C3-006 | 🟡 warning | `system.yaml` declares a sync call but the caller module has no matching port |
| C3-007 | 🔴 error | Same `useCase` generates identically-named `CommandHandler`/`QueryHandler` in 2+ modules — causes `ConflictingBeanDefinitionException` |

> **Note:** C3-002, C3-003, and C3-004 are skipped for external services — targets ending in `-external` or whose `baseUrl` points to a non-localhost host.

#### C3-001 — Cross-aggregate reference without a port or listener

```yaml
# reservations/domain.yaml
fields:
  - name: customerId
    type: String
    reference:
      aggregate: Customer
      module: customers   # ⚠️ WARNING — no port or listener to 'customers'
```

**Message:** `[C3-001] Campo 'customerId' referencia módulo 'customers' pero no hay port ni listener que conecte con ese módulo`

**Fix:** Add a `ports[]` entry targeting `customers` in `reservations/domain.yaml`.

#### C3-002 — Port target missing domain.yaml

```yaml
ports:
  - name: findScreeningById
    service: ScreeningService
    target: screenings   # ❌ ERROR — 'screenings' in system.yaml but no domain.yaml loaded
```

**Message:** `[C3-002] Port 'ScreeningService' apunta a 'screenings' que está en system.yaml pero no tiene domain.yaml cargado`

**Fix:** Ensure `system/screenings/domain.yaml` exists and is reachable when running `--domain`.

#### C3-003 — Port calls undeclared endpoint

```yaml
ports:
  - http: GET /orders/{id}/items   # ⚠️ WARNING — not listed in orders.exposes[]
    target: orders
```

**Message:** `[C3-003] Port 'OrderService' llama 'GET /orders/{id}/items' en 'orders' pero ese endpoint no está declarado en el módulo destino`

**Fix:** Add `GET /orders/{id}/items` to `orders.exposes[]` in `system.yaml`, or correct the port path.

#### C3-005 — Bidirectional sync coupling

**Message:** `[C3-005] Acoplamiento síncrono bidireccional entre 'reservations' y 'payments'`

**Fix:** Same as [S3-003](#s3-003--bidirectional-sync-coupling) — break the cycle with an async event or a shared read-model.

#### C3-007 — Cross-module useCase name collision (bean conflict)

Two modules consuming the same Kafka event with the same `useCase` name — or a listener `useCase` matching an endpoint `useCase` in another module — generates two handler classes with the same simple name. Since `UseCaseConfig` scans the entire base package and `@ApplicationComponent` does not qualify the bean name, Spring throws `ConflictingBeanDefinitionException`.

```yaml
# orders/domain.yaml
listeners:
  - event: PaymentApprovedEvent
    useCase: HandlePaymentApproved   # → HandlePaymentApprovedCommandHandler.java

# deliveries/domain.yaml
listeners:
  - event: PaymentApprovedEvent
    useCase: HandlePaymentApproved   # ❌ ERROR — same handler class name
```

**Message:** `[C3-007] 'HandlePaymentApprovedCommandHandler' se genera en 'orders' y 'deliveries' — causa ConflictingBeanDefinitionException`

**Fix:** Rename the `useCase` in each module to reflect its bounded context:

```yaml
# orders/domain.yaml
listeners:
  - event: PaymentApprovedEvent
    useCase: ConfirmOrder              # ✅ Semantically correct for orders

# deliveries/domain.yaml
listeners:
  - event: PaymentApprovedEvent
    useCase: ScheduleDelivery          # ✅ Semantically correct for deliveries
```

#### C3-006 — system.yaml sync call without matching port

```yaml
# system.yaml: reservations calls screenings
# reservations/domain.yaml: no ports[] for 'screenings'  ⚠️ WARNING
```

**Message:** `[C3-006] system.yaml declara que 'reservations' llama síncronamente a 'screenings' pero el módulo no tiene port declarado hacia 'screenings'`

**Fix:** Add a `ports[]` section in `reservations/domain.yaml` with a method targeting `screenings`.

---

### C4 — Audit & traceability

Verifies that critical business entities have change-tracking mechanisms and that data from external bounded contexts is stored in a structured format.

> **Critical modules heuristic:** A module is considered critical when its name contains any of: `payment`, `billing`, `order`, `reservation`, `customer`, `user`, or `inventory`.

| Rule | Severity | Description |
|------|----------|-------------|
| C4-001 | 🟡 warning | Child entity with `cascade: REMOVE` has no audit and no soft delete, while its root entity has audit enabled |
| C4-002 | 🟡 warning | Root entity in a critical module without `audit.enabled: true` |
| C4-003 | 🟡 warning | Field with an external-data name typed as plain `String` in a module that declares ports |
| C4-004 | 🟡 warning | `readOnly` field in a critical module that does not appear in any event of that module |

#### C4-001 — Child entity deletable without audit trail

```yaml
entities:
  - name: Order
    isRoot: true
    audit:
      enabled: true
    relationships:
      - type: OneToMany
        target: OrderItem
        cascade: [REMOVE]   # root is audited, child is not → ⚠️ WARNING
```

**Message:** `[C4-001] Entidad hija 'OrderItem' tiene cascade REMOVE pero sin audit ni soft delete`

**Fix:** Add `audit.enabled: true` or `hasSoftDelete: true` to the `OrderItem` entity.

#### C4-002 — Critical root entity without audit

**Message:** `[C4-002] Entidad raíz 'Order' en módulo crítico 'orders' no tiene audit.enabled:true`

**Fix:**
```yaml
entities:
  - name: Order
    isRoot: true
    audit:
      enabled: true
      trackUser: true
```

#### C4-003 — External data stored as unstructured String

```yaml
fields:
  - name: rawData    # ⚠️ WARNING — external payload stored as plain String
    type: String
```

**Message:** `[C4-003] Campo 'rawData' almacena datos externos como String no estructurado`

**Fix:** Replace with a `nestedType` or a structured Value Object mapping the relevant fields explicitly.

#### C4-004 — readOnly field not surfaced in any event

```yaml
fields:
  - name: totalAmount
    type: BigDecimal
    readOnly: true   # ⚠️ WARNING — not included in any domain event of this module
```

**Message:** `[C4-004] Campo readOnly 'totalAmount' en módulo crítico 'reservations' no aparece en ningún evento del módulo`

**Fix:** Include `totalAmount` in a relevant domain event, or document why it is intentionally private.

---

## 6. Score calculation

The score **only** counts errors, warnings, and passing validations. **Info items do not affect the score.**

```
score = round(passed / (passed + errors + warnings × 0.5) × 100)
```

| Score | Color | Interpretation |
|-------|-------|----------------|
| > 80% | 🟢 Green | Good architecture — minor issues only |
| 60–80% | 🟡 Yellow | Moderate issues — review warnings before coding |
| < 60% | 🔴 Red | Significant problems — resolve errors before proceeding |

A score of 100% means zero errors, zero warnings, and at least one passing validation.

---

## 7. Report output

The command produces three output artifacts:

### 1. Console summary

```
✔ Analysis complete!

📊 Validation Summary
────────────────────────────────────────
  🔴 Errors:     0
  🟡 Warnings:   3
  🔵 Info:       12
  🟢 Passed:     11
  📈 Score:      88%

Report written to: ./system-report.html
Evaluation written to: assets/system-evaluation.md

🌐 Server running at: http://localhost:3000
```

### 2. HTML report (`system-report.html`)

Self-contained HTML file with four interactive tabs. Can be shared without a server.

### 3. Markdown evaluation (`assets/system-evaluation.md`)

A concise file containing only **errors and warnings** — suitable for committing alongside `system.yaml` as a living architecture review document.

```markdown
# Evaluación del sistema — my-system

> Generado: 2026-03-13 10:45:00
> Score de calidad: **88%** 🟢 Bueno
> 🔴 Errores: 0 | 🟡 Advertencias: 3

---

## 🟡 Advertencias

- [S1-004] Módulo 'notifications' es puramente reactivo …
- [S2-005] Módulo 'customers' consume eventos pero no produce ninguno
- [S2-005] Módulo 'notifications' consume eventos pero no produce ninguno
```

---

## 8. Practical examples with real findings

### Example: cinema booking system

Running `eva evaluate system` on a cinema booking `system.yaml` with 7 modules and 9 async events produced:

**Score: 88% (0 errors, 3 warnings, 11 passed, 12 info)**

| Rule | Severity | Finding | Recommendation |
|------|----------|---------|----------------|
| S1-004 | 🟡 | `notifications` is purely reactive but description doesn't say so | Add "consumes events" to its description |
| S2-005 | 🟡 | `customers` consumes events but produces none | Intentional — accumulates loyalty points. Acceptable. |
| S2-005 | 🟡 | `notifications` consumes events but produces none | Intentional — pure notification sink. Acceptable. |
| S2-007 | 🔵 | 9 topics don't include the `cinema` prefix | Rename topics to `cinema.RESERVATION_CREATED`, etc. |
| S3-005 | 🔵 | `movies`, `theaters`, `customers` consulted sync but emit no events | Acceptable for catalog/reference data modules |

---

## 9. Common errors and how to fix them

### Error S1-001 — Module referenced but not declared

```
[S1-001] Módulo 'billing' referenciado en integrations pero no declarado en modules[]
```

**Fix:** Add the module to `modules[]` or correct the name typo in `integrations`.

---

### Error S1-002 — Module with no responsibilities

```
[S1-002] Módulo 'reporting' no tiene ninguna responsabilidad — no expone endpoints,
no produce ni consume eventos
```

**Fix:** Add `exposes[]` endpoints, connect the module to an async event, or remove it.

---

### Error S2-001 — Event with no consumers

```
[S2-001] Evento 'OrderShippedEvent' declarado en integrations.async sin consumidores
```

**Fix:** Add at least one consumer, or remove the event if it is not yet implemented.

---

### Error S2-002 — Topic collision

```
[S2-002] Topic 'ORDER_EVENTS' está declarado para dos eventos distintos:
'OrderCreatedEvent' y 'OrderCancelledEvent'
```

**Fix:** Give each event a unique topic name: `ORDER_CREATED`, `ORDER_CANCELLED`.

---

### Error S2-003 — Self-loop

```
[S2-003] Módulo 'orders' está listado como consumidor de su propio evento
'OrderCreatedEvent' (self-loop)
```

**Fix:** Remove the self-reference from `consumers`, or redesign the flow so a different module consumes the event.

---

### Error S3-001 — Sync call to module without endpoints

```
[S3-001] 'orders' llama síncronamente a 'notifications' pero este módulo
no declara exposes[]
```

**Fix:** Add `exposes[]` to the target module, or replace the sync call with an async event.

---

### Error S3-002 — Endpoint not found in target module

```
[S3-002] Endpoint 'GET /orders/{id}/items' usado por 'shipping' no está
declarado en exposes[] de 'orders'
```

**Fix:** Add the missing endpoint to `orders.exposes[]`:

```yaml
- method: GET
  path: /orders/{id}/items
  useCase: GetOrderItems
  description: "..."
```

---

### Error S4-001 — Duplicate route

```
[S4-001] Módulo 'orders' tiene dos endpoints con el mismo método y path:
GET /orders/{id}
```

**Fix:** Remove the duplicate or rename the path of the second endpoint.

---

### Warning S3-003 — Bidirectional sync coupling

```
[S3-003] Acoplamiento síncrono bidireccional: 'orders' llama a 'inventory'
y viceversa
```

**Fix options:**
1. Replace one direction with an async event
2. Extract the shared data into a third read-model module that both query
3. Pass the needed data in the initial request payload, avoiding the reverse call

---

### Warning S5-001 — Messaging disabled with events declared

```
[S5-001] messaging.enabled está en false pero hay 5 eventos declarados
en integrations.async
```

**Fix:** Set `messaging.enabled: true`, or remove the async events from `integrations` if messaging is truly not used.

---

### Warning S5-002 — Success event without failure counterpart

```
[S5-002] Evento de éxito 'PaymentApprovedEvent' existe pero no hay un evento
de fallo correspondiente para el sujeto 'payment' que permita compensación
```

**Fix:** Add a corresponding failure event so consumers can react to unhappy paths:

```yaml
- event: PaymentRejectedEvent
  producer: payments
  topic: PAYMENT_REJECTED
  consumers:
    - module: reservations
      useCase: ExpireReservation
    - module: notifications
      useCase: NotifyPaymentRejected
```


---

