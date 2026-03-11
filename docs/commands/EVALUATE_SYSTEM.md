# Command `evaluate system`

---

## Table of Contents

1. [Description and purpose](#1-description-and-purpose)
2. [Syntax and options](#2-syntax-and-options)
3. [system.yaml structure required](#3-systemyaml-structure-required)
4. [Evaluation criteria](#4-evaluation-criteria)
   - [Check 1 — Referential integrity](#check-1--referential-integrity)
   - [Check 2 — Sync cycle detection](#check-2--sync-cycle-detection)
   - [Check 3 — Module role analysis](#check-3--module-role-analysis)
   - [Check 4 — Behavior gaps](#check-4--behavior-gaps)
   - [Check 5 — Coupling patterns](#check-5--coupling-patterns)
5. [Score calculation](#5-score-calculation)
6. [Report output](#6-report-output)
7. [Practical examples with real findings](#7-practical-examples-with-real-findings)
8. [Common errors and how to fix them](#8-common-errors-and-how-to-fix-them)

---

## 1. Description and purpose

`evaluate system` statically analyzes a `system.yaml` file to detect architectural problems in a microservices design **before writing a single line of Java code**.

The command is domain-agnostic: it works for any system described in `system.yaml`, whether it's a cinema booking platform, an e-commerce system, a fintech application, or any other domain.

**What it produces:**

- A **quality score** (0–100%) based on checks passed vs. total
- A list of **critical errors** (broken references, hard cycles)
- A list of **warnings** (potential design problems that aren't necessarily wrong)
- A list of **passed validations** (proof that good practices are in place)
- An **interactive HTML report** with three tabs:
  - **Validation** — errors, warnings, score
  - **Flow Simulator** — step-by-step visualization of each async event flow
  - **Architecture** — per-module dependency explorer + sync dependency map + Kafka topic map + interactive network diagram

---

## 2. Syntax and options

```bash
eva evaluate system
eva evaluate system --port 8080        # serve the report on a custom port (default: 3000)
eva evaluate system --output ./report.html   # write HTML to a custom path
```

### Parameters

None. The command always reads `system.yaml` from the current working directory.

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--port <n>` | `3000` | Port for the local HTTP preview server |
| `--output <path>` | `./system-report.html` | Where to write the generated HTML file |

### Requirements

- Must be run from a directory containing a `system.yaml` file
- No eva4j project scaffold is required — `system.yaml` can be a standalone design file

---

## 3. system.yaml structure required

The minimal structure the evaluator expects:

```yaml
system:
  name: my-system           # used as report title

modules:
  - name: orders            # unique module identifier (camelCase or kebab-case)
    description: "..."      # shown in the report
    exposes:                # REST endpoints this module offers
      - method: POST
        path: /orders
        useCase: CreateOrder
        description: "..."
      - method: GET
        path: /orders/{id}
        useCase: GetOrder
        description: "..."

integrations:
  async:                    # async event flows (Kafka, RabbitMQ, etc.)
    - event: OrderCreatedEvent
      producer: orders
      topic: ORDER_CREATED
      consumers:
        - module: payments
        - module: notifications

  sync:                     # synchronous HTTP calls between modules
    - caller: payments
      calls: orders
      port: OrderService    # Java interface name that will be generated
      using:
        - GET /orders/{id}
```

All fields are optional except `modules[].name`. The evaluator gracefully handles missing sections (no async events, no sync calls, etc.).

---

## 4. Evaluation criteria

The evaluator runs **5 independent checks** against the parsed YAML. Each check produces errors, warnings, or passing validations.

---

### Check 1 — Referential integrity

**What it validates:** Every name referenced anywhere in `integrations` points to a module or endpoint actually declared in `modules[]`.

#### 1a. Event producers

Every `integrations.async[].producer` must be a module declared in `modules[]`.

```yaml
# ✅ PASSES — 'orders' is declared in modules[]
- event: OrderCreatedEvent
  producer: orders

# ❌ ERROR — 'billing' is not declared in modules[]
- event: InvoiceCreatedEvent
  producer: billing
```

**Error message:**
```
Integridad referencial: el productor 'billing' del evento 'InvoiceCreatedEvent'
no está declarado en modules[]
```

#### 1b. Event consumers

Every module listed in `integrations.async[].consumers` must be declared in `modules[]`.

```yaml
consumers:
  - module: payments       # ✅ must exist in modules[]
  - module: ghost-service  # ❌ ERROR if not declared
```

**Error message:**
```
Integridad referencial: el consumidor 'ghost-service' del evento 'OrderCreatedEvent'
no está declarado en modules[]
```

#### 1c. Sync caller / callee existence

Both `caller` and `calls` in every `integrations.sync[]` entry must be declared modules.

#### 1d. Sync endpoints exist in target module's `exposes[]`

Every endpoint listed in `sync[].using` must match an endpoint declared in the target module's `exposes[]`. Matching uses path templating awareness (`/orders/{id}` matches `GET /orders/{id}`).

```yaml
# payments calls orders
sync:
  - caller: payments
    calls: orders
    port: OrderService
    using:
      - GET /orders/{id}        # ✅ must appear in orders.exposes[]
      - GET /orders/{id}/total  # ❌ ERROR if not declared in orders.exposes[]
```

**Error message:**
```
Integridad referencial: el endpoint 'GET /orders/{id}/total' usado por 'payments'
no está declarado en el exposes[] de 'orders'
```

**Why this matters:** Undeclared endpoints indicate either a missing API design or a stale reference — both are common sources of integration bugs discovered late in development.

---

### Check 2 — Sync cycle detection

**What it validates:** The directed graph of synchronous calls contains no cycles.

The evaluator builds a directed graph where each node is a module and each edge `A → B` means "A calls B synchronously". It then runs DFS to detect:

1. **Direct bidirectional coupling** (`A → B` and `B → A`) — immediate deadlock risk
2. **Transitive cycles** (`A → B → C → A`) — detected via full DFS path traversal

```yaml
# ❌ CRITICAL — direct bidirectional sync coupling
sync:
  - caller: orders
    calls: inventory
  - caller: inventory
    calls: orders      # ← creates orders ↔ inventory cycle
```

**Error message:**
```
Acoplamiento circular síncrono: 'orders' e 'inventory' se llaman mutuamente
de forma síncrona. Esto puede causar deadlocks.
```

```yaml
# ❌ CRITICAL — transitive cycle
sync:
  - caller: A
    calls: B
  - caller: B
    calls: C
  - caller: C
    calls: A    # ← A → B → C → A
```

**Error message:**
```
Ciclo síncrono detectado: A → B → C → A
```

**If no cycles are found:**
```
No se detectaron ciclos ni acoplamiento síncrono bidireccional ✓
```

**Why this matters:** Synchronous circular dependencies in distributed systems can cause deadlocks under load, timeout cascades, and thread-pool exhaustion. This check catches the problem at design time.

---

### Check 3 — Module role analysis

**What it validates:** Each module has a coherent role — it either exposes endpoints, participates in integrations, or both. Isolated modules are flagged.

#### 3a. Completely isolated modules

A module with no `exposes[]` AND no participation in `integrations` (neither as producer/consumer nor as caller/callee) in an integration is suspicious.

**Warning:**
```
Módulo aislado: 'reporting' no tiene endpoints expuestos ni integraciones declaradas
```

#### 3b. Modules without `exposes[]`

A module with integrations but no REST endpoints is noted. This is often intentional (pure consumers, background processors) but is surfaced as a warning for review.

**Warning:**
```
'notifications' no tiene endpoints expuestos (exposes[] vacío o ausente)
```

If `notifications` only consumes events and doesn't expose REST endpoints, it's also marked as a passing note:
```
'notifications' es consumidor puro de eventos (correcto: no produce eventos propios) ✓
'notifications' no expone endpoints REST directamente (módulo de integración) ✓
```

#### 3c. Autonomous modules

Modules with endpoints but no integrations are flagged as autonomous — useful for spotting modules that should be integrated but aren't yet.

**Passing:**
```
'movies' es un módulo autónomo sin dependencias de integración ✓
```

---

### Check 4 — Behavior gaps

**What it validates:** Every state-mutating endpoint (PUT, POST, PATCH, DELETE) that uses a "scheduler-like" verb has at least one identifiable trigger — an incoming event or a sync call.

#### Trigger verbs detected

The evaluator looks for these verbs in the `useCase` name:

| Verb | Typical pattern |
|------|----------------|
| `expire` | `ExpireReservation`, `ExpireSession` |
| `clean` | `CleanExpiredTokens` |
| `close` | `CloseBatch` |
| `archive` | `ArchiveOldOrders` |
| `timeout` | `TimeoutPendingPayments` |
| `process` | `ProcessRefund`, `ProcessPendingItems` |
| `purge` | `PurgeDeletedUsers` |
| `flush` | `FlushQueue` |

#### What constitutes a valid trigger

- **Async event:** another module produces an event consumed by this module, and the event name contains the same verb
- **Sync call:** another module calls this endpoint via `sync[].using`

If neither is found, the evaluator raises a warning:

**Warning:**
```
Gap de comportamiento: 'ExpireReservation' (PUT /reservations/{id}/expire) en 'reservations'
no tiene ningún evento ni llamada síncrona que lo active.
Puede necesitar un scheduler o job periódico.
```

#### How to fix a behavior gap

Option A — Add an async trigger event:
```yaml
integrations:
  async:
    - event: ReservationExpiredEvent
      producer: reservations        # self-triggered via scheduler
      topic: RESERVATION_EXPIRED
      consumers:
        - module: reservations      # acts on it
```

Option B — Document the scheduler explicitly (informational, suppresses the warning by convention):
```yaml
exposes:
  - method: PUT
    path: /reservations/{id}/expire
    useCase: ExpireReservation
    description: "Invocado por Spring @Scheduled cada minuto. No tiene trigger externo."
```

Option C — Accept the warning; it's a legitimate scheduler endpoint.

**Why this matters:** These gaps represent operations that exist in the design but have no automated trigger. In production they either never run (dead code risk) or require manual invocation (operational risk). Surfacing them early allows deliberate decisions about scheduling strategies.

---

### Check 5 — Coupling patterns

**What it validates:** The relationship between synchronous calls and asynchronous events to detect asymmetric coupling that increases fragility.

#### Asymmetric coupling pattern

This pattern occurs when:
- Module A calls Module B **synchronously**
- Module B also publishes events that Module A **consumes asynchronously**

This creates a hybrid dependency — A depends on B both at request time (sync call) and at event time (async consumer). While not a hard error, it often indicates that the data needed in the sync call could instead travel inside the event, eliminating the coupling entirely.

```yaml
# payments calls reservations synchronously (to get amount)
sync:
  - caller: payments
    calls: reservations
    port: ReservationService
    using:
      - GET /reservations/{id}

# reservations also sends events that payments consumes
async:
  - event: ReservationCreatedEvent
    producer: reservations
    consumers:
      - module: payments           # ← asymmetric: payments ↔ reservations in both directions
```

**Warning:**
```
Acoplamiento asimétrico: 'payments' llama síncronamente a 'reservations',
mientras 'reservations' responde vía eventos asíncronos (ReservationCreatedEvent,
ReservationCancelledEvent). Considerar pasar los datos necesarios directamente
en el evento para eliminar la llamada síncrona.
```

#### How to eliminate asymmetric coupling

Embed the needed data in the event payload:

```yaml
# Before (asymmetric): payments calls GET /reservations/{id} to get the amount
# After (decoupled): amount travels inside the event
- event: ReservationCreatedEvent
  producer: reservations
  topic: RESERVATION_CREATED
  # Event payload would include: reservationId, customerId, amount, seatCount
  consumers:
    - module: payments    # payments now has amount without a sync call
```

Once `amount` travels in the event, the sync call from `payments → reservations` becomes unnecessary and can be removed.

#### Dual-trigger pattern (intentional — passing)

When a module exposes an endpoint that can be triggered both via REST call AND by consuming an event, the evaluator recognizes this as an intentional dual-trigger design and marks it as passing:

```
'screenings' tiene endpoints accesibles tanto síncronamente como vía eventos
(diseño dual — intencional) ✓
```

This pattern is valid when an operation needs to be invocable both manually (admin REST call) and automatically (event-driven).

---

## 5. Score calculation

The score is calculated as:

```
score = round((passed_count / (passed_count + errors_count + warnings_count)) * 100)
```

Where:
- `errors_count` — number of critical errors (each error counts as 1)
- `warnings_count` — number of warnings (each warning counts as 1)
- `passed_count` — number of passing validations

**Score thresholds:**

| Score | Color | Interpretation |
|-------|-------|----------------|
| > 80% | 🟢 Green | Good architecture — minor issues only |
| 60–80% | 🟡 Yellow | Moderate issues — review warnings before coding |
| < 60% | 🔴 Red | Significant problems — resolve errors before proceeding |

A score of 100% means zero errors, zero warnings, and at least some passing validations.

---

## 6. Report output

The command writes a self-contained HTML file (no external dependencies at runtime) and starts a local HTTP server for preview.

```
✔ Analysis complete!

📊 Validation Summary
────────────────────────────────────────
  🔴 Errors:     0
  🟡 Warnings:   5
  🟢 Passed:     17
  📈 Score:      87%

🌐 Server running at: http://localhost:3000
```

The HTML report contains three interactive tabs:

| Tab | Contents |
|-----|----------|
| **Validación** | Score cards, collapsible sections for errors / warnings / passed |
| **Simulador de flujos** | Step-by-step playback of each async event flow, with sync sub-calls shown inline |
| **Arquitectura** | Module dependency explorer (click any module), sync dependency cards, Kafka topic map, interactive network diagram (Vis.js) with hover highlights per event group |

The HTML is a **single self-contained file** — embeds all data as base64, uses React 18 from CDN. Can be shared as-is without a server.

---

## 7. Practical examples with real findings

### Example: cinema booking system

Running `eva evaluate system` on a cinema booking `system.yaml` with 7 modules and 8 async events produced:

**Score: 87% (0 errors, 5 warnings, 17 passed)**

| Finding | Type | Check | Recommendation |
|---------|------|-------|----------------|
| `notifications` has no `exposes[]` | ⚠️ Warning | Check 3 | Intentional — pure event consumer. Acceptable. |
| `ExpireReservation` has no trigger | ⚠️ Warning | Check 4 | Add a Spring `@Scheduled` job or a Temporal workflow to call this endpoint every minute |
| `ProcessRefund` has no trigger | ⚠️ Warning | Check 4 | Add a `ReservationCancelledEvent` consumer in `payments` that calls this endpoint |
| `payments → reservations` asymmetric | ⚠️ Warning | Check 5 | Embed `amount` in `ReservationCreatedEvent` payload; remove the sync call |
| `reservations → screenings` asymmetric | ⚠️ Warning | Check 5 | Embed screening data in `PrivateEventReservationCreatedEvent`; remove the sync GET call |

None of these required code changes before the score improved — they document deliberate design decisions and explicit technical debt.

---

## 8. Common errors and how to fix them

### Error: event producer not declared

```
Integridad referencial: el productor 'inventory' del evento 'StockUpdatedEvent'
no está declarado en modules[]
```

**Fix:** Add the missing module to `modules[]`, or correct the producer name typo.

---

### Error: sync endpoint not declared in target module

```
Integridad referencial: el endpoint 'GET /orders/{id}/items' usado por 'shipping'
no está declarado en el exposes[] de 'orders'
```

**Fix:** Add the missing endpoint to `orders.exposes[]`:

```yaml
- name: orders
  exposes:
    - method: GET
      path: /orders/{id}/items    # ← add this
      useCase: GetOrderItems
```

---

### Error: synchronous bidirectional cycle

```
Acoplamiento circular síncrono: 'A' y 'B' se llaman mutuamente de forma síncrona.
```

**Fix options:**
1. Remove one of the sync calls and replace it with an event
2. Extract the shared data into a third module that both A and B can query
3. Pass the needed data from A to B via the initial request payload, avoiding the reverse call

---

### Warning: behavior gap (scheduler verb with no trigger)

```
Gap de comportamiento: 'ArchiveOldOrders' (PUT /orders/archive) en 'orders'
no tiene ningún evento ni llamada síncrona que lo active.
```

**Fix:** Document the scheduling strategy. Options:
- Spring `@Scheduled(cron = "0 0 2 * * *")` in the `orders` module
- A dedicated `scheduler` module that calls this endpoint via sync
- A Temporal workflow (`eva add temporal-client` + `eva g temporal-flow orders`)
- Accept the warning if the endpoint is intentionally manual-only

---

### Warning: asymmetric coupling

```
Acoplamiento asimétrico: 'A' llama síncronamente a 'B', mientras 'B' responde
vía eventos asíncronos.
```

**Fix:** Audit the sync call. Ask: "Does A need this data at request time, or could it arrive via the event?" If via event — embed the field in the event payload and delete the sync call entry from `system.yaml`.
