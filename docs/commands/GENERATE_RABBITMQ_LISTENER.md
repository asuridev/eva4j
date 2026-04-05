# Command `generate rabbitmq-listener` (alias: `g rabbitmq-listener`)

## Description

Creates individual RabbitMQ listener classes in a module's infrastructure layer. Each listener class is dedicated to a single queue, following the **Open/Closed Principle** for better maintainability and scalability.

The command generates Spring AMQP `@RabbitListener` components that automatically consume events from configured queues, deserialize them into `EventEnvelope` objects, and provide integration with the `UseCaseMediator` for processing. Messages are manually acknowledged and failed messages are routed to a dead-letter queue (DLQ).

**Key Feature:** Each queue gets its own listener class (e.g., `UserUserCreatedListener.java`, `OrderOrderPlacedListener.java`), with module-prefixed names to avoid bean conflicts when multiple modules subscribe to the same event.

---

## Purpose

- **Create RabbitMQ consumers** to receive events from external systems
- **Process async events** using Spring AMQP listeners
- **Follow Open/Closed Principle** with individual listener classes per queue
- **Integrate with CQRS** architecture via UseCaseMediator
- **Handle errors with DLQ** — failed messages are nack'd to the dead-letter queue
- **Support multiple queues** by generating multiple listener classes
- **Enable event-driven communication** between microservices

---

## Syntax

```bash
eva generate rabbitmq-listener <module>
eva g rabbitmq-listener <module>    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `module` | Yes | Name of the module where listener will be created |

### Interactive Prompts

After running the command, you'll be prompted to:

1. **Select queues to listen to** (multiple selection with space bar)
   - Queues are read from `rabbitmq.yaml` configuration
   - Must select at least one queue
   - Can select multiple queues at once

---

## Prerequisites

### 1. RabbitMQ Client Must Be Installed

```bash
eva add rabbitmq-client
```

This configures:
- Spring AMQP dependencies
- RabbitMQ consumer configuration with manual acknowledgment
- Queue management in `rabbitmq.yaml`
- EventEnvelope infrastructure
- RabbitMQConfig.java with retry + DLQ support

### 2. Queues Must Exist in rabbitmq.yaml

Queues are defined in: `src/main/resources/parameters/local/rabbitmq.yaml`

```yaml
queues:
  user-created: user.user-created
  order-placed: order.order-placed
  payment-processed: payment.payment-processed
```

**Tip:** Generate queues using:
```bash
eva generate rabbitmq-event <module> <event-name>
```

---

## Examples

### Example 1: Basic Listener Creation

```bash
# Create listeners in 'notification' module
eva g rabbitmq-listener notification

# Select queues from interactive menu:
# ✓ user-created (user.user-created)
# ✓ order-placed (order.order-placed)
```

**Generated:**
```
notification/infrastructure/rabbitListener/
├── NotificationUserCreatedListener.java
└── NotificationOrderPlacedListener.java
```

**Generated code for NotificationUserCreatedListener.java:**
```java
package com.example.notification.infrastructure.rabbitListener;

import com.example.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.example.shared.infrastructure.eventEnvelope.EventEnvelope;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.Map;

/**
 * RabbitMQ listener for queue user.user-created
 */
@Component("notificationUserCreatedListener")
public class NotificationUserCreatedListener {

    private static final Logger log = LoggerFactory.getLogger(NotificationUserCreatedListener.class);

    private final UseCaseMediator useCaseMediator;
    private final ObjectMapper objectMapper;

    public NotificationUserCreatedListener(UseCaseMediator useCaseMediator, ObjectMapper objectMapper) {
        this.useCaseMediator = useCaseMediator;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = "${queues.user-created}")
    public void handle(Message message, Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();

        EventEnvelope<Map<String, Object>> event;
        try {
            event = objectMapper.readValue(
                    message.getBody(),
                    new TypeReference<EventEnvelope<Map<String, Object>>>() {});
        } catch (JsonProcessingException e) {
            log.error("Fatal deserialization error — sending to DLQ: {}", e.getMessage());
            channel.basicNack(deliveryTag, false, false);
            return;
        }

        // TODO: Implement event processing logic
        // Example: useCaseMediator.dispatch(new YourCommand(event.data()));

        channel.basicAck(deliveryTag, false);
    }

}
```

---

### Example 2: Adding More Listeners

```bash
# Run command again to add more listeners
eva g rabbitmq-listener order

# Select additional queues:
# ✓ payment-processed (payment.payment-processed)
```

**Result:** New listener class is **created independently** — existing listeners are not modified:

```
order/infrastructure/rabbitListener/
└── OrderPaymentProcessedListener.java
```

---

### Example 3: Multiple Modules Subscribing to Same Event

**Scenario:** Both `notification` and `analytics` modules want to consume `user-created` events.

```bash
# In notification module
eva g rabbitmq-listener notification
# Select: user-created → NotificationUserCreatedListener.java

# In analytics module
eva g rabbitmq-listener analytics
# Select: user-created → AnalyticsUserCreatedListener.java
```

**Result:** No bean name conflicts — each module has its own listener with a module-prefixed class and bean name.

> **Note:** In RabbitMQ, each consumer queue is independent. If both modules need to receive **all** messages, each should have its own queue bound to the producer's exchange (configured via `rabbitmq.yaml`).

---

### Example 4: Processing Events with Use Cases

**Implement event processing in generated listener:**

```java
@RabbitListener(queues = "${queues.user-created}")
public void handle(Message message, Channel channel) throws IOException {
    long deliveryTag = message.getMessageProperties().getDeliveryTag();

    EventEnvelope<Map<String, Object>> event;
    try {
        event = objectMapper.readValue(
                message.getBody(),
                new TypeReference<EventEnvelope<Map<String, Object>>>() {});
    } catch (JsonProcessingException e) {
        log.error("Fatal deserialization error — sending to DLQ: {}", e.getMessage());
        channel.basicNack(deliveryTag, false, false);
        return;
    }

    try {
        String userId = (String) event.data().get("userId");
        String email = (String) event.data().get("email");

        useCaseMediator.dispatch(new SendWelcomeEmailCommand(userId, email));

        channel.basicAck(deliveryTag, false);
    } catch (Exception e) {
        log.error("Processing failed — sending to DLQ: {}", e.getMessage());
        channel.basicNack(deliveryTag, false, false);
    }
}
```

---

## Generated Structure

```
<module>/
└── infrastructure/
    └── rabbitListener/
        ├── <Module><Topic>Listener.java              # Individual listener per queue
        ├── NotificationUserCreatedListener.java      # Notification module listening to user-created
        ├── OrderOrderPlacedListener.java             # Order module listening to order-placed
        └── AnalyticsUserCreatedListener.java         # Analytics module listening to user-created
```

**Class Naming Pattern:** `{ModuleName}{QueueName}Listener`

| Module | Queue key | Class name |
|--------|-----------|------------|
| `notification` | `user-created` | `NotificationUserCreatedListener` |
| `order` | `order-placed` | `OrderOrderPlacedListener` |
| `analytics` | `user-created` | `AnalyticsUserCreatedListener` |

---

## Configuration

### rabbitmq.yaml Structure

Location: `src/main/resources/parameters/local/rabbitmq.yaml`

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: guest
    password: guest
    virtual-host: /
    listener:
      simple:
        acknowledge-mode: manual
        concurrency: 3
        retry:
          enabled: true
          max-attempts: 3
          initial-interval: 1500

exchanges:
  user: user.events
  order: order.events

queues:
  user-created: user.user-created
  order-placed: order.order-placed

routing-keys:
  user-created: user.created
  order-placed: order.placed
```

### Environment-Specific Configuration

```yaml
# parameters/local/rabbitmq.yaml
spring.rabbitmq.host: localhost

# parameters/production/rabbitmq.yaml
spring.rabbitmq.host: ${RABBITMQ_HOST}
```

---

## How It Works

### 1. Command Execution Flow

```
User runs command
    ↓
Validates eva project
    ↓
Checks RabbitMQ client installed
    ↓
Validates module exists
    ↓
Reads available queues from rabbitmq.yaml
    ↓
Prompts user to select queues (multi-select)
    ↓
For each selected queue:
    ├── Generate listener class name (e.g., NotificationUserCreated = Notification + UserCreated)
    ├── Generate bean name (e.g., notificationUserCreatedListener)
    ├── Check if listener class already exists
    │   ├── YES → Skip (show warning)
    │   └── NO → Create new listener class
    └── Generate handle() method with @RabbitListener + manual ack
```

### 2. Runtime Event Processing Flow

```
RabbitMQ queue receives message
    ↓
Spring AMQP delivers raw Message to listener
    ↓
ObjectMapper deserializes body to EventEnvelope<Map<String, Object>>
    ├── Deserialization fails → basicNack (→ DLQ)
    └── Success → continue
    ↓
Extract data from event.data()
    ↓
Create command/query object
    ↓
Dispatch to UseCaseMediator
    ↓
Use case processes event
    ↓
Call channel.basicAck() to acknowledge
    ↓ (on error)
Call channel.basicNack(deliveryTag, false, false) → message goes to DLQ
```

---

## Error Handling

### Manual Acknowledgment

Unlike Kafka (which uses `Acknowledgment.acknowledge()`), RabbitMQ listeners use **channel-level acknowledgment**:

```java
// Success — remove from queue
channel.basicAck(deliveryTag, false);

// Failure — send to DLQ (do NOT requeue)
channel.basicNack(deliveryTag, false, false);
```

### Deserialization Errors

Fatal deserialization errors (malformed JSON) are immediately nack'd to the DLQ — no retry:

```java
} catch (JsonProcessingException e) {
    log.error("Fatal deserialization error — sending to DLQ: {}", e.getMessage());
    channel.basicNack(deliveryTag, false, false);
    return;
}
```

### Dead-Letter Queue (DLQ)

Each queue has a companion `.dlq` queue. Messages that are nack'd arrive in the DLQ for inspection:

```
[user.user-created] → nack → [user.user-created.dlq]
```

Monitor DLQ in the RabbitMQ Management UI: `http://localhost:15672`

### Retry Configuration

Retry is configured at the Spring AMQP level in `rabbitmq.yaml`:

```yaml
spring.rabbitmq.listener.simple.retry:
  enabled: true
  max-attempts: 3
  initial-interval: 1500
```

---

## Best Practices

### ✅ DO

1. **Always acknowledge after successful processing**
   ```java
   channel.basicAck(deliveryTag, false);
   ```

2. **Nack to DLQ on unrecoverable errors**
   ```java
   channel.basicNack(deliveryTag, false, false); // requeue=false → DLQ
   ```

3. **Delegate to use cases via UseCaseMediator**
   ```java
   useCaseMediator.dispatch(new ProcessOrderCommand(data));
   ```

4. **Handle deserialization separately** from business logic errors

5. **Use idempotent operations** — same message processed multiple times = same result

### ❌ DON'T

1. **Don't acknowledge before processing**
   ```java
   channel.basicAck(deliveryTag, false); // ❌ Don't do this first
   processEvent(event); // If this fails, message is lost
   ```

2. **Don't requeue indefinitely**
   ```java
   channel.basicNack(deliveryTag, false, true); // ❌ requeue=true creates infinite loop
   ```

3. **Don't catch and swallow exceptions**
   ```java
   try {
       processEvent(event);
   } catch (Exception e) {
       e.printStackTrace();
       channel.basicAck(deliveryTag, false); // ❌ Message lost on error
   }
   ```

4. **Each listener class handles one queue** — Single Responsibility Principle

5. **Add new listeners without modifying existing code** — Open/Closed Principle

---

## Comparison with Kafka Listeners

| Aspect | Kafka | RabbitMQ |
|--------|-------|----------|
| Annotation | `@KafkaListener(topics = ...)` | `@RabbitListener(queues = ...)` |
| Acknowledgment | `Acknowledgment.acknowledge()` | `channel.basicAck(tag, false)` |
| Error routing | Retry + no action | `channel.basicNack()` → DLQ |
| Deserialization | `EventEnvelope<Map>` automatic | `Message` body + manual `ObjectMapper` |
| Config file | `kafka.yaml` (`topics:`) | `rabbitmq.yaml` (`queues:`) |
| Listener directory | `kafkaListener/` | `rabbitListener/` |
| Class naming | `{Module}{Topic}Listener` | `{Module}{Queue}Listener` |

---

## Common Use Cases

### 1. Notification Service

```bash
eva g rabbitmq-listener notification
# ✓ user-created (send welcome email)
# ✓ order-placed (send order confirmation)
# ✓ payment-processed (send payment receipt)
```

### 2. Analytics/Audit Service

```bash
eva g rabbitmq-listener analytics
# ✓ user-created
# ✓ order-placed
# ✓ order-shipped
```

### 3. Saga Orchestration

```bash
eva g rabbitmq-listener order
# ✓ payment-processed (complete order)
# ✓ payment-failed (cancel order)
```

---

## Standalone vs domain.yaml Listeners

This standalone command generates a **generic stub** listener with a `TODO` comment. For **fully typed** listeners with IntegrationEvent records, typed Commands, and CommandHandlers, use the `listeners[]` section in `domain.yaml` and run `eva g entities <module>`.

| Feature | Standalone (`g rabbitmq-listener`) | domain.yaml (`listeners[]`) |
|---------|------------------------------------|-----------------------------|
| Template | `RabbitListenerSimple.java.ejs` | `RabbitListenerClass.java.ejs` |
| Typed fields | No — generic `Map<String, Object>` | Yes — explicit field extraction |
| IntegrationEvent | Not generated | Generated |
| Command + Handler | Not generated | Generated |
| Infrastructure beans | Not generated | Generated (exchange + queue + binding) |
| Use case | Manual implementation | Scaffold with CommandHandler |

---

## Troubleshooting

### ❌ "RabbitMQ client is not installed"

```bash
eva add rabbitmq-client
```

### ❌ "No queues found in rabbitmq.yaml"

Generate queues first:
```bash
eva g rabbitmq-event user user-created
```

Or manually add to `rabbitmq.yaml`:
```yaml
queues:
  user-created: user.user-created
```

### ❌ "Module not found"

```bash
eva add module <module-name>
```

### ❌ Messages not being consumed

**Checklist:**
1. RabbitMQ server is running (`docker-compose up -d`)
2. Queue exists in RabbitMQ (check Management UI: `http://localhost:15672`)
3. Queue name in `rabbitmq.yaml` matches actual RabbitMQ queue
4. No deserialization errors in application logs
5. Check DLQ for nack'd messages

### ❌ Duplicate message processing

Ensure idempotent operations or use message deduplication:

```java
@RabbitListener(queues = "${queues.user-created}")
public void handle(Message message, Channel channel) throws IOException {
    // ...
    String eventId = (String) event.data().get("eventId");
    if (eventRepository.existsByEventId(eventId)) {
        channel.basicAck(deliveryTag, false); // Skip duplicate
        return;
    }
    processEvent(event);
    eventRepository.save(new ProcessedEvent(eventId));
    channel.basicAck(deliveryTag, false);
}
```

---

## Next Steps After Generation

1. **Implement processing logic** in generated `handle()` method
2. **Create use cases** for event processing
3. **Add error handling** with proper nack → DLQ routing
4. **Monitor DLQ** via RabbitMQ Management UI
5. **Write integration tests** with `@RabbitIntegrationTest` or Testcontainers
6. **Configure concurrency** for scaling (`spring.rabbitmq.listener.simple.concurrency`)

---

## Related Commands

- [`generate rabbitmq-event`](./GENERATE_RABBITMQ_EVENT.md) — Create RabbitMQ event publisher
- [`generate kafka-listener`](./GENERATE_KAFKA_LISTENER.md) — Kafka equivalent of this command
- [`generate usecase`](./GENERATE_USECASE.md) — Create use cases to process events
- [`add module`](./ADD_MODULE.md) — Create new module
- [RabbitMQ Production Config](../RABBITMQ_PRODUCTION_CONFIG.md) — Production-ready configuration reference
