# Command `generate temporal-activity` (alias: `g temporal-activity`)

## 📋 Description

Generates a Temporal activity with its interface (port) and Spring implementation, then registers the activity stub inside a chosen `*WorkFlowImpl.java`.

## 🎯 Purpose

Create a single, focused unit of work that can be executed and retried independently by the Temporal server. Activities are the building blocks invoked by workflows — each activity handles one side-effect (database write, HTTP call, email, etc.) and can be categorised as **Light** (fast, < 30 s) or **Heavy** (long-running, up to 2 min) to route it to the appropriate worker queue.

## 📝 Syntax

```bash
eva generate temporal-activity <module>
eva g temporal-activity <module>    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `module` | Yes | Target module where the activity **interface** lives |

> **Interactive prompts (4 steps):**
> 1. **Activity name** — e.g., `send-confirmation-email` or `SendConfirmationEmail`
> 2. **Category** — `LightActivity` (< 30 s, `LIGHT_TASK_QUEUE`) or `HeavyActivity` (up to 2 min, `HEAVY_TASK_QUEUE`)
> 3. **Workflow to register in** — lists all `*WorkFlowImpl.java` found across all modules; select the one that will invoke this activity

## 💡 Examples

### Example 1: Light activity for e-mail notifications

```bash
eva g temporal-activity notification
# Prompted:
#   Activity name:  send-confirmation-email
#   Category:       LightActivity
#   Workflow:       order/ProcessOrderWorkFlowImpl.java
```

**Generates:**
- `notification/application/ports/SendConfirmationEmailActivity.java` — `@ActivityInterface`
- `notification/infrastructure/adapters/activities/SendConfirmationEmailActivityImpl.java` — `@Component` implementing `LightActivity`
- Patches `order/infrastructure/adapters/workflows/ProcessOrderWorkFlowImpl.java` with a stub field

### Example 2: Heavy activity for file processing

```bash
eva g temporal-activity documents
# Prompted:
#   Activity name:  generate-pdf-report
#   Category:       HeavyActivity
#   Workflow:       documents/ProcessDocumentWorkFlowImpl.java
```

**Generates:**
- `documents/application/ports/GeneratePdfReportActivity.java`
- `documents/infrastructure/adapters/activities/GeneratePdfReportActivityImpl.java` — implements `HeavyActivity`
- Patches `ProcessDocumentWorkFlowImpl.java` with a `heavyActivityOptions` stub

### Example 3: Multiple activities on the same workflow

Run the command multiple times with different names to build up a workflow's activity set:

```bash
eva g temporal-activity order   # ValidateStockActivity → LightActivity
eva g temporal-activity order   # ChargePaymentActivity → HeavyActivity
eva g temporal-activity order   # SendReceiptActivity   → LightActivity
```

Each run adds a new stub field in the selected `WorkFlowImpl` without touching existing ones.

## 📦 Generated Code Structure

### Activity Interface — `SendConfirmationEmailActivity.java`

```java
package com.example.project.notification.application.ports;

import io.temporal.activity.ActivityInterface;
import io.temporal.activity.ActivityMethod;

@ActivityInterface
public interface SendConfirmationEmailActivity {

    /**
     * @ActivityMethod(name = "SendConfirmationEmail") ensures a globally unique
     * method name, preventing TypeAlreadyRegisteredException when multiple
     * activity types are registered on the same worker.
     */
    @ActivityMethod(name = "SendConfirmationEmail")
    void execute(String input);
}
```

> **Why `name = "..."`?**  
> Without an explicit name, Temporal defaults every activity method to `"Execute"`. If the same worker hosts two activity interfaces both with `execute()`, Temporal throws `TypeAlreadyRegisteredException`. The generated unique name prevents this.

### Activity Implementation — `SendConfirmationEmailActivityImpl.java`

```java
package com.example.project.notification.infrastructure.adapters.activities;

import com.example.project.notification.application.ports.SendConfirmationEmailActivity;
import com.example.project.shared.domain.interfaces.LightActivity;
import org.springframework.stereotype.Component;

/**
 * Implements LightActivity — Spring DI injects this into TemporalConfig
 * via List<LightActivity>, automatically registering it on LIGHT_TASK_QUEUE.
 * No manual TemporalConfig.java patching is required.
 */
@Component
public class SendConfirmationEmailActivityImpl
        implements SendConfirmationEmailActivity, LightActivity {

    @Override
    public void execute(String input) {
        // TODO: implement activity logic
    }
}
```

### WorkFlowImpl — Auto-patched Stub Field

```java
// Added inside ProcessOrderWorkFlowImpl by the command:
private final SendConfirmationEmailActivity sendConfirmationEmailActivity =
        Workflow.newActivityStub(SendConfirmationEmailActivity.class, lightActivityOptions);
```

For a `HeavyActivity`, `heavyActivityOptions` is used instead.

## 🏗️ Queue & Registration Architecture

```
Spring Boot startup
        │
        ▼
TemporalConfig.workerFactory()
        │
        ├─ workflowWorker (FLOW_QUEUE)
        │       └─ registerWorkflowImplementationTypes(ProcessOrderWorkFlowImpl.class)
        │
        ├─ lightWorker (LIGHT_TASK_QUEUE)
        │       └─ registerActivitiesImplementations(List<LightActivity> beans...)
        │                       ↑
        │              SendConfirmationEmailActivityImpl @Component
        │
        └─ heavyWorker (HEAVY_TASK_QUEUE)
                └─ registerActivitiesImplementations(List<HeavyActivity> beans...)
                                ↑
                       GeneratePdfReportActivityImpl @Component
```

**Key points:**
- Activities are registered automatically via **Spring DI list injection** — adding `@Component` + marker interface is sufficient.
- The workflow stub field routes execution to the correct queue through `lightActivityOptions` / `heavyActivityOptions`.
- `TemporalConfig.java` is **not** patched for activities (only for workflows).

## 📊 Light vs Heavy — Decision Guide

| Criterion | LightActivity | HeavyActivity |
|-----------|--------------|---------------|
| Max execution time | 30 seconds | 2 minutes |
| Typical use cases | Cache lookups, email dispatch, simple DB writes | PDF generation, external API calls, image processing |
| Retry timeout | 30 s per attempt | 120 s per attempt |
| Worker queue | `LIGHT_TASK_QUEUE` | `HEAVY_TASK_QUEUE` |
| Options variable in WorkFlowImpl | `lightActivityOptions` | `heavyActivityOptions` |

## ✅ Prerequisites

- `eva add temporal-client` must have been run
- At least one workflow must exist in the project (created via `eva g temporal-flow`) — the command lists them in the interactive prompt
