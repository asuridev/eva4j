# Temporal Communication Patterns — Quick Reference

Reference for understanding how modules communicate in a Temporal-based system.

---

## Pattern Summary

| Pattern | Coupling | Direction | Waits for response | Use case |
|---------|---------|-----------|-------------------|----------|
| **Remote Activity** | Medium | Request → Response | ✅ Yes (blocking) | Atomic operations cross-service |
| **Remote Activity + Async** | Medium | Request → Response (parallel) | ✅ Yes (non-blocking) | Multiple independent operations in parallel |
| **Child Workflow** | High | Parent → Child | ✅ Yes | Subprocesses with own lifecycle |
| **Signal External** | Low | Fire & Forget | ❌ No | Notifications between active workflows |
| **Signal + Await** | Low | Bidirectional | ✅ Yes (with wait) | Wait for external event with timeout |

---

## 1. Remote Activity (most common)

A workflow invokes an activity whose implementation lives in another service. Temporal routes the task via Task Queue.

**When to use:**
- Atomic operations without own lifecycle
- Workflow needs the result to continue
- Read data from another service
- Simple write in another service

**Each microservice needs:**
```
invoker (e.g., orders):
  ├── ActivityInterface.java       ← interface (contract only)
  └── DTOs (input/output)

executor (e.g., inventory):
  ├── ActivityInterface.java       ← same interface
  ├── ActivityImpl.java            ← implementation with DB access
  └── Worker.java                  ← registers activity in queue
```

---

## 2. Parallel Execution with Async.function()

Execute multiple independent activities simultaneously.

**When to use:**
- 2+ activities are independent of each other
- Want to reduce total latency (max of individual times vs sum)

```
Sequential: A(2s) → B(1s) → C(1.5s) = 4.5s
Parallel:   A(2s) | B(1s) | C(1.5s) = 2s (max)
```

**In system.yaml:** mark steps with `parallel: true`

---

## 3. Child Workflow

A workflow launches a sub-workflow with its own lifecycle, history, and signals.

**When to use:**
- Subprocess has **own lifecycle** (can be cancelled, queried, retried)
- Complex logic with multiple internal steps
- Need to **limit cancellation scope**
- Parent history would be too long if inlined

**Difference from Remote Activity:**
```
Remote Activity:
  - One operation → result
  - No internal state
  - No signals or queries

Child Workflow:
  - Multiple steps with internal state
  - Accepts signals
  - Can be queried
  - Own history in Temporal Web
```

---

## 4. Signal External (Fire & Forget)

Send a signal to an already-running workflow. No response expected.

**When to use:**
- Notify an active workflow that something happened
- No response needed
- Services are completely independent

**The sender does NOT need the receiver's interface** if using untyped stub — lowest coupling pattern.

---

## 5. Signal + Await (Wait with Timeout)

Combine Signal with `Workflow.await()` for request-wait pattern between services.

**When to use:**
- Need response from another service but don't want to block with activity
- Other service may take minutes, hours, or days
- Need a timeout if response doesn't arrive
- Human approvals, external verifications, batch processes

---

## Mapping to system.yaml

| Pattern | Representation in system.yaml |
|---------|------------------------------|
| Remote Activity | `steps: [{ activity: X, target: Y, type: sync }]` |
| Parallel Activity | `steps: [{ activity: X, parallel: true }]` |
| Async Activity | `steps: [{ activity: X, type: async }]` |
| Child Workflow | Not in system.yaml directly — declare in domain.yaml `workflows:` |
| Signal | Implicit in `wait:` steps in domain.yaml workflows |

---

## Activity Data Flow Rules

### Rule 1: Activities access ONLY their own module's DB

```
✅ inventory.ReserveStock → reads inventory.stock table
❌ inventory.ReserveStock → reads customers.customer table
```

### Rule 2: Workflows assemble cross-module data

```
Workflow:
  Step 1: GetCustomerById → customers (get email, name)
  Step 2: GetProductsByIds → products (get prices)
  Step 3: ReserveStock → inventory (pass assembled data)
  Step 4: NotifyOrderPlaced → notifications (pass customer email, name, total)
```

### Rule 3: Notification activities receive ALL data as input

```
✅ NotifyOrderPlaced(orderId, email, firstName, totalAmount)
   → Has everything it needs, zero lookups

❌ NotifyOrderPlaced(orderId, customerId)
   → Would need to look up customer data — HIDDEN COUPLING
```
