# Command `generate kafka-event` (alias: `g kafka-event`)

## 📋 Description

Generates infrastructure for publishing domain events to Apache Kafka topics, enabling asynchronous event-driven communication between modules or microservices.

## 🎯 Purpose

Implement event-driven architecture by publishing domain events to Kafka, allowing other services to react to business events without direct coupling.

## 📝 Syntax

```bash
eva4j generate kafka-event <EventName>
eva4j g kafka-event <EventName>    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `EventName` | Yes | Name of the event (PascalCase, e.g., OrderCreated, PaymentProcessed) |

## 💡 Examples

### Example 1: Order Created Event

```bash
eva4j g kafka-event OrderCreated
```

### Example 2: Payment Processed Event

```bash
eva4j g kafka-event PaymentProcessed
```

### Example 3: User Registered Event

```bash
eva4j g kafka-event UserRegistered
```

## 📦 Generated Code Structure

```
<module>/
├── domain/
│   └── events/
│       └── OrderCreatedEvent.java              # Domain event
│
└── infrastructure/
    └── messaging/
        ├── events/
        │   └── OrderCreatedKafkaEvent.java     # Kafka DTO
        ├── publishers/
        │   └── OrderEventPublisher.java        # Event publisher
        └── config/
            └── KafkaProducerConfig.java        # Kafka configuration
```

## 📄 Generated Files

### 1. Domain Event

**OrderCreatedEvent.java:**
```java
package com.example.project.order.domain.events;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

/**
 * Domain event: OrderCreated
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class OrderCreatedEvent {
    
    private String eventId;
    private LocalDateTime occurredOn;
    
    // Add your event data here
    private Long orderId;
    private Long customerId;
    private String orderNumber;
    
    public OrderCreatedEvent(Long orderId, Long customerId, String orderNumber) {
        this.eventId = java.util.UUID.randomUUID().toString();
        this.occurredOn = LocalDateTime.now();
        this.orderId = orderId;
        this.customerId = customerId;
        this.orderNumber = orderNumber;
    }
}
```

### 2. Kafka Event DTO

**OrderCreatedKafkaEvent.java:**
```java
package com.example.project.order.infrastructure.messaging.events;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Kafka DTO for OrderCreated event
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class OrderCreatedKafkaEvent {
    
    private String eventId;
    private String occurredOn;
    private Long orderId;
    private Long customerId;
    private String orderNumber;
    
    // Add metadata
    private String eventType = "OrderCreated";
    private String version = "1.0";
}
```

### 3. Event Publisher

**OrderEventPublisher.java:**
```java
package com.example.project.order.infrastructure.messaging.publishers;

import com.example.project.order.domain.events.OrderCreatedEvent;
import com.example.project.order.infrastructure.messaging.events.OrderCreatedKafkaEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.stereotype.Component;

import java.util.concurrent.CompletableFuture;

/**
 * Publisher for Order events
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OrderEventPublisher {
    
    private final KafkaTemplate<String, OrderCreatedKafkaEvent> kafkaTemplate;
    
    private static final String ORDER_CREATED_TOPIC = "order.created";
    
    public void publishOrderCreated(OrderCreatedEvent event) {
        OrderCreatedKafkaEvent kafkaEvent = mapToKafkaEvent(event);
        
        CompletableFuture<SendResult<String, OrderCreatedKafkaEvent>> future = 
            kafkaTemplate.send(ORDER_CREATED_TOPIC, event.getOrderId().toString(), kafkaEvent);
        
        future.whenComplete((result, ex) -> {
            if (ex == null) {
                log.info("OrderCreated event published successfully: orderId={}, offset={}", 
                    event.getOrderId(), result.getRecordMetadata().offset());
            } else {
                log.error("Failed to publish OrderCreated event: orderId={}", 
                    event.getOrderId(), ex);
            }
        });
    }
    
    private OrderCreatedKafkaEvent mapToKafkaEvent(OrderCreatedEvent event) {
        return new OrderCreatedKafkaEvent(
            event.getEventId(),
            event.getOccurredOn().toString(),
            event.getOrderId(),
            event.getCustomerId(),
            event.getOrderNumber()
        );
    }
}
```

### 4. Kafka Configuration

**KafkaProducerConfig.java:**
```java
package com.example.project.order.infrastructure.messaging.config;

import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.core.ProducerFactory;
import org.springframework.kafka.support.serializer.JsonSerializer;

import java.util.HashMap;
import java.util.Map;

/**
 * Kafka producer configuration
 */
@Configuration
public class KafkaProducerConfig {
    
    @Value("${spring.kafka.bootstrap-servers}")
    private String bootstrapServers;
    
    @Bean
    public ProducerFactory<String, Object> producerFactory() {
        Map<String, Object> config = new HashMap<>();
        config.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        config.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        config.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, JsonSerializer.class);
        config.put(ProducerConfig.ACKS_CONFIG, "all");
        config.put(ProducerConfig.RETRIES_CONFIG, 3);
        config.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        return new DefaultKafkaProducerFactory<>(config);
    }
    
    @Bean
    public KafkaTemplate<String, Object> kafkaTemplate() {
        return new KafkaTemplate<>(producerFactory());
    }
}
```

## ✨ Features

### Event Publishing
- ✅ **Asynchronous** - Non-blocking event publishing
- ✅ **Idempotent** - Prevents duplicate events
- ✅ **Reliable** - Acknowledgment and retries
- ✅ **Partitioned** - Uses orderId as partition key
- ✅ **Logged** - Success/failure logging

### Event Structure
- ✅ **Event ID** - Unique identifier for deduplication
- ✅ **Timestamp** - When event occurred
- ✅ **Type** - Event type identifier
- ✅ **Version** - Schema versioning
- ✅ **Payload** - Business data

## 🔧 Configuration

### Application Properties

```yaml
# application.yml

spring:
  kafka:
    bootstrap-servers: localhost:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      retries: 3
      properties:
        enable.idempotence: true
        max.in.flight.requests.per.connection: 5

# Topic configuration
kafka:
  topics:
    order-created: order.created
    payment-processed: payment.processed
```

## 🎯 Usage Examples

### 1. Publish from Command Handler

```java
@Service
@RequiredArgsConstructor
public class CreateOrderCommandHandler {
    
    private final OrderRepository repository;
    private final OrderEventPublisher eventPublisher;
    
    @Transactional
    public OrderResponseDto handle(CreateOrderCommand command) {
        // Create order
        Order order = Order.create(command.getCustomerId(), command.getItems());
        Order savedOrder = repository.save(order);
        
        // Publish event
        OrderCreatedEvent event = new OrderCreatedEvent(
            savedOrder.getId(),
            savedOrder.getCustomerId(),
            savedOrder.getOrderNumber()
        );
        eventPublisher.publishOrderCreated(event);
        
        return OrderMapper.toDto(savedOrder);
    }
}
```

### 2. Publish from Domain Entity

```java
@Entity
public class Order {
    
    @Transient
    private final List<DomainEvent> domainEvents = new ArrayList<>();
    
    public static Order create(Long customerId, List<OrderItem> items) {
        Order order = new Order();
        order.setCustomerId(customerId);
        order.setItems(items);
        
        // Register domain event
        order.registerEvent(new OrderCreatedEvent(
            order.getId(),
            order.getCustomerId(),
            order.getOrderNumber()
        ));
        
        return order;
    }
    
    private void registerEvent(DomainEvent event) {
        domainEvents.add(event);
    }
    
    public List<DomainEvent> getDomainEvents() {
        return Collections.unmodifiableList(domainEvents);
    }
}

// In handler
@Transactional
public void handle(CreateOrderCommand command) {
    Order order = Order.create(command.getCustomerId(), command.getItems());
    Order savedOrder = repository.save(order);
    
    // Publish collected events
    savedOrder.getDomainEvents().forEach(event -> {
        if (event instanceof OrderCreatedEvent) {
            eventPublisher.publishOrderCreated((OrderCreatedEvent) event);
        }
    });
}
```

### 3. Publish Multiple Events

```java
@Service
@RequiredArgsConstructor
public class OrderEventPublisher {
    
    private final KafkaTemplate<String, Object> kafkaTemplate;
    
    public void publishOrderCreated(OrderCreatedEvent event) {
        kafkaTemplate.send("order.created", event.getOrderId().toString(), 
            mapToKafkaEvent(event));
    }
    
    public void publishOrderCancelled(OrderCancelledEvent event) {
        kafkaTemplate.send("order.cancelled", event.getOrderId().toString(),
            mapToKafkaEvent(event));
    }
    
    public void publishOrderShipped(OrderShippedEvent event) {
        kafkaTemplate.send("order.shipped", event.getOrderId().toString(),
            mapToKafkaEvent(event));
    }
}
```

## 🔄 Event-Driven Patterns

### 1. Event Notification

```java
// Order service publishes
eventPublisher.publishOrderCreated(event);

// Inventory service listens and reacts
@KafkaListener(topics = "order.created")
public void handleOrderCreated(OrderCreatedKafkaEvent event) {
    inventoryService.reserveStock(event.getOrderId());
}
```

### 2. Event-Carried State Transfer

```java
// Include all necessary data in event
public class OrderCreatedEvent {
    private Long orderId;
    private Long customerId;
    private List<OrderItem> items;  // Full state
    private BigDecimal totalAmount;
    private String shippingAddress;
}
```

### 3. Event Sourcing (Advanced)

```java
// Store events as source of truth
public class OrderEventStore {
    public void save(OrderCreatedEvent event) {
        // Persist event to event store
    }
    
    public Order rebuild(Long orderId) {
        // Replay events to rebuild state
        List<DomainEvent> events = loadEvents(orderId);
        return Order.fromEvents(events);
    }
}
```

## 🚀 Next Steps

After generating Kafka event infrastructure:

1. **Define event payload:**
   ```java
   public class OrderCreatedEvent {
       private Long orderId;
       private Long customerId;
       private BigDecimal totalAmount;
       private List<OrderItemDto> items;
   }
   ```

2. **Publish from business logic:**
   ```java
   eventPublisher.publishOrderCreated(event);
   ```

3. **Create listeners in other modules:**
   ```bash
   eva4j g kafka-listener OrderCreated
   ```

4. **Monitor events:**
   - Use Kafka UI (http://localhost:8080 if using docker-compose)
   - Check logs for publish confirmations

## ⚠️ Prerequisites

- Be in a project created with `eva4j create`
- Module must exist
- Kafka must be running (use `docker-compose up -d`)
- Spring Kafka dependency (automatically added)

## 🔍 Validations

The command validates:
- ✅ Valid eva4j project
- ✅ Event name is in PascalCase
- ✅ Module exists
- ✅ Kafka is configured

## 📚 See Also

- [generate-kafka-listener](./GENERATE_KAFKA_LISTENER.md) - Consume Kafka events
- [add-kafka-client](./ADD_KAFKA_CLIENT.md) - Add Kafka to module
- [generate-entities](./GENERATE_ENTITIES.md) - Generate domain models

## 🐛 Troubleshooting

**Error: "Kafka connection refused"**
- Solution: Ensure Kafka is running: `docker-compose up -d kafka`

**Events not appearing in topic**
- Solution: Check Kafka logs and verify topic exists
  ```bash
  docker exec -it kafka kafka-topics --list --bootstrap-server localhost:9092
  ```

**Serialization errors**
- Solution: Ensure event classes are serializable and have no-arg constructor

**Lost events**
- Solution: Configure appropriate `acks` and `retries`:
  ```yaml
  spring:
    kafka:
      producer:
        acks: all
        retries: 3
  ```
