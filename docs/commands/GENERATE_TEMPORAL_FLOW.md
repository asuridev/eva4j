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
- `infrastructure/adapters/workflows/ProcessOrderWorkFlowImpl.java` — implementation with Saga
- `application/usecases/ProcessOrderWorkFlowService.java` — Spring service facade
- Patches `shared/infrastructure/configurations/TemporalConfig.java` to register `ProcessOrderWorkFlowImpl`

### Example 2: Payment workflow

```bash
eva g temporal-flow payment
# Prompted for workflow name: process-payment
```

**Generates:**
- `application/usecases/ProcessPaymentWorkFlow.java`
- `infrastructure/adapters/workflows/ProcessPaymentWorkFlowImpl.java`
- `application/usecases/ProcessPaymentWorkFlowService.java`
- Patches `TemporalConfig.java`

### Example 3: Multiple workflows in the same module

You can run the command again with a different name to add more workflows:

```bash
eva g temporal-flow order
# process-order → generates ProcessOrder files

eva g temporal-flow order
# refund-order  → generates RefundOrder files
```

Each run appends a new `registerWorkflowImplementationTypes(...)` entry to `TemporalConfig.java` without duplicating existing registrations.

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
package com.example.project.order.infrastructure.adapters.workflows;

import io.temporal.activity.ActivityOptions;
import io.temporal.common.RetryOptions;
import io.temporal.workflow.Saga;
import io.temporal.workflow.Workflow;

import java.time.Duration;

public class ProcessOrderWorkFlowImpl implements ProcessOrderWorkFlow {

    // Light activities (<30 s) — routed to LIGHT_TASK_QUEUE
    private final ActivityOptions lightActivityOptions = ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofSeconds(30))
            .setTaskQueue("LIGHT_TASK_QUEUE")
            .setRetryOptions(RetryOptions.newBuilder()
                    .setMaximumAttempts(3)
                    .build())
            .build();

    // Heavy activities (up to 2 min) — routed to HEAVY_TASK_QUEUE
    private final ActivityOptions heavyActivityOptions = ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofSeconds(120))
            .setTaskQueue("HEAVY_TASK_QUEUE")
            .setRetryOptions(RetryOptions.newBuilder()
                    .setMaximumAttempts(3)
                    .build())
            .build();

    private String status = "PENDING";

    @Override
    public void start(String input) {
        Saga saga = new Saga(new Saga.Options.Builder().setParallelCompensation(false).build());
        try {
            status = "IN_PROGRESS";
            // TODO: execute activities and add compensations
            // Example: MyActivity activity = Workflow.newActivityStub(MyActivity.class, lightActivityOptions);
            //          saga.addCompensation(activity::compensate);
            //          activity.execute(input);
            status = "COMPLETED";
        } catch (Exception e) {
            status = "COMPENSATING";
            saga.compensate();
            status = "FAILED";
            throw Workflow.wrap(e);
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

    @Value("${temporal.flow-queue}")
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

### TemporalConfig.java — Auto-patched Entry

```java
// registered automatically by eva g temporal-flow
workflowWorker.registerWorkflowImplementationTypes(ProcessOrderWorkFlowImpl.class);
```

## 🏗️ Queue Architecture

| Queue | Purpose |
|-------|---------|
| `FLOW_QUEUE` | Workflow orchestration (WorkFlowImpl runs here) |
| `LIGHT_TASK_QUEUE` | Fast activities (< 30 s), injected via `lightActivityOptions` |
| `HEAVY_TASK_QUEUE` | Long-running activities (up to 2 min), injected via `heavyActivityOptions` |

Activity stubs created inside the workflow must pass the matching options object — see [GENERATE_TEMPORAL_ACTIVITY.md](./GENERATE_TEMPORAL_ACTIVITY.md).

## ✅ Prerequisites

- `eva add temporal-client` must have been run before this command
- The target `<module>` must already exist (`eva add module <module>`)
