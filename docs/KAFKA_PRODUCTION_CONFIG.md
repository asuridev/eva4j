# Configuración Kafka para Producción

Guía de referencia para la configuración de `kafka.yaml` por entorno en proyectos generados con eva4j (Spring Kafka).

---

## Configuración generada por entorno

eva4j genera templates `kafka.yaml` diferenciados por entorno. Los valores de desarrollo local priorizan simplicidad; los de producción priorizan fiabilidad, seguridad y throughput.

> **Nota:** Si se despliega con el perfil `local` en producción, la aplicación usará `localhost:9092`, `trusted.packages: "*"`, y reintentos mínimos. Siempre activar el perfil `production` en entornos reales.

---

## Configuración completa recomendada

### Desarrollo local (`parameters/local/kafka.yaml`)

```yaml
spring:
  kafka:
    bootstrap-servers:
      - localhost:9092
    producer:
      properties:
        spring.json.add.type.headers: false
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      retries: 3
    consumer:
      group-id: my-app-api-group
      auto-offset-reset: earliest
      enable-auto-commit: false
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "*"
        spring.json.use.type.headers: false
        spring.json.value.default.type: com.example.shared.infrastructure.eventEnvelope.EventEnvelope
    listener:
      ack-mode: manual
      concurrency: 3
      retry:
        max-attempts: 2
        backoff-delay: 1500

kafka:
  topic-defaults:
    partitions: 3
    replicas: 1
```

### Test (`parameters/test/kafka.yaml`)

```yaml
spring:
  kafka:
    bootstrap-servers:
      - localhost:9092
    producer:
      properties:
        spring.json.add.type.headers: false
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      retries: 1
    consumer:
      group-id: my-app-test-group
      auto-offset-reset: earliest
      enable-auto-commit: false
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "*"
        spring.json.use.type.headers: false
        spring.json.value.default.type: com.example.shared.infrastructure.eventEnvelope.EventEnvelope
        max.poll.records: 10
    listener:
      ack-mode: manual
      concurrency: 1
      retry:
        max-attempts: 1
        backoff-delay: 100

kafka:
  topic-defaults:
    partitions: 1
    replicas: 1
```

### Producción (`parameters/production/kafka.yaml`)

```yaml
spring:
  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS}
    producer:
      properties:
        spring.json.add.type.headers: false
        enable.idempotence: true
        max.in.flight.requests.per.connection: 5
        delivery.timeout.ms: 120000
        request.timeout.ms: 30000
        linger.ms: 5
        batch.size: 32768
        compression.type: snappy
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
      acks: all
      retries: 10
    consumer:
      group-id: ${spring.application.name}-group
      auto-offset-reset: earliest
      enable-auto-commit: false
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "com.example.**"
        spring.json.use.type.headers: false
        spring.json.value.default.type: com.example.shared.infrastructure.eventEnvelope.EventEnvelope
        max.poll.records: 50
        max.poll.interval.ms: 300000
        session.timeout.ms: 30000
        heartbeat.interval.ms: 10000
      fetch-min-size: 1
      fetch-max-wait: 500
    listener:
      ack-mode: manual
      concurrency: 5
      retry:
        max-attempts: 5
        backoff-delay: 2000
        backoff-multiplier: 2.0
        backoff-max-delay: 30000
    # SSL/SASL — descomentar si el cluster lo requiere
    # security:
    #   protocol: SASL_SSL
    # properties:
    #   sasl.mechanism: PLAIN
    #   sasl.jaas.config: >-
    #     org.apache.kafka.common.security.plain.PlainLoginModule required
    #     username="${KAFKA_USERNAME}"
    #     password="${KAFKA_PASSWORD}";
    #   ssl.truststore.location: ${KAFKA_TRUSTSTORE_LOCATION}
    #   ssl.truststore.password: ${KAFKA_TRUSTSTORE_PASSWORD}

kafka:
  topic-defaults:
    partitions: 3
    replicas: 3
```

---

## Referencia de parámetros

### Conexión

| Parámetro | Valor por defecto | Valor configurado (local) | Recomendado producción | Descripción |
|---|---|---|---|---|
| `bootstrap-servers` | `localhost:9092` | `localhost:9092` | `${KAFKA_BOOTSTRAP_SERVERS}` | Lista de brokers Kafka para el descubrimiento inicial del cluster. En producción debe venir de variable de entorno. Listar al menos 2-3 brokers para tolerancia a fallos: `broker1:9092,broker2:9092,broker3:9092`. |

> **Regla:** Nunca hardcodear direcciones de brokers en producción. Un solo broker en la lista es un punto único de fallo.

---

### Producer (publicación de eventos)

| Parámetro | Valor por defecto Spring | Valor configurado | Recomendado producción | Descripción |
|---|---|---|---|---|
| `key-serializer` | `StringSerializer` | `StringSerializer` | `StringSerializer` | Serializador para las claves de los mensajes Kafka. `StringSerializer` es el estándar para claves basadas en IDs de entidad. |
| `value-serializer` | `StringSerializer` | `JsonSerializer` | `JsonSerializer` | Serializador para el cuerpo del mensaje. `JsonSerializer` convierte los objetos Java a JSON automáticamente. |
| `spring.json.add.type.headers` | `true` | `false` | `false` | Si `true`, agrega headers `__TypeId__` con la clase Java del payload. Con `false`, el JSON es genérico y no acopla al consumidor con tipos Java del productor. **Crítico** para comunicación entre microservicios con diferentes classpaths. |
| `retries` | `2147483647` (MAX_INT) | `3` | `10` | Número de reintentos automáticos cuando falla el envío (error de red, líder no disponible, etc.). Con `3` en local es suficiente; en producción usar `10` combinado con `delivery.timeout.ms` para controlar el tiempo total de reintento. |
| `acks` | `all` (desde Kafka 3.0) | *no configurado* | `all` | Nivel de confirmación del broker. `0`: fire-and-forget. `1`: solo el líder confirma. `all` (`-1`): todos los ISR (in-sync replicas) confirman. **Obligatorio** para at-least-once delivery. |

#### Propiedades avanzadas del producer (producción)

| Propiedad | Valor por defecto Kafka | Recomendado | Descripción |
|---|---|---|---|
| `enable.idempotence` | `true` (Kafka 3.0+) | `true` | Garantiza que un mensaje reintentado no produzca duplicados en el broker. Requiere `acks=all` y `max.in.flight.requests.per.connection ≤ 5`. Es la base de **exactly-once semantics** en el productor. |
| `max.in.flight.requests.per.connection` | `5` | `5` | Número máximo de batches enviados sin confirmación. Con idempotencia activa, Kafka garantiza orden incluso con `5`. Sin idempotencia, usar `1` para mantener orden estricto. |
| `delivery.timeout.ms` | `120000` (2 min) | `120000` | Tiempo total máximo en ms para entregar un mensaje (incluyendo todos los reintentos). Si se agota, el envío falla con `TimeoutException`. Prevalece sobre `retries` × `retry.backoff.ms`. |
| `request.timeout.ms` | `30000` | `30000` | Tiempo máximo de espera por una respuesta del broker a un request individual. Si se excede, se considera el request como fallido y se contabiliza un reintento. |
| `linger.ms` | `0` | `5` | Milisegundos de espera antes de enviar un batch, acumulando más mensajes. `0` = envío inmediato (baja latencia). `5` = micro-batching que mejora throughput un 10-30% sin latencia perceptible. |
| `batch.size` | `16384` (16 KB) | `32768` (32 KB) | Tamaño máximo en bytes del batch de mensajes acumulados por partición. Incrementar mejora throughput en escenarios de alto volumen. |
| `compression.type` | `none` | `snappy` | Compresión de los batches. `snappy`: buen balance entre CPU y compresión (~50% reducción). `lz4`: más rápido, menos compresión. `gzip`: más compresión, más CPU. `zstd`: mejor ratio pero más CPU. |

---

### Consumer (consumo de eventos)

| Parámetro | Valor por defecto Spring | Valor configurado | Recomendado producción | Descripción |
|---|---|---|---|---|
| `group-id` | *ninguno* (obligatorio) | `test-eva-api-group` | `${spring.application.name}-group` | Identificador del consumer group. Todos los consumidores con el mismo `group-id` comparten la carga de los topics suscritos. **Parametrizar** con el nombre de la aplicación para que sea único por servicio. |
| `auto-offset-reset` | `latest` | `earliest` | `earliest` | Comportamiento cuando no hay offset previo almacenado. `earliest`: leer desde el inicio (no perder mensajes). `latest`: leer solo mensajes nuevos. `earliest` es más seguro para **no perder eventos** en el primer arranque o tras expiración de offsets. |
| `enable-auto-commit` | `true` | `false` | `false` | Si `true`, los offsets se confirman automáticamente cada `auto.commit.interval.ms` (5s por defecto). **Riesgo**: si la app falla después del auto-commit pero antes de procesar, el mensaje se pierde. `false` + `ack-mode: manual` es la combinación segura. |
| `key-deserializer` | `StringDeserializer` | `StringDeserializer` | `StringDeserializer` | Deserializador de claves. Debe coincidir con el `key-serializer` del productor. |
| `value-deserializer` | `StringDeserializer` | `JsonDeserializer` | `JsonDeserializer` | Deserializador del cuerpo. `JsonDeserializer` convierte el JSON a objetos Java usando Jackson. |

#### Propiedades del consumer

| Propiedad | Valor por defecto Kafka | Valor configurado | Recomendado producción | Descripción |
|---|---|---|---|---|
| `spring.json.trusted.packages` | *ninguno* (nada confiable) | `"*"` | Paquete base del proyecto | Paquetes Java cuyos tipos se permite deserializar. `"*"` confía en **todos los tipos** — riesgo de deserialización de clases maliciosas si un atacante inyecta un `__TypeId__` header. En producción, restringir al paquete del EventEnvelope: `"com.example.shared.infrastructure.eventEnvelope"`. |
| `spring.json.use.type.headers` | `true` | `false` | `false` | Si `true`, el deserializador usa el header `__TypeId__` para determinar la clase destino. Con `false`, usa el `default.type` fijo. **Combinado con** `add.type.headers: false` en el productor, asegura deserialización predecible sin acoplamiento de tipos. |
| `spring.json.value.default.type` | *ninguno* | `...EventEnvelope` | `...EventEnvelope` | Clase Java por defecto para deserializar el payload cuando `use.type.headers: false`. Todos los mensajes se deserializan como `EventEnvelope`, que es la envolvente estándar de eva4j. |
| `max.poll.records` | `500` | *no configurado* | `50` | Número máximo de registros devueltos por cada llamada a `poll()`. Un valor alto procesa más rápido pero aumenta el riesgo de timeout si el procesamiento es lento. `50` es un buen balance para procesamiento con lógica de negocio. |
| `max.poll.interval.ms` | `300000` (5 min) | *no configurado* | `300000` | Tiempo máximo entre llamadas a `poll()` antes de que el consumer sea considerado muerto y se dispare un rebalanceo. Aumentar si los handlers tardan mucho; reducir para detectar consumidores bloqueados más rápido. |
| `session.timeout.ms` | `45000` | *no configurado* | `30000` | Tiempo sin heartbeat antes de que el broker considere al consumer muerto. Debe ser `>= 3 × heartbeat.interval.ms`. |
| `heartbeat.interval.ms` | `3000` | *no configurado* | `10000` | Intervalo entre heartbeats del consumer al coordinator. Permite detectar consumers muertos. Debe ser `< session.timeout.ms / 3`. |
| `fetch-min-size` | `1` | *no configurado* | `1` | Bytes mínimos que el broker acumula antes de responder a un fetch. `1` = responder inmediatamente (baja latencia). |
| `fetch-max-wait` | `500` | *no configurado* | `500` | Milisegundos máximos de espera del broker hasta alcanzar `fetch-min-size`. Balancea latencia vs throughput. |

> **Seguridad:** `spring.json.trusted.packages: "*"` es aceptable **solo** cuando `spring.json.use.type.headers: false`, porque el deserializador ignora los headers de tipo y siempre usa `default.type`. Aun así, en producción se recomienda restringir como defensa en profundidad.

---

### Listener (contenedor de consumo)

| Parámetro | Valor por defecto Spring Kafka | Valor configurado | Recomendado producción | Descripción |
|---|---|---|---|---|
| `ack-mode` | `BATCH` | `manual` | `manual` | Modo de confirmación de offsets. `BATCH`: confirma automáticamente por batch. `MANUAL`: el código invoca `ack.acknowledge()` explícitamente. `MANUAL` garantiza que solo se confirme después del procesamiento exitoso. ✅ Correctamente configurado. |
| `concurrency` | `1` | `3` | `5` | Número de hilos consumers (uno por partición asignada). Debe ser `≤` número de particiones del topic. Con `3` en local es adecuado; en producción `5` — ajustar según la cantidad de particiones. |

#### Retry del listener

| Parámetro | Valor por defecto | Valor configurado | Recomendado producción | Descripción |
|---|---|---|---|---|
| `retry.max-attempts` | `3` | `2` | `5` | Número total de intentos (incluido el primero). Con `2`, solo hay **1 reintento** — insuficiente para errores transitorios de red o base de datos. `5` da margen sin saturar. |
| `retry.backoff-delay` | `1000` | `1500` | `2000` | Milisegundos de espera antes del primer reintento. `1500` es razonable; `2000` da más margen para recuperación de dependencias. |
| `retry.backoff-multiplier` | `1.0` (lineal) | *no configurado* | `2.0` | Factor multiplicador entre reintentos. Sin multiplicador, todos los reintentos esperan lo mismo (1500ms). Con `2.0`: 2s → 4s → 8s → 16s (exponential backoff). **Previene** la tormenta de reintentos en cascada bajo fallo sistémico. |
| `retry.backoff-max-delay` | `30000` | *no configurado* | `30000` | Tope máximo del intervalo entre reintentos en ms. Evita esperas excesivas con muchos reintentos y multiplicador alto. |

---

### Topics

| Clave YAML (kebab-case) | Valor (SCREAMING_SNAKE_CASE) | Descripción |
|---|---|---|
| `product-created` | `PRODUCT_CREATED` | Topic para eventos de creación de producto |
| `product-updated` | `PRODUCT_UPDATED` | Topic para eventos de actualización de producto |
| `product-deactivated` | `PRODUCT_DEACTIVATED` | Topic para eventos de desactivación de producto |
| `customer-created` | `CUSTOMER_CREATED` | Topic para eventos de creación de cliente |
| `customer-updated` | `CUSTOMER_UPDATED` | Topic para eventos de actualización de cliente |
| `order-placed` | `ORDER_PLACED` | Topic para eventos de órdenes colocadas |
| `order-cancelled` | `ORDER_CANCELLED` | Topic para eventos de cancelación de órdenes |
| `payment-approved` | `PAYMENT_APPROVED` | Topic para eventos de pago aprobado |
| `payment-failed` | `PAYMENT_FAILED` | Topic para eventos de pago fallido |

La convención de naming eva4j usa **kebab-case** como clave Spring (`${topics.order-placed}`) y **SCREAMING_SNAKE_CASE** como nombre real del topic en el cluster Kafka.

> **Nota sobre particiones y replicación:** Los topics se crean vía `NewTopic` beans en `KafkaConfig.java`. Las particiones y réplicas se leen dinámicamente de `kafka.topic-defaults.partitions` y `kafka.topic-defaults.replicas` desde `kafka.yaml`, con valores por defecto de `3` y `1` respectivamente. Para producción, el template genera `replicas: 3` — el cluster debe tener al menos 3 brokers con `min.insync.replicas: 2`.

### Sección `kafka.topic-defaults`

Las particiones y réplicas de los `NewTopic` beans se parametrizan desde `kafka.yaml`:

| Entorno | `partitions` | `replicas` | Razón |
|---|---|---|---|
| local | 3 | 1 | Un solo broker en Docker |
| develop | 3 | 1 | Cluster de desarrollo mínimo |
| test | 1 | 1 | Tests deterministas, un solo consumer |
| production | 3 | 3 | Alta disponibilidad, tolerancia a fallo de broker |

`KafkaConfig.java` lee estos valores con:
```java
@Value("${kafka.topic-defaults.partitions:3}")
private int defaultPartitions;

@Value("${kafka.topic-defaults.replicas:1}")
private short defaultReplicas;
```

Cada `NewTopic` bean usa estos campos:
```java
@Bean
public NewTopic orderPlacedTopic() {
    return new NewTopic(orderPlacedTopic, defaultPartitions, defaultReplicas);
}
```

---

## Seguridad (SSL/SASL)

### Cuándo es necesario

| Escenario | Requiere SSL/SASL |
|---|---|
| Kafka en localhost / misma máquina | No |
| Kafka en red privada (VPC/VPN) | Recomendado |
| Kafka en red pública / cloud | **Obligatorio** |
| Confluent Cloud / Amazon MSK / Aiven | **Obligatorio** (SASL_SSL) |

### Configuración SASL_SSL

```yaml
spring:
  kafka:
    security:
      protocol: SASL_SSL
    properties:
      sasl.mechanism: PLAIN
      sasl.jaas.config: >-
        org.apache.kafka.common.security.plain.PlainLoginModule required
        username="${KAFKA_USERNAME}"
        password="${KAFKA_PASSWORD}";
      ssl.truststore.location: ${KAFKA_TRUSTSTORE_LOCATION}
      ssl.truststore.password: ${KAFKA_TRUSTSTORE_PASSWORD}
```

### Mecanismos SASL disponibles

| Mecanismo | Uso típico | Descripción |
|---|---|---|
| `PLAIN` | Confluent Cloud, desarrollo | Username/password sobre SSL. Simple pero suficiente con TLS. |
| `SCRAM-SHA-256/512` | Clusters self-hosted | Challenge-response, más seguro que PLAIN sin SSL. |
| `OAUTHBEARER` | Enterprise / SSO | OAuth 2.0 tokens. Para integración con identity providers. |

---

## Dead Letter Topic (DLT)

Spring Kafka soporta Dead Letter Topics para mensajes que agotan los reintentos. A diferencia de RabbitMQ (donde la DLQ se configura en el broker), en Kafka la DLT se configura en el **consumer**.

eva4j genera automáticamente `KafkaConfig.java` con `ExponentialBackOff` y `DeadLetterPublishingRecoverer`. Los reintentos se configuran desde `kafka.yaml`:

```java
@Value("${spring.kafka.listener.retry.max-attempts}")
private int maxAttempts;

@Value("${spring.kafka.listener.retry.backoff-delay}")
private long backoffDelay;

@Value("${spring.kafka.listener.retry.backoff-multiplier:1.0}")
private double backoffMultiplier;

@Value("${spring.kafka.listener.retry.backoff-max-delay:30000}")
private long backoffMaxDelay;

@Bean
public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactory(
    ConsumerFactory<String, String> consumerFactory,
    KafkaTemplate<Object, Object> kafkaTemplate) {

    var factory = new ConcurrentKafkaListenerContainerFactory<String, String>();
    factory.setConsumerFactory(consumerFactory);
    factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL_IMMEDIATE);

    DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(
        kafkaTemplate,
        (record, ex) -> new TopicPartition(record.topic() + ".DLT", record.partition())
    );

    // ExponentialBackOff: con multiplier=1.0 (local) se comporta como FixedBackOff
    // Con multiplier=2.0 (producción): 2s → 4s → 8s → 16s → 30s (max)
    ExponentialBackOff backOff = new ExponentialBackOff(backoffDelay, backoffMultiplier);
    backOff.setMaxInterval(backoffMaxDelay);
    backOff.setMaxAttempts(maxAttempts);

    DefaultErrorHandler errorHandler = new DefaultErrorHandler(recoverer, backOff);
    factory.setCommonErrorHandler(errorHandler);
    return factory;
}
```

> Cuando un mensaje agota los reintentos, se publica automáticamente en el topic `{original-topic}.DLT`. No requiere configuración adicional.

---

## Diferencias por entorno

| Parámetro | local/develop | test | producción |
|---|---|---|---|
| `bootstrap-servers` | `localhost:9092` | `localhost:9092` | `${KAFKA_BOOTSTRAP_SERVERS}` |
| `group-id` | `{app}-api-group` | `{app}-test-group` | `${spring.application.name}-group` |
| `trusted.packages` | `"*"` | `"*"` | `"{packageName}.**"` |
| `security.protocol` | — | — | `SASL_SSL` (comentado) |
| `producer.acks` | *default* | *default* | `all` |
| `producer.retries` | `3` | `1` | `10` |
| `enable.idempotence` | *default* | *default* | `true` (explícito) |
| `compression.type` | — | — | `snappy` |
| `listener.concurrency` | `3` | `1` | `5` |
| `retry.max-attempts` | `2` | `1` | `5` |
| `retry.backoff-delay` | `1500` | `100` | `2000` |
| `retry.backoff-multiplier` | *1.0 (default)* | *1.0 (default)* | `2.0` |
| `retry.backoff-max-delay` | *30000 (default)* | *30000 (default)* | `30000` |
| `max.poll.records` | *500 (default)* | `10` | `50` |
| `topic-defaults.partitions` | `3` | `1` | `3` |
| `topic-defaults.replicas` | `1` | `1` | `3` |

---

## Checklist de producción

- [ ] `bootstrap-servers` en variable de entorno (lista de múltiples brokers)
- [ ] `group-id` parametrizado con `${spring.application.name}`
- [ ] `spring.json.trusted.packages` restringido al paquete del proyecto
- [ ] `acks: all` configurado en el producer
- [ ] `enable.idempotence: true` explícito
- [ ] `retries: 10` + `delivery.timeout.ms: 120000`
- [ ] `compression.type: snappy` para reducir ancho de banda
- [ ] `enable-auto-commit: false` + `ack-mode: manual`
- [ ] `retry.max-attempts: 5` con `backoff-multiplier: 2.0`
- [ ] `max.poll.records` ajustado según velocidad de procesamiento
- [ ] `session.timeout.ms` y `heartbeat.interval.ms` configurados
- [ ] SSL/SASL configurado si el broker no está en red privada
- [ ] Dead Letter Topic configurado para mensajes irrecuperables
- [ ] Al menos 3 particiones y factor de replicación 3 en topics de producción (`kafka.topic-defaults`)
- [ ] Monitoreo con métricas de consumer lag (Prometheus / Grafana / Confluent Control Center)

---

**Versión:** 1.1  
**Última actualización:** 2026-04-05
