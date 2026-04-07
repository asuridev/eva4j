# Command `generate temporal-flow` (alias: `g temporal-flow`)

## 📋 Description

Generates a complete Temporal workflow with interface, implementation and service facade, then automatically registers the workflow in the existing `TemporalConfig.java`.

## 🎯 Purpose

Create the scaffolding for a new Temporal workflow (orchestration unit) within a module. Follows the Saga pattern with compensation support and provides both async and sync invocation modes via the generated service facade.

## 📝 Syntax

```bash
eva generate temporal-flow <module>
eva g temporal-flow <module>    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `module` | Yes | Target module name (e.g., `order`, `payment`) |

> **Interactive prompt:** When the module is provided, the CLI asks for the **workflow name**. You can write it in `kebab-case` (`process-order`) or `PascalCase` (`ProcessOrder`) — both are accepted and normalised to PascalCase internally.

## 💡 Examples

### Example 1: Order processing workflow

```bash
eva g temporal-flow order
# Prompted for workflow name: process-order  (or ProcessOrder)
```

**Generates:**
- `application/usecases/ProcessOrderWorkFlow.java` — `@WorkflowInterface`
- `application/usecases/ProcessOrderWorkFlowImpl.java` — implementation with Saga
- `application/usecases/ProcessOrderWorkFlowService.java` — Spring service facade
- `domain/interfaces/OrderHeavyActivity.java` — module-scoped marker interface
- `domain/interfaces/OrderLightActivity.java` — module-scoped marker interface
- `infrastructure/configurations/OrderTemporalWorkerConfig.java` — module worker registration
- Appends `ORDER` queue section to `temporal.yaml`

### Example 2: Payment workflow

```bash
eva g temporal-flow payment
# Prompted for workflow name: process-payment
```

**Generates:**
- `application/usecases/ProcessPaymentWorkFlow.java`
- `application/usecases/ProcessPaymentWorkFlowImpl.java`
- `application/usecases/ProcessPaymentWorkFlowService.java`
- `domain/interfaces/PaymentHeavyActivity.java`
- `domain/interfaces/PaymentLightActivity.java`
- `infrastructure/configurations/PaymentTemporalWorkerConfig.java`
- Appends `PAYMENT` queue section to `temporal.yaml`

### Example 3: Multiple workflows in the same module

You can run the command again with a different name to add more workflows:

```bash
eva g temporal-flow order
# process-order → generates ProcessOrder files

eva g temporal-flow order
# refund-order  → generates RefundOrder files
```

Each run appends a new `registerWorkflowImplementationTypes(...)` entry to `OrderTemporalWorkerConfig.java` without duplicating existing registrations.

## 📦 Generated Code Structure

### WorkFlow Interface — `ProcessOrderWorkFlow.java`

```java
package com.example.project.order.application.usecases;

import io.temporal.workflow.QueryMethod;
import io.temporal.workflow.SignalMethod;
import io.temporal.workflow.WorkflowInterface;
import io.temporal.workflow.WorkflowMethod;

@WorkflowInterface
public interface ProcessOrderWorkFlow {

    @WorkflowMethod
    void start(String input);

    @SignalMethod
    void confirm();

    @QueryMethod
    String getStatus();
}
```

### WorkFlow Implementation — `ProcessOrderWorkFlowImpl.java`

```java
package com.example.project.order.application.usecases;

import io.temporal.activity.ActivityOptions;
import io.temporal.common.RetryOptions;
import io.temporal.workflow.Saga;
import io.temporal.workflow.SignalMethod;
import io.temporal.workflow.QueryMethod;
import io.temporal.workflow.Workflow;

import java.time.Duration;

public class ProcessOrderWorkFlowImpl implements ProcessOrderWorkFlow {

    private Saga.Options sagaOptions = new Saga.Options.Builder()
        .setParallelCompensation(false)
        .build();

    private Saga saga = new Saga(sagaOptions);

    // Light activities (<30 s) — routed to ORDER_LIGHT_TASK_QUEUE
    private final ActivityOptions lightActivityOptions = ActivityOptions.newBuilder()
        .setStartToCloseTimeout(Duration.ofSeconds(30))
        .setTaskQueue("ORDER_LIGHT_TASK_QUEUE")
        .setRetryOptions(
            RetryOptions.newBuilder()
                .setMaximumAttempts(2)
                .setInitialInterval(Duration.ofSeconds(1))
                .setMaximumInterval(Duration.ofSeconds(10))
                .setBackoffCoefficient(2.0)
                .build()
        ).build();

    // Heavy activities (up to 2 min) — routed to ORDER_HEAVY_TASK_QUEUE
    private final ActivityOptions heavyActivityOptions = ActivityOptions.newBuilder()
        .setStartToCloseTimeout(Duration.ofSeconds(120))
        .setTaskQueue("ORDER_HEAVY_TASK_QUEUE")
        .setRetryOptions(
            RetryOptions.newBuilder()
                .setMaximumAttempts(2)
                .setInitialInterval(Duration.ofSeconds(1))
                .setMaximumInterval(Duration.ofSeconds(10))
                .setBackoffCoefficient(2.0)
                .build()
        ).build();

    private String status = "PENDING";

    @Override
    public void start(String workFlowId) {
        try {
            //todo: workflow logic
        } catch (Exception e) {
            saga.compensate();
        }
    }

    @Override
    public void confirm() {
        // Handle confirmation signal
    }

    @Override
    public String getStatus() {
        return status;
    }
}
```

### WorkFlow Service Facade — `ProcessOrderWorkFlowService.java`

```java
package com.example.project.order.application.usecases;

import com.example.project.shared.domain.annotations.ApplicationComponent;
import io.temporal.client.WorkflowClient;
import io.temporal.client.WorkflowOptions;
import org.springframework.beans.factory.annotation.Value;

import java.util.UUID;

@ApplicationComponent
public class ProcessOrderWorkFlowService {

    private final WorkflowClient workflowClient;

    @Value("${temporal.modules.order.flow-queue}")
    private String flowQueue;

    // ... constructor injection

    /** Fire and forget — returns the workflow ID immediately */
    public String startAsync(String input) {
        String workflowId = "ProcessOrderWorkFlow-" + UUID.randomUUID();
        ProcessOrderWorkFlow workflow = workflowClient.newWorkflowStub(
                ProcessOrderWorkFlow.class,
                WorkflowOptions.newBuilder()
                        .setWorkflowId(workflowId)
                        .setTaskQueue(flowQueue)
                        .build());
        WorkflowClient.start(workflow::start, input);
        return workflowId;
    }

    /** Blocking — waits until the workflow finishes */
    public void startSync(String input) {
        String workflowId = "ProcessOrderWorkFlow-" + UUID.randomUUID();
        ProcessOrderWorkFlow workflow = workflowClient.newWorkflowStub(
                ProcessOrderWorkFlow.class,
                WorkflowOptions.newBuilder()
                        .setWorkflowId(workflowId)
                        .setTaskQueue(flowQueue)
                        .build());
        workflow.start(input);
    }

    public void confirm(String workflowId) { /* signal */ }
    public String getStatus(String workflowId) { /* query */ return null; }
}
```

### OrderTemporalWorkerConfig.java — Auto-generated

```java
// registered automatically by eva g temporal-flow
workflowWorker.registerWorkflowImplementationTypes(ProcessOrderWorkFlowImpl.class);
```

## 🏗️ Queue Architecture

Queues are **module-scoped** — each module gets its own set of queues prefixed with the module name in SCREAMING_SNAKE_CASE:

| Queue | Purpose |
|-------|---------|
| `{MODULE}_WORKFLOW_QUEUE` | Workflow orchestration (WorkFlowImpl runs here) |
| `{MODULE}_LIGHT_TASK_QUEUE` | Fast activities (< 30 s), injected via `lightActivityOptions` |
| `{MODULE}_HEAVY_TASK_QUEUE` | Long-running activities (up to 2 min), injected via `heavyActivityOptions` |

For example, the `order` module generates:
- `ORDER_WORKFLOW_QUEUE`
- `ORDER_LIGHT_TASK_QUEUE`
- `ORDER_HEAVY_TASK_QUEUE`

The `payment` module generates:
- `PAYMENT_WORKFLOW_QUEUE`
- `PAYMENT_LIGHT_TASK_QUEUE`
- `PAYMENT_HEAVY_TASK_QUEUE`

This ensures each module's workers are isolated and can be scaled independently.

### temporal.yaml (auto-updated)

```yaml
temporal:
  service-url: localhost:7233
  namespace: default
  number-flow-worker: 10
  number-heavy-worker: 10
  number-light-worker: 10
  modules:
    order:
      flow-queue: ORDER_WORKFLOW_QUEUE
      heavy-queue: ORDER_HEAVY_TASK_QUEUE
      light-queue: ORDER_LIGHT_TASK_QUEUE
    payment:
      flow-queue: PAYMENT_WORKFLOW_QUEUE
      heavy-queue: PAYMENT_HEAVY_TASK_QUEUE
      light-queue: PAYMENT_LIGHT_TASK_QUEUE
```

Activity stubs created inside the workflow must pass the matching options object — see [GENERATE_TEMPORAL_ACTIVITY.md](./GENERATE_TEMPORAL_ACTIVITY.md).

## ✅ Prerequisites

- `eva add temporal-client` must have been run before this command
- The target `<module>` must already exist (`eva add module <module>`)
