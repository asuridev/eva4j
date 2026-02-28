# GENERATE KAFKA LISTENER

## Description

The `generate kafka-listener` command creates individual Kafka listener classes in a module's infrastructure layer. Each listener class is dedicated to a single topic, following the **Open/Closed Principle** for better maintainability and scalability.

The command generates Spring Kafka `@KafkaListener` components that automatically consume events from configured topics, deserialize them into `EventEnvelope` objects, and provide integration with the `UseCaseMediator` for processing.

**Key Feature:** Each topic gets its own listener class (e.g., `UserUserCreatedListener.java`, `OrderOrderPlacedListener.java`), with module-prefixed names to avoid bean conflicts when multiple modules subscribe to the same event.

---

## Purpose

- **Create Kafka consumers** to receive events from external systems
- **Process async events** using Spring Kafka listeners
- **Follow Open/Closed Principle** with individual listener classes per topic
- **Integrate with CQRS** architecture via UseCaseMediator
- **Acknowledge messages** automatically with manual commit mode
- **Support multiple topics** by generating multiple listener classes
- **Enable event-driven communication** between microservices

---

## Syntax

```bash
eva generate kafka-listener <module>
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `module` | Yes | Name of the module where listener will be created |

### Interactive Prompts

After running the command, you'll be prompted to:

1. **Select topics to listen to** (multiple selection with space bar)
   - Topics are read from `kafka.yaml` configuration
   - Must select at least one topic
   - Can select multiple topics at once

---

## Prerequisites

### 1. Kafka Client Must Be Installed

```bash
eva add kafka-client
```

This configures:
- Spring Kafka dependencies
- Kafka consumer configuration
- Topic management in `kafka.yaml`
- EventEnvelope infrastructure

### 2. Topics Must Exist in kafka.yaml

Topics are defined in: `src/main/resources/parameters/local/kafka.yaml`

```yaml
topics:
  user-created: user.events.created
  order-placed: order.events.placed
  payment-processed: payment.events.processed
```

**Tip:** Generate topics using:
```bash
eva generate kafka-event <module> <event-name>
```

---

## Examples

### Example 1: Basic Listener Creation

```bash
# Create listeners in 'user' module
eva generate kafka-listener user

# Select topics from interactive menu:
# ✓ user-created (user.events.created)
# ✓ user-updated (user.events.updated)
```

**Generated:**
```
user/infrastructure/kafkaListener/
├── UserUserCreatedListener.java
└── UserUserUpdatedListener.java
```

**Note:** Listener class names include module prefix (User + UserCreated = UserUserCreatedListener) to avoid bean name conflicts when multiple modules subscribe to the same event.

**Generated code for UserUserCreatedListener.java:**
```java
package com.example.user.infrastructure.kafkaListener;

import com.example.shared.infrastructure.configurations.useCaseConfig.UseCaseMediator;
import com.example.shared.infrastructure.eventEnvelope.EventEnvelope;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Kafka listener for user-created topic
 * Processes events from user.events.created
 */
@Component("userUserCreatedListener")
public class UserUserCreatedListener {

    private final UseCaseMediator useCaseMediator;

    @Value("${topics.user-created}")
    private String userCreatedTopic;

    public UserUserCreatedListener(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    @KafkaListener(topics = "${topics.user-created}")
    public void handle(EventEnvelope<Map<String, Object>> event, Acknowledgment ack) {
        // TODO: Implement event processing logic
        // Example: useCaseMediator.dispatch(new YourCommand(event.data()));
        
        ack.acknowledge(); // Confirm successful processing
    }

}
```

---

### Example 2: Adding More Listeners

```bash
# Run command again to add more listeners
eva generate kafka-listener order

# Select additional topics:
# ✓ order-shipped (order.events.shipped)
# ✓ payment-processed (payment.events.processed)
```

**Result:** New listener classes are **created independently**:

```
order/infrastructure/kafkaListener/
├── OrderOrderShippedListener.java
└── OrderPaymentProcessedListener.java
```

**Note:** Even if payment-processed event was created in the payment module, each listener class is named with the consuming module's prefix (Order + PaymentProcessed = OrderPaymentProcessedListener).

---

### Example 3: Multiple Modules Subscribing to Same Event

**Scenario:** Both `user` and `notification` modules want to listen to `user-created` event.

```bash
# In user module
eva generate kafka-listener user
# Select: user-created
# Generates: UserUserCreatedListener.java

# In notification module
eva generate kafka-listener notification
# Select: user-created
# Generates: NotificationUserCreatedListener.java
```

**Result:** No bean name conflicts! Each module has its own listener:

**Benefits of individual classes:**
- ✅ **Open/Closed Principle**: Add new listeners without modifying existing code
- ✅ **Single Responsibility**: Each class handles one topic
- ✅ **Easy Testing**: Test each listener independently
- ✅ **Clear Naming**: Class name indicates what it listens to

---

### Example 3: Processing Events with Use Cases

**Implement event processing in generated listener:**

```java
// UserCreatedListener.java
@Component
public class UserCreatedListener {

    private final UseCaseMediator useCaseMediator;

    @Value("${topics.user-created}")
    private String userCreatedTopic;

    public UserCreatedListener(UseCaseMediator useCaseMediator) {
        this.useCaseMediator = useCaseMediator;
    }

    @KafkaListener(topics = "${topics.user-created}")
    public void handle(EventEnvelope<Map<String, Object>> event, Acknowledgment ack) {
        try {
            // Extract data from event
            String userId = (String) event.data().get("userId");
            String email = (String) event.data().get("email");
            
            // Create command for use case
            CreateWelcomeEmailCommand command = new CreateWelcomeEmailCommand(userId, email);
            
            // Dispatch to use case via mediator
            useCaseMediator.dispatch(command);
            
            // Acknowledge successful processing
            ack.acknowledge();
            
        } catch (Exception e) {
            // Handle error (event will be reprocessed by Kafka)
            throw new RuntimeException("Failed to process user-created event", e);
        }
    }
}
```

---

### Example 4: Multiple Modules Listening to Same Topic

```bash
# Notification module listens to user-created
eva generate kafka-listener notification
# Select: user-created

# Analytics module also listens to user-created
eva generate kafka-listener analytics
# Select: user-created
```

**Result:** Both modules independently consume the same Kafka topic.

---

## Generated Structure

```
<module>/
└── infrastructure/
    └── kafkaListener/
        ├── <Module><Topic>Listener.java      # Individual listener per topic
        ├── UserUserCreatedListener.java      # User module listening to user-created
        ├── OrderOrderPlacedListener.java     # Order module listening to order-placed
        └── NotificationUserCreatedListener.java  # Notification module listening to user-created
```

**Note:** Class names follow pattern: `{ModuleName}{TopicName}Listener` to prevent Spring bean conflicts.

### Components

#### 1. **Individual Listener Classes** (e.g., `UserUserCreatedListener.java`)

**Purpose:** Spring component dedicated to consuming events from a single Kafka topic

**Key Features:**
- `@Component("beanName")` - Spring-managed bean with explicit unique name
- `@KafkaListener` - Listens to one specific topic
- `@Value` - Injects topic name from configuration
- `UseCaseMediator` - Integration with CQRS commands
- `Acknowledgment` - Manual commit control
- **Single Responsibility**: Each class handles only one topic
- **Open/Closed Principle**: Add new listeners without modifying existing ones
- **Module-Prefixed Naming**: Prevents bean conflicts across modules

**Class Naming Pattern:**
- Module: `user`, Topic: `user-created` → Class: `UserUserCreatedListener`
- Module: `notification`, Topic: `user-created` → Class: `NotificationUserCreatedListener`
- Module: `order`, Topic: `order-placed` → Class: `OrderOrderPlacedListener`

**Method Naming:**
- All listeners use the same method: `handle()`

---

## Configuration

### kafka.yaml Structure

Location: `src/main/resources/parameters/local/kafka.yaml`

```yaml
bootstrap-servers: localhost:9092

topics:
  # Pattern: topic-key: actual.kafka.topic.name
  user-created: user.events.created
  order-placed: order.events.placed
  payment-processed: payment.events.processed
```

### Environment-Specific Configuration

```yaml
# parameters/local/kafka.yaml
bootstrap-servers: localhost:9092
topics:
  user-created: dev.user.events.created

# parameters/prod/kafka.yaml
bootstrap-servers: kafka-cluster.prod:9092
topics:
  user-created: prod.user.events.created
```

---

## How It Works

### 1. Command Execution Flow

```
User runs command
    ↓
Validates eva project
    ↓
Checks Kafka client installed
    ↓
Validates module exists
    ↓
Reads available topics from kafka.yaml
    ↓
Prompts user to select topics (multi-select)
    ↓
For each selected topic:
    ├── Generate listener class name (e.g., UserUserCreatedListener = User module + UserCreated topic)
    ├── Generate bean name (e.g., userUserCreatedListener)
    ├── Check if listener class already exists
    │   ├── YES → Skip (show warning)
    │   └── NO → Create new listener class
    ├── Generate @Value field for topic
    └── Generate handle() method with @KafkaListener
```

### 2. Runtime Event Processing Flow

```
Kafka topic receives event
    ↓
Spring Kafka deserializes to EventEnvelope<Map<String, Object>>
    ↓
Corresponding listener class's handle() method invoked
    ↓
Extract data from event.data()
    ↓
Create command/query object
    ↓
Dispatch to UseCaseMediator
    ↓
Use case processes event
    ↓
Call ack.acknowledge() to commit offset
```

---

## EventEnvelope Structure

Events are automatically deserialized into:

```java
public record EventEnvelope<T>(
    String eventId,
    String eventType,
    String eventSource,
    LocalDateTime timestamp,
    T data
) {}
```

**Example JSON received from Kafka:**

```json
{
  "eventId": "evt-12345",
  "eventType": "UserCreated",
  "eventSource": "user-service",
  "timestamp": "2026-02-04T10:30:00",
  "data": {
    "userId": "usr-001",
    "email": "john@example.com",
    "name": "John Doe"
  }
}
```

**Access in listener:**

```java
void handleUserCreatedListener(EventEnvelope<Map<String, Object>> event, Acknowledgment ack) {
    String userId = (String) event.data().get("userId");
    String email = (String) event.data().get("email");
    
    // Process event...
}
```

---

## Best Practices

### ✅ DO

1. **Always acknowledge after successful processing**
   ```java
   ack.acknowledge(); // Commits Kafka offset
   ```

2. **Use try-catch for error handling**
   ```java
   try {
       // Process event
       ack.acknowledge();
   } catch (Exception e) {
       // Log error, event will be reprocessed
       throw new RuntimeException("Processing failed", e);
   }
   ```

3. **Delegate to use cases via UseCaseMediator**
   ```java
   useCaseMediator.dispatch(new ProcessOrderCommand(data));
   ```

4. **Validate event data before processing**
   ```java
   if (event.data().get("userId") == null) {
       throw new IllegalArgumentException("Missing userId");
   }
   ```

5. **Use idempotent operations** (same event processed multiple times = same result)

### ❌ DON'T

1. **Don't acknowledge before processing**
   ```java
   ack.acknowledge(); // ❌ Don't do this first
   processEvent(event); // If this fails, event is lost
   ```

2. **Don't perform long-running operations synchronously**
   ```java
   // ❌ Bad - blocks Kafka consumer
   sendEmailSynchronously(email);
   
   // ✅ Good - async processing
   useCaseMediator.dispatch(new SendEmailCommand(email));
   ```

3. **Don't catch and swallow exceptions**
   ```java
   try {
       processEvent(event);
   } catch (Exception e) {
       // ❌ Don't do this - event will be lost
       e.printStackTrace();
       ack.acknowledge();
   }
   ```

4. **Each listener class handles one topic** - Follows Single Responsibility Principle

5. **Add new listeners without modifying existing code** - Follows Open/Closed Principle

---

## Common Use Cases

### 1. **Notification Service**

```bash
eva generate kafka-listener notification

# Listen to events from other services:
# ✓ user-created (send welcome email)
# ✓ order-placed (send order confirmation)
# ✓ payment-processed (send payment receipt)
```

### 2. **Analytics/Audit Service**

```bash
eva generate kafka-listener analytics

# Listen to all domain events:
# ✓ user-created
# ✓ user-updated
# ✓ user-deleted
# ✓ order-placed
# ✓ order-shipped
```

### 3. **Saga Orchestration**

```bash
eva generate kafka-listener order

# Listen to events from other services:
# ✓ payment-processed (complete order)
# ✓ inventory-reserved (prepare shipment)
# ✓ payment-failed (cancel order)
```

### 4. **Data Synchronization**

```bash
eva generate kafka-listener search

# Keep search index updated:
# ✓ product-created (index product)
# ✓ product-updated (update index)
# ✓ product-deleted (remove from index)
```

---

## Error Handling

### Automatic Retry (Default Behavior)

If you throw an exception without acknowledging:

```java
@KafkaListener(topics = "${topics.user-created}")
void handleUserCreatedListener(EventEnvelope<Map<String, Object>> event, Acknowledgment ack) {
    processEvent(event); // If this throws exception
    ack.acknowledge();   // This won't execute
    // Kafka will REDELIVER the event
}
```

### Dead Letter Topic (DLT)

For events that fail repeatedly, configure Dead Letter Topic in Kafka consumer config:

```java
// In your Kafka configuration
@Bean
public ConcurrentKafkaListenerContainerFactory<String, Object> kafkaListenerContainerFactory() {
    // ... existing config
    
    factory.setCommonErrorHandler(
        new DeadLetterPublishingRecoverer(kafkaTemplate,
            (record, ex) -> new TopicPartition("dead-letter-topic", 0)
        )
    );
    
    return factory;
}
```

---

## Troubleshooting

### ❌ "Kafka client is not installed"

**Solution:**
```bash
eva add kafka-client
```

### ❌ "No topics found in kafka.yaml"

**Solution:** Generate topics first:
```bash
eva generate kafka-event user user-created
```

Or manually add to `kafka.yaml`:
```yaml
topics:
  user-created: user.events.created
```

### ❌ "Module not found"

**Solution:** Verify module exists:
```bash
eva info
```

If missing, create module:
```bash
eva add module <module-name>
```

### ❌ Events not being consumed

**Checklist:**
1. Kafka server is running
2. Topic exists in Kafka cluster
3. Topic name in `kafka.yaml` matches actual Kafka topic
4. Consumer group is not paused
5. No deserialization errors in logs

**Test topic exists:**
```bash
kafka-topics --bootstrap-server localhost:9092 --list
```

### ❌ Duplicate event processing

**Solution:** Ensure idempotent operations or use event deduplication:

```java
@KafkaListener(topics = "${topics.user-created}")
void handleUserCreatedListener(EventEnvelope<Map<String, Object>> event, Acknowledgment ack) {
    // Check if event already processed
    if (eventRepository.existsByEventId(event.eventId())) {
        ack.acknowledge(); // Skip duplicate
        return;
    }
    
    // Process event
    processEvent(event);
    
    // Store event ID to prevent reprocessing
    eventRepository.save(new ProcessedEvent(event.eventId()));
    
    ack.acknowledge();
}
```

---

## Testing

### Manual Testing with Kafka Console Producer

```bash
# Produce test event to topic
kafka-console-producer --broker-list localhost:9092 --topic user.events.created

# Paste JSON event:
{
  "eventId": "test-123",
  "eventType": "UserCreated",
  "eventSource": "manual-test",
  "timestamp": "2026-02-04T10:30:00",
  "data": {
    "userId": "usr-test",
    "email": "test@example.com"
  }
}
```

### Integration Test Example

```java
@SpringBootTest
@EmbeddedKafka(topics = {"user.events.created"})
class UserUserCreatedListenerTest {
    
    @Autowired
    private KafkaTemplate<String, EventEnvelope<Map<String, Object>>> kafkaTemplate;
    
    @Autowired
    private UserUserCreatedListener listener;
    
    @Test
    void shouldConsumeUserCreatedEvent() throws Exception {
        // Given
        Map<String, Object> data = Map.of("userId", "usr-001", "email", "test@example.com");
        EventEnvelope<Map<String, Object>> event = new EventEnvelope<>(
            "evt-123", "UserCreated", "test", LocalDateTime.now(), data
        );
        
        // When
        kafkaTemplate.send("user.events.created", event).get();
        
        // Then
        Thread.sleep(2000); // Wait for async processing
        // Verify event was processed
    }
}
```

---

## Next Steps After Generation

1. **Implement processing logic** in generated listener methods
2. **Create use cases** for event processing
3. **Add error handling** for failed events
4. **Configure Dead Letter Topic** for unrecoverable failures
5. **Add monitoring/logging** for event consumption
6. **Write integration tests** with EmbeddedKafka
7. **Configure consumer groups** for scaling

---

## Related Commands

- [`add kafka-client`](ADD_MODULE.md#kafka-client) - Install Kafka infrastructure
- [`generate kafka-event`](GENERATE_KAFKA_EVENT.md) - Create Kafka event publisher
- [`generate usecase`](GENERATE_USECASE.md) - Create use cases to process events
- [`add module`](ADD_MODULE.md) - Create new module

---

## Additional Resources

- [Spring Kafka Documentation](https://spring.io/projects/spring-kafka)
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [Event-Driven Architecture Patterns](https://martinfowler.com/articles/201701-event-driven.html)
- [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html)
