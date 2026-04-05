# Command `add rabbitmq-client`

## Description

Adds RabbitMQ client support to an existing eva4j project. Installs Spring AMQP dependencies, generates configuration files for all environments, creates the `RabbitMQConfig.java` class with production-ready defaults, and adds a RabbitMQ service to `docker-compose.yaml`.

## Purpose

Enable asynchronous event-driven communication between modules or microservices using RabbitMQ as the message broker. This command sets up the foundational infrastructure so that subsequent commands (`eva g rabbitmq-event`, `eva g rabbitmq-listener`) can generate producers and consumers.

## Syntax

```bash
eva add rabbitmq-client
```

No parameters required.

## Prerequisites

- Must be inside an eva4j project (created with `eva create`)
- At least one module must exist (created with `eva add module`)
- **Kafka must NOT be installed** — only one broker per project is allowed

## What It Generates

### 1. build.gradle Dependencies

```groovy
// RabbitMQ
implementation 'org.springframework.boot:spring-boot-starter-amqp'
testImplementation 'org.springframework.amqp:spring-rabbit-test'
```

### 2. Configuration Files (per environment)

**`parameters/local/rabbitmq.yaml`:**
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
```

**`parameters/production/rabbitmq.yaml`:**
```yaml
spring:
  rabbitmq:
    host: ${RABBITMQ_HOST}
    port: ${RABBITMQ_PORT:5672}
    username: ${RABBITMQ_USERNAME}
    password: ${RABBITMQ_PASSWORD}
    virtual-host: ${RABBITMQ_VHOST:/}
    connection-timeout: 5000
    requested-heartbeat: 60
    publisher-confirm-type: correlated
    publisher-returns: true
    ssl:
      enabled: ${RABBITMQ_SSL_ENABLED:false}
    cache:
      channel:
        size: 25
    template:
      mandatory: true
    listener:
      simple:
        acknowledge-mode: manual
        concurrency: 5
        max-concurrency: 20
        prefetch: 10
        retry:
          enabled: true
          max-attempts: 5
          initial-interval: 2000
          multiplier: 2.0
```

### 3. RabbitMQConfig.java

Located at `shared/infrastructure/configurations/rabbitmqConfig/RabbitMQConfig.java`.

Includes:
- `Jackson2JsonMessageConverter` for JSON serialization
- `RabbitAdmin` for auto-declaring exchanges, queues, and bindings
- `RabbitTemplate` with publisher confirms + returns
- `SimpleRabbitListenerContainerFactory` with manual ack mode and exponential backoff retry

### 4. Docker Compose Service

```yaml
rabbitmq:
  image: rabbitmq:4-management
  container_name: <project>-rabbitmq
  ports:
    - "5672:5672"       # AMQP protocol
    - "15672:15672"     # Management UI
  environment:
    RABBITMQ_DEFAULT_USER: guest
    RABBITMQ_DEFAULT_PASS: guest
    RABBITMQ_DEFAULT_VHOST: /
```

### 5. Application YAML Imports

Adds `rabbitmq.yaml` to the Spring config import chain in all `application-{env}.yaml` files:

```yaml
spring:
  config:
    import:
      - "classpath:parameters/local/rabbitmq.yaml"
```

## Generated Files Summary

```
project/
├── build.gradle                                          # + AMQP dependencies
├── docker-compose.yaml                                   # + RabbitMQ service
├── src/main/java/.../shared/
│   └── infrastructure/configurations/rabbitmqConfig/
│       └── RabbitMQConfig.java                           # Core config class
└── src/main/resources/
    ├── application-local.yaml                            # + rabbitmq.yaml import
    ├── application-develop.yaml                          # + rabbitmq.yaml import
    ├── application-test.yaml                             # + rabbitmq.yaml import
    ├── application-production.yaml                       # + rabbitmq.yaml import
    └── parameters/
        ├── local/rabbitmq.yaml                           # Local config
        ├── develop/rabbitmq.yaml                         # Develop config
        ├── test/rabbitmq.yaml                            # Test config
        └── production/rabbitmq.yaml                      # Production config
```

## Mutual Exclusivity with Kafka

Only **one** message broker is allowed per project:

```bash
eva add kafka-client       # ✅ Installs Kafka
eva add rabbitmq-client    # ❌ Error: Kafka client is already installed

# Or vice versa:
eva add rabbitmq-client    # ✅ Installs RabbitMQ
eva add kafka-client       # ❌ Error: RabbitMQ client is already installed
```

To switch brokers, you must manually remove the existing broker's dependencies, config files, and feature flag from `.eva4j.json`.

## After Installation

### Start RabbitMQ

```bash
docker-compose up -d
```

### Access Management UI

Open `http://localhost:15672` — credentials: `guest` / `guest`.

### Generate Events and Listeners

```bash
# Create an event producer
eva g rabbitmq-event user user-created

# Create an event consumer
eva g rabbitmq-listener notification
```

### Or use domain.yaml

Declare events in `domain.yaml` and run `eva g entities <module>` — all RabbitMQ infrastructure is auto-wired when `rabbitmq-client` is installed.

## See Also

- [`generate rabbitmq-event`](./GENERATE_RABBITMQ_EVENT.md) — Create event publisher
- [`generate rabbitmq-listener`](./GENERATE_RABBITMQ_LISTENER.md) — Create event consumer
- [`generate kafka-event`](./GENERATE_KAFKA_EVENT.md) — Kafka equivalent
- [RabbitMQ Production Config](../RABBITMQ_PRODUCTION_CONFIG.md) — Detailed parameter reference
