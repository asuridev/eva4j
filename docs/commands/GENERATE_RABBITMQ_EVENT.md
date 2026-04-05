# Command `generate rabbitmq-event` (alias: `g rabbitmq-event`)

## Description

Generates the infrastructure for publishing a domain event to a RabbitMQ exchange, enabling asynchronous event-driven communication between modules or microservices using topic exchanges, routing keys, and dead-letter queues.

## Purpose

Implement event publishing without coupling the sender to the consumer. The generated `MessageBroker` port keeps the domain free of RabbitMQ dependencies, while the adapter handles the actual publishing using `EventEnvelope` for correlation tracking. Each event gets its own exchange, queue, routing key, and DLQ configuration.

## Syntax

```bash
eva generate rabbitmq-event <module> [event-name]
eva g rabbitmq-event <module> [event-name]    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `module` | Yes | Module that owns and publishes the event (e.g., `user`, `order`) |
| `event-name` | No | Event name in kebab-case — prompted if omitted; `IntegrationEvent` suffix is added automatically |

> **Interactive prompts (when event-name is omitted):**
> - If `domain.yaml` exists with declared events, a **multi-select list** is shown (including an "All events" option and a "Custom name" fallback).
> - If no `domain.yaml`, a free-text prompt asks for the event name.

**Note:** Running the command multiple times on the same module safely **appends** a new method to the existing `MessageBroker.java` without overwriting it.

## Prerequisites

RabbitMQ client must be installed in the project:

```bash
eva add rabbitmq-client
```

## Examples

### Example 1: User created event

```bash
eva g rabbitmq-event user user-created
```

Generates:
- `user/application/events/UserCreatedIntegrationEvent.java`
- `user/application/ports/MessageBroker.java` (created or appended)
- `user/infrastructure/adapters/rabbitmqMessageBroker/UserRabbitMessageBroker.java`
- `shared/configurations/rabbitmqConfig/RabbitMQConfig.java` (exchange + queue + binding beans added)
- Adds exchange, queue, and routing-key entries to `parameters/*/rabbitmq.yaml`

### Example 2: Order placed event

```bash
eva g rabbitmq-event order order-placed
```

### Example 3: Multiple events in the same module

```bash
eva g rabbitmq-event user user-created   # Creates MessageBroker with publishUserCreatedIntegrationEvent
eva g rabbitmq-event user user-updated   # Appends publishUserUpdatedIntegrationEvent to MessageBroker
eva g rabbitmq-event user user-deleted   # Appends publishUserDeletedIntegrationEvent to MessageBroker
```

Each run adds a new method without overwriting existing ones.

### Example 4: Batch mode from domain.yaml

```bash
eva g rabbitmq-event order
# Interactive multi-select:
# ★  All events
# ──────────────
# ◻ OrderPlaced (from Order aggregate)
# ◻ OrderConfirmed (from Order aggregate)
# ◻ OrderCancelled (from Order aggregate)
# ──────────────
# ◻ Custom name (free text)...
```

Select "All events" to generate all declared domain events at once.

## Generated Code Structure

```
<module>/
├── application/
│   ├── events/
│   │   └── UserCreatedIntegrationEvent.java    # Java record (event data)
│   └── ports/
│       └── MessageBroker.java                  # Port interface (append-safe)
│
└── infrastructure/
    └── adapters/
        └── rabbitmqMessageBroker/
            └── UserRabbitMessageBroker.java     # RabbitMQ adapter

shared/
└── infrastructure/
    └── configurations/
        └── rabbitmqConfig/
            └── RabbitMQConfig.java              # Exchange + Queue + Binding beans
```

## Generated Files

### 1. Integration Event (Application Layer)

**UserCreatedIntegrationEvent.java** (`application/events/`):
```java
package com.example.project.user.application.events;

public record UserCreatedIntegrationEvent(
  // TODO: Add your event fields here
  // Example:
  // Long id,
  // String name,
  // LocalDateTime createdAt
) {
}
```

> Events are pure Java records — immutable, no Lombok, no framework annotations.

### 2. MessageBroker Port (Application Layer)

**MessageBroker.java** (`application/ports/`):
```java
package com.example.project.user.application.ports;

import com.example.project.user.application.events.UserCreatedIntegrationEvent;

public interface MessageBroker {

  void publishUserCreatedIntegrationEvent(UserCreatedIntegrationEvent event);
}
```

> If `MessageBroker.java` already exists (from a previous run), the new `publishXxx` method is **appended** to the interface rather than overwriting it.

### 3. RabbitMQ Adapter (Infrastructure)

**UserRabbitMessageBroker.java** (`infrastructure/adapters/rabbitmqMessageBroker/`):
```java
package com.example.project.user.infrastructure.adapters.rabbitmqMessageBroker;

import com.example.project.user.application.events.UserCreatedIntegrationEvent;
import com.example.project.user.application.ports.MessageBroker;
import com.example.project.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.slf4j.MDC;

@Component("userRabbitMessageBroker")
public class UserRabbitMessageBroker implements MessageBroker {

  @Value("${exchanges.user}")
  private String exchange;

  @Value("${routing-keys.user-created}")
  private String userCreatedRoutingKey;

  private final RabbitTemplate rabbitTemplate;

  public UserRabbitMessageBroker(RabbitTemplate rabbitTemplate) {
    this.rabbitTemplate = rabbitTemplate;
  }

  @Override
  public void publishUserCreatedIntegrationEvent(UserCreatedIntegrationEvent event) {
    EventEnvelope<UserCreatedIntegrationEvent> envelope = EventEnvelope.of(
      userCreatedRoutingKey,
      event,
      MDC.get("correlationId")
    );
    rabbitTemplate.convertAndSend(exchange, userCreatedRoutingKey, envelope);
  }
}
```

> `EventEnvelope.of(routingKey, payload, correlationId)` wraps the event with routing metadata and the current MDC correlation ID for distributed tracing.

### 4. RabbitMQConfig Beans (Shared)

For each event, the command adds exchange, queue, binding, and DLQ beans to `RabbitMQConfig.java`:

```java
// ── Exchange (once per module) ──────────────────────────

@Value("${exchanges.user}")
private String userExchangeName;

@Bean
public TopicExchange userExchange() {
  return new TopicExchange(userExchangeName, true, false);
}

@Bean
public TopicExchange userDlxExchange() {
  return new TopicExchange(userExchangeName + ".dlx", true, false);
}

// ── Queue + Binding (per event) ─────────────────────────

@Value("${queues.user-created}")
private String userCreatedTopicQueueName;

@Value("${routing-keys.user-created}")
private String userCreatedTopicRoutingKeyValue;

@Bean
public Queue userCreatedTopicQueue() {
  return QueueBuilder.durable(userCreatedTopicQueueName)
      .withArgument("x-dead-letter-exchange", userExchangeName + ".dlx")
      .build();
}

@Bean
public Binding userCreatedTopicBinding() {
  return BindingBuilder
      .bind(userCreatedTopicQueue())
      .to(userExchange())
      .with(userCreatedTopicRoutingKeyValue);
}

@Bean
public Queue userCreatedTopicDlq() {
  return QueueBuilder.durable(userCreatedTopicQueueName + ".dlq").build();
}

@Bean
public Binding userCreatedTopicDlqBinding() {
  return BindingBuilder
      .bind(userCreatedTopicDlq())
      .to(userDlxExchange())
      .with(userCreatedTopicRoutingKeyValue);
}
```

## Configuration Added

```yaml
# parameters/local/rabbitmq.yaml
exchanges:
  user: user.events

queues:
  user-created: user.user-created

routing-keys:
  user-created: user.created
```

The same entries are added to every environment (`local`, `develop`, `test`, `production`).

### RabbitMQ Topology

Each event generates the following topology:

```
Producer → [user.events exchange] → routing key: user.created → [user.user-created queue]
                                                                         ↓ (on failure)
           [user.events.dlx exchange] → routing key: user.created → [user.user-created.dlq queue]
```

## Usage in a Command Handler

Inject `MessageBroker` (the port, not the RabbitMQ class) and call the publish method:

```java
@ApplicationComponent
public class CreateUserCommandHandler {

    private final UserRepository userRepository;
    private final MessageBroker messageBroker;

    public CreateUserCommandHandler(UserRepository userRepository, MessageBroker messageBroker) {
        this.userRepository = userRepository;
        this.messageBroker = messageBroker;
    }

    public void handle(CreateUserCommand command) {
        User user = new User(command.name(), command.email());
        userRepository.save(user);

        messageBroker.publishUserCreatedIntegrationEvent(
            new UserCreatedIntegrationEvent(/* fill fields */)
        );
    }
}
```

## DomainEventHandler Wiring

When the module has domain events (from `domain.yaml`), the command also wires the `DomainEventHandler` to publish integration events after transaction commit:

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onUserCreated(UserCreated event) {
    messageBroker.publishUserCreatedIntegrationEvent(
        new UserCreatedIntegrationEvent(event.getUserId(), event.getCreatedAt())
    );
}
```

## Bean Naming

The adapter is registered with an explicit bean name to avoid conflicts when multiple modules have a `MessageBroker`:

| Module | Bean name |
|--------|-----------|
| `user` | `userRabbitMessageBroker` |
| `order` | `orderRabbitMessageBroker` |
| `product` | `productRabbitMessageBroker` |

Spring resolves the correct adapter for each module via constructor injection by type + qualifier if needed.

## Comparison with Kafka Events

| Aspect | Kafka | RabbitMQ |
|--------|-------|----------|
| Adapter class | `{Module}KafkaMessageBroker` | `{Module}RabbitMessageBroker` |
| Adapter directory | `kafkaMessageBroker/` | `rabbitmqMessageBroker/` |
| Config file | `kafka.yaml` | `rabbitmq.yaml` |
| Routing | Topic name | Exchange + routing key |
| DLQ | Configured externally | Auto-generated DLQ + DLX per event |
| Config class | `KafkaConfig.java` (NewTopic beans) | `RabbitMQConfig.java` (Exchange + Queue + Binding beans) |
| Broker-agnostic port | `MessageBroker.java` (identical) | `MessageBroker.java` (identical) |

> **Mutual exclusivity:** Only one broker is allowed per project (`eva add kafka-client` or `eva add rabbitmq-client`, not both).

## See Also

- [generate rabbitmq-listener](./GENERATE_RABBITMQ_LISTENER.md) — Create RabbitMQ event consumer
- [generate kafka-event](./GENERATE_KAFKA_EVENT.md) — Kafka equivalent of this command
- [generate usecase](./GENERATE_USECASE.md) — Create use case handlers
- [RabbitMQ Production Config](../RABBITMQ_PRODUCTION_CONFIG.md) — Production-ready configuration reference
