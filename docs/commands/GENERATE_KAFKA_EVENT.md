# Command `generate kafka-event` (alias: `g kafka-event`)

## Description

Generates the infrastructure for publishing a domain event to an Apache Kafka topic, enabling asynchronous event-driven communication between modules or microservices.

## Purpose

Implement event publishing without coupling the sender to the consumer. The generated `MessageBroker` port keeps the domain free of Kafka dependencies, while the adapter handles the actual publishing using `EventEnvelope` for correlation tracking.

## Syntax

```bash
eva generate kafka-event <module> [event-name]
eva g kafka-event <module> [event-name]    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `module` | Yes | Module that owns and publishes the event (e.g., `user`, `order`) |
| `event-name` | No | Event name in kebab-case — prompted if omitted; `Event` suffix is added automatically |

> **Interactive prompts:**
> 1. **Event name** — if not provided (e.g., `user-created`, `order-placed`)
> 2. **Topic name** — Kafka topic identifier (e.g., `USER_CREATED`)
> 3. **Number of partitions** — default: 3
> 4. **Number of replicas** — default: 1

**Note:** Running the command multiple times on the same module safely **appends** a new method to the existing `MessageBroker.java` without overwriting it.

## Prerequisites

Kafka client must be installed in the project:

```bash
eva add kafka-client
```

## Examples

### Example 1: User created event

```bash
eva g kafka-event user user-created
# Event class: UserCreatedEvent
# Topic: USER_CREATED (entered at prompt)
```

Generates:
- `user/application/events/UserCreatedEvent.java`
- `user/application/ports/MessageBroker.java` (created or appended)
- `user/infrastructure/adapters/kafkaMessageBroker/UserKafkaMessageBroker.java`
- Adds topic config to `parameters/*/kafka.yaml`

### Example 2: Order placed event

```bash
eva g kafka-event order order-placed
```

### Example 3: Multiple events in the same module

```bash
eva g kafka-event user user-created   # Creates MessageBroker with publishUserCreatedEvent
eva g kafka-event user user-updated   # Appends publishUserUpdatedEvent to MessageBroker
eva g kafka-event user user-deleted   # Appends publishUserDeletedEvent to MessageBroker
```

Each run adds a new method without overwriting existing ones.

## Generated Code Structure

```
<module>/
├── application/
│   ├── events/
│   │   └── UserCreatedEvent.java             # Java record (event data)
│   └── ports/
│       └── MessageBroker.java                # Port interface (append-safe)
│
└── infrastructure/
    └── adapters/
        └── kafkaMessageBroker/
            └── UserKafkaMessageBroker.java   # Kafka adapter
```

## Generated Files

### 1. Event (Application Layer)

**UserCreatedEvent.java** (`application/events/`):
```java
package com.example.project.user.application.events;

public record UserCreatedEvent(
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

import com.example.project.user.application.events.UserCreatedEvent;

public interface MessageBroker {

  void publishUserCreatedEvent(UserCreatedEvent event);
}
```

> If `MessageBroker.java` already exists (from a previous run), the new `publishXxx` method is **appended** to the interface rather than overwriting it.

### 3. Kafka Adapter (Infrastructure)

**UserKafkaMessageBroker.java** (`infrastructure/adapters/kafkaMessageBroker/`):
```java
package com.example.project.user.infrastructure.adapters.kafkaMessageBroker;

import com.example.project.user.application.events.UserCreatedEvent;
import com.example.project.user.application.ports.MessageBroker;
import com.example.project.shared.infrastructure.eventEnvelope.EventEnvelope;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import org.slf4j.MDC;

@Component("userKafkaMessageBroker")
public class UserKafkaMessageBroker implements MessageBroker {

  @Value("${topics.user-created}")
  private String usercreatedTopic;

  private final KafkaTemplate<String, Object> kafkaTemplate;

  public UserKafkaMessageBroker(KafkaTemplate<String, Object> kafkaTemplate) {
    this.kafkaTemplate = kafkaTemplate;
  }

  @Override
  public void publishUserCreatedEvent(UserCreatedEvent event) {
    EventEnvelope<UserCreatedEvent> envelope = EventEnvelope.of(
      usercreatedTopic,
      event,
      MDC.get("correlationId")
    );
    kafkaTemplate.send(usercreatedTopic, envelope);
  }
}
```

> `EventEnvelope.of(topic, payload, correlationId)` wraps the event with routing metadata and the current MDC correlation ID for distributed tracing.

## Configuration Added

```yaml
# parameters/local/kafka.yaml
spring.kafka:
  topics:
    user-created: USER_CREATED
```

The same entry is added to every environment (`local`, `develop`, `test`, `production`).

## Usage in a Command Handler

Inject `MessageBroker` (the port, not the Kafka class) and call the publish method:

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

        messageBroker.publishUserCreatedEvent(
            new UserCreatedEvent(/* fill fields */)
        );
    }
}
```

## Bean Naming

The adapter is registered with an explicit bean name to avoid conflicts when multiple modules have a `MessageBroker`:

| Module | Bean name |
|--------|-----------|
| `user` | `userKafkaMessageBroker` |
| `order` | `orderKafkaMessageBroker` |
| `product` | `productKafkaMessageBroker` |

Spring resolves the correct adapter for each module via constructor injection by type + qualifier if needed.

## See Also

- [generate-kafka-listener](./GENERATE_KAFKA_LISTENER.md) — Create Kafka event consumer
- [add-kafka-client](./ADD_MODULE.md) — Install Kafka dependencies
- [generate-usecase](./GENERATE_USECASE.md) — Create use case handlers
