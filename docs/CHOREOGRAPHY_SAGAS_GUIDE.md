# Choreography Sagas Guide

> **Declare multi-step distributed flows with automatic compensation in `system.yaml`**

---

## What is a Choreography Saga?

A choreography saga is a distributed transaction pattern where each participating module **reacts to events** instead of being orchestrated by a central coordinator. When a step fails, a compensation chain reverses the effects of all previous steps in **LIFO order** (last in, first out).

**When to declare a saga** (two or more conditions):
- ≥ 3 modules involved in a single business flow
- At least one step has a non-reversible side effect (financial charge, external API call, physical allocation)
- A late failure leaves the system in an inconsistent state without a compensation path

---

## Quick start

```yaml
# system/system.yaml
sagas:
  - name: PlaceOrderSaga
    description: "Order creation with stock reservation and payment"
    trigger:
      module: orders
      useCase: CreateOrder
      httpMethod: POST
      path: /orders
    steps:
      - order: 1
        module: orders
        action: CreateOrder
        emits: OrderPlacedEvent
        topic: ORDER_PLACED
        compensation: null          # initiator — cannot compensate itself

      - order: 2
        module: inventory
        trigger: OrderPlacedEvent
        topic: ORDER_PLACED
        action: ReserveStock
        emits: StockReservedEvent
        successTopic: STOCK_RESERVED
        compensationEvent: StockReservationFailedEvent
        compensationTopic: STOCK_RESERVATION_FAILED
        compensationModule: orders
        compensationUseCase: CompensateOrderPlacement

      - order: 3
        module: orders
        trigger: StockReservedEvent
        topic: STOCK_RESERVED
        action: ConfirmOrder
        emits: null
        compensation: null          # final step — successful destination
    observers:
      - module: notifications
        on: [OrderPlacedEvent, StockReservedEvent]
```

---

## Compensation patterns

### Pattern 1 — Single compensation (standard LIFO)

When step N fails, the module of step N−1 compensates.

```
Paso 1 (orders)     → compensation: null
Paso 2 (inventory)  → compensationModule: orders     ← reverts step 1
Paso 3 (payments)   → compensationModule: inventory  ← reverts step 2
Paso 4 (orders)     → compensation: null
```

**Happy path:**
```
orders:CreateOrder → ORDER_PLACED → inventory:ReserveStock
                                  → STOCK_RESERVED → payments:ProcessPayment
                                                   → PAYMENT_APPROVED → orders:ConfirmOrder ✅
```

**Failure at step 3 (payment declined):**
```
payments emits PaymentFailedEvent
  ↩ PAYMENT_FAILED → inventory:CompensateStockReservation   (reverts step 2)
```

Only one compensation fires — only step 2 had completed its effect before the failure.

---

### Pattern 2 — Chained compensation (cascade through events)

When a failure triggers compensations in two or more previous steps sequentially, the compensation of step N **emits its own event** when complete, and the step N−1 module listens to that event to execute its own compensation.

**Example — failure at step 3 requires compensating steps 2 and 1:**

```yaml
steps:
  - order: 2
    module: inventory
    action: ReserveStock
    compensationEvent: StockReservationFailedEvent
    compensationTopic: STOCK_RESERVATION_FAILED
    compensationModule: orders
    compensationUseCase: CompensateOrderPlacement   # compensates step 1

  - order: 3
    module: payments
    action: ProcessPayment
    compensationEvent: PaymentFailedEvent
    compensationTopic: PAYMENT_FAILED
    compensationModule: inventory
    compensationUseCase: CompensateStockReservation  # compensates step 2
```

**Compensation chain when payment fails:**
```
payments emits PaymentFailedEvent
  ↩ PAYMENT_FAILED → inventory:CompensateStockReservation   (reverts step 2)
       inventory emits StockReservationCompensatedEvent
  ↩ STOCK_RESERVATION_COMPENSATED → orders:CompensateOrderPlacement  (reverts step 1)
```

**Wiring the cascade in domain.yaml:**

The compensation use case handler in inventory **must emit an event** when its compensation completes, and orders must declare a listener for it:

```yaml
# inventory domain.yaml
listeners:
  - event: PaymentFailedEvent
    topic: PAYMENT_FAILED
    useCase: CompensateStockReservation    # emit StockReservationCompensatedEvent when done
    fields:
      - name: orderId
        type: String

events:
  - name: StockReservationCompensatedEvent
    fields:
      - name: orderId
        type: String
```

```yaml
# orders domain.yaml
listeners:
  - event: StockReservationCompensatedEvent   # emitted by inventory compensation handler
    topic: STOCK_RESERVATION_COMPENSATED
    useCase: CompensateOrderPlacement
    fields:
      - name: orderId
        type: String
```

> The `system.yaml` `sagas:` section only declares the **primary compensation** per step (one `compensationModule` per step). A cascade is expressed through `events[]` and `listeners[]` in the individual `domain.yaml` files, not by adding more entries to the saga step.

---

### Pattern 3 — Parallel compensation (two modules compensate simultaneously)

When a single failure event must trigger compensations in **two independent modules at the same time** (neither waits for the other), use multiple `consumers[]` on the compensation event in `integrations.async[]`.

**Example — payment failure must simultaneously release inventory AND cancel the warehouse slot:**

```yaml
integrations:
  async:
    - event: PaymentFailedEvent
      producer: payments
      topic: PAYMENT_FAILED
      consumers:
        - module: inventory
          useCase: CompensateStockReservation    # releases reserved units
        - module: warehouse
          useCase: CompensateSlotAllocation      # releases the allocated slot
```

```yaml
# inventory domain.yaml
listeners:
  - event: PaymentFailedEvent
    topic: PAYMENT_FAILED
    useCase: CompensateStockReservation
    fields:
      - name: orderId
        type: String

# warehouse domain.yaml
listeners:
  - event: PaymentFailedEvent
    topic: PAYMENT_FAILED
    useCase: CompensateSlotAllocation
    fields:
      - name: orderId
        type: String
```

> Parallel compensations are declared in `integrations.async[]`, **not** in the `sagas:` section. The `sagas:` section documents the sequential happy path and the LIFO chain; parallel fan-outs are messaging contracts.

---

## Compensation decision guide

| Scenario | Pattern | Where to declare |
|---|---|---|
| Failure at step N → revert step N−1 only | Standard LIFO | `sagas[].steps[].compensationModule` |
| Failure at step N → revert steps N−1 and N−2 in order | Chained cascade | `sagas:` (primary) + `events[]`/`listeners[]` in domain.yaml |
| Failure at step N → revert two independent steps in parallel | Parallel fan-out | `integrations.async[].consumers[]` |

---

## Naming conventions

| Element | Convention | Example |
|---|---|---|
| Saga name | PascalCase + `Saga` | `PlaceOrderSaga`, `CheckoutSaga` |
| Step `action` | PascalCase, verb+noun | `ReserveStock`, `ProcessPayment` |
| `compensationUseCase` | `Compensate` + noun of what is reversed | `CompensateStockReservation` |
| `compensationEvent` | PascalCase + past tense + failure + `Event` | `PaymentFailedEvent`, `StockReservationFailedEvent` |
| `compensationTopic` | SCREAMING_SNAKE_CASE | `PAYMENT_FAILED` |

**Mapping table — `action` → `compensationUseCase`:**

| `action` was... | `compensationUseCase` should be... |
|---|---|
| `ReserveStock` | `CompensateStockReservation` |
| `ProcessPayment` | `CompensatePayment` |
| `CreateOrder` | `CompensateOrderPlacement` |
| `ScheduleDelivery` | `CompensateDeliveryScheduling` |
| `AllocateWarehouseSlot` | `CompensateWarehouseAllocation` |

The `compensationUseCase` **must exactly match** the `useCase` field of the corresponding listener in the `compensationModule`'s `domain.yaml`. Mismatch is detected by the `S6-005` validator.

---

## Validation rules (S6)

`eva evaluate system` runs these checks automatically:

| Rule | Severity | What it catches |
|---|---|---|
| S6-001 | ERROR | `module` or `compensationModule` does not exist in `modules:` |
| S6-002 | ERROR | `emits`/`compensationEvent` not declared in any module's `events[]` |
| S6-003 | ERROR | `compensationModule` is missing the required listener in its `domain.yaml` — suggests the exact YAML fix |
| S6-004 | WARNING | Intermediate step has no `compensationEvent`/`compensationModule` declared |
| S6-005 | ERROR | `compensationUseCase` in saga ≠ `useCase` in the listener of `compensationModule` |
| S6-006 | ERROR | Observer `on[]` event not declared in any module |
| S6-000 | INFO | No sagas declared — OK if no distributed flows |

---

## Observers

Modules that react to saga events **passively** — no compensation required, not part of the execution chain.

```yaml
observers:
  - module: notifications
    on:
      - OrderPlacedEvent        # → "your order was received" email
      - PaymentApprovedEvent    # → "your order was confirmed" email
      - PaymentFailedEvent      # → "payment was declined" email
  - module: analytics
    on:
      - OrderPlacedEvent
      - PaymentApprovedEvent
```

Observers are validated by S6-006. They do not affect the LIFO compensation chain.

---

## Relationship to `eva evaluate system`

When `sagas:` is declared, the evaluation report shows a dedicated **Sagas** tab with:

- Step-by-step execution chain with LIFO visualization
- Compensation simulator (select a failing step to preview the rollback sequence)
- Observer registry
- S6 validation warnings inline

Run the evaluator after editing your saga:

```bash
eva evaluate system
```

---

## Reference

- **[system-yaml-spec.md](../src/skills/build-system-yaml/references/system-yaml-spec.md)** — Full property reference for `sagas:`, `steps[]`, `trigger`, `observers[]`
- **[DOMAIN_YAML_GUIDE.md](../DOMAIN_YAML_GUIDE.md)** — How to declare `events[]` and `listeners[]` in domain.yaml
- **[examples/system.yaml](../examples/system.yaml)** — Full example with all system.yaml sections
