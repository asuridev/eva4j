# Configuración RabbitMQ para Producción

Guía de referencia para la configuración de `rabbitmq.yaml` en entornos productivos con Spring Boot (Spring AMQP).

---

## Configuración completa recomendada

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
    channel-rpc-timeout: 10000
    publisher-confirm-type: correlated
    publisher-returns: true
    ssl:
      enabled: ${RABBITMQ_SSL_ENABLED:false}
      verify-hostname: true
    cache:
      channel:
        size: 25
        checkout-timeout: 0
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
          max-interval: 30000
          stateless: true
```

---

## Referencia de parámetros

### Conexión básica

| Parámetro | Valor por defecto | Descripción |
|---|---|---|
| `host` | `localhost` | Dirección del broker RabbitMQ. En producción debe venir de variable de entorno. |
| `port` | `5672` | Puerto AMQP estándar. Usar `5671` cuando SSL está activo. |
| `username` | `guest` | Usuario de autenticación. **El usuario `guest` solo puede conectar desde `127.0.0.1`**; en producción se rechaza si el broker está en otro host. |
| `password` | `guest` | Contraseña. Siempre desde variable de entorno en producción. |
| `virtual-host` | `/` | Virtual host de RabbitMQ. Permite aislar colas y exchanges entre aplicaciones en un mismo broker. |

> **Regla:** Nunca hardcodear credenciales. Usar `${ENV_VAR}` sin valor por defecto en producción para forzar que la variable esté declarada.

---

### Timeouts y heartbeat

| Parámetro | Valor por defecto | Recomendado producción | Descripción |
|---|---|---|---|
| `connection-timeout` | `0` (sin límite) | `5000` | Milisegundos máximos para establecer la conexión TCP con el broker. Un valor de `0` puede bloquear el arranque indefinidamente si el broker no está disponible. |
| `requested-heartbeat` | `60` | `60` | Segundos entre latidos TCP. Permite detectar conexiones muertas cuando no hay tráfico. Si un lado no recibe un heartbeat en `2 × valor` segundos, cierra la conexión. |
| `channel-rpc-timeout` | `10000` | `10000` | Milisegundos de espera para operaciones síncronas sobre el canal (declarar colas, exchanges, etc.). Previene bloqueos al arranque. |

---

### SSL / TLS

| Parámetro | Valor por defecto | Descripción |
|---|---|---|
| `ssl.enabled` | `false` | Activa el cifrado TLS en la conexión con el broker. Obligatorio en cualquier red no completamente privada. |
| `ssl.verify-hostname` | `true` | Valida que el certificado del servidor corresponda al hostname al que se conecta. Previene ataques man-in-the-middle. Desactivar solo en entornos de pruebas con certificados autofirmados. |
| `ssl.key-store` | — | Ruta al keystore (`.p12` o `.jks`) con el certificado del cliente, si el broker requiere mutual TLS (mTLS). |
| `ssl.trust-store` | — | Ruta al truststore con los certificados de CA confiables para validar el certificado del broker. |

> Puerto estándar con SSL: `5671`.

---

### Caché de canales

| Parámetro | Valor por defecto | Recomendado producción | Descripción |
|---|---|---|---|
| `cache.channel.size` | `25` | `25` | Número de canales AMQP que se mantienen abiertos y reutilizables por conexión. Crear y destruir canales en cada operación es costoso; la caché elimina esa latencia. |
| `cache.channel.checkout-timeout` | `0` | `0` | Milisegundos de espera cuando todos los canales en caché están ocupados. `0` significa crear un canal adicional en lugar de esperar. Útil en picos de tráfico. |
| `cache.connection.mode` | `CHANNEL` | `CHANNEL` | `CHANNEL` = una sola conexión TCP con múltiples canales multiplexados (recomendado). `CONNECTION` = una conexión TCP por hilo (solo para casos muy específicos). |

---

### Publisher Confirms (garantía de entrega en publicación)

| Parámetro | Valor por defecto | Recomendado producción | Descripción |
|---|---|---|---|
| `publisher-confirm-type` | `none` | `correlated` | Modo de confirmación del broker al publicar mensajes. `NONE`: sin confirmación (fire-and-forget). `SIMPLE`: confirmación simple, bloquea el hilo. `CORRELATED`: confirmación asíncrona con callback, recomendada en producción. |
| `publisher-returns` | `false` | `true` | Si `true`, el broker notifica cuando un mensaje no puede enrutarse a ninguna cola. Requiere `template.mandatory: true`. |
| `template.mandatory` | `false` | `true` | Lanza excepción (o invoca `ReturnsCallback`) cuando un mensaje publicado no encuentra ninguna cola destino. Previene pérdida silenciosa de mensajes no enrutables. |

> `publisher-confirm-type: correlated` + `publisher-returns: true` + `template.mandatory: true` forman el trío de **at-least-once delivery** en el lado productor.

---

### Listener (consumidor)

| Parámetro | Valor por defecto | Recomendado producción | Descripción |
|---|---|---|---|
| `acknowledge-mode` | `auto` | `manual` | Modo de ACK de mensajes. `AUTO`: el framework hace ACK automático al recibir (riesgo de pérdida si el procesamiento falla). `MANUAL`: el código hace ACK/NACK explícito; garantiza que el mensaje no se descarte hasta ser procesado correctamente. |
| `concurrency` | `1` | `5` | Número mínimo de hilos consumers por listener. Determina el paralelismo base de consumo. |
| `max-concurrency` | igual a `concurrency` | `20` | Número máximo de hilos consumers que Spring puede crear dinámicamente bajo carga alta. Permite escalar sin reiniciar la aplicación. |
| `prefetch` | `250` | `10` | Cuántos mensajes sin ACK puede recibir cada consumer antes de que el broker deje de enviarle más. Un valor alto maximiza throughput pero aumenta el riesgo de perder mensajes en fallo. Un valor bajo (`1`–`10`) distribuye mejor la carga entre consumers. |

---

### Retry (reintentos en fallo)

| Parámetro | Valor por defecto | Recomendado producción | Descripción |
|---|---|---|---|
| `retry.enabled` | `false` | `true` | Activa el mecanismo de reintentos automáticos cuando el listener lanza una excepción. |
| `retry.max-attempts` | `3` | `5` | Número máximo de intentos totales (incluyendo el primero). Al agotar los intentos, el mensaje va a la Dead Letter Queue (si está configurada) o se descarta. |
| `retry.initial-interval` | `1000` | `2000` | Milisegundos de espera antes del primer reintento. |
| `retry.multiplier` | `1.0` (sin cambio) | `2.0` | Factor multiplicador del intervalo entre reintentos. Con `2.0` y `initial-interval: 2000` los intervalos serán: 2s → 4s → 8s → 16s (exponential backoff). Reduce la tormenta de reintentos en cascada. |
| `retry.max-interval` | `10000` | `30000` | Tope máximo del intervalo entre reintentos en milisegundos, independientemente del `multiplier`. Evita esperas excesivas con muchos reintentos. |
| `retry.stateless` | `true` | `true` | `true` para listeners sin estado (recomendado). `false` solo si el listener mantiene estado entre reintentos (raro). |

---

## Dead Letter Queue (DLQ)

La DLQ es el componente más crítico que **no se configura en el YAML** sino en la definición de colas en Java. Sin ella, los mensajes que superan `max-attempts` se pierden silenciosamente.

eva4j genera automáticamente la infraestructura DLQ **por módulo** usando un `TopicExchange` dedicado con sufijo `.dlx`. Este patrón aísla las DLQ de cada módulo, evitando que un error de configuración afecte a otros bounded contexts.

```java
// Generado automáticamente por eva4j en RabbitMQConfig del módulo consumidor

// Exchange principal del módulo productor
@Bean
public TopicExchange ordersExchange() {
    return new TopicExchange("orders", true, false);
}

// DLX dedicada por módulo (sufijo .dlx)
@Bean
public TopicExchange ordersDlxExchange() {
    return new TopicExchange("orders.dlx", true, false);
}

// Cola principal con redirección a DLX del módulo
@Bean
public Queue orderPlacedQueue() {
    return QueueBuilder.durable("ORDER_PLACED")
        .withArgument("x-dead-letter-exchange", "orders.dlx")
        .build();
}

// Binding de la cola principal al exchange del productor
@Bean
public Binding orderPlacedBinding() {
    return BindingBuilder
        .bind(orderPlacedQueue())
        .to(ordersExchange())
        .with("order.placed");
}

// Cola DLQ (sufijo .dlq)
@Bean
public Queue orderPlacedDlq() {
    return QueueBuilder.durable("ORDER_PLACED.dlq").build();
}

// Binding de la DLQ al DLX con la misma routing key
@Bean
public Binding orderPlacedDlqBinding() {
    return BindingBuilder
        .bind(orderPlacedDlq())
        .to(ordersDlxExchange())
        .with("order.placed");
}
```

| Argumento de cola | Descripción |
|---|---|
| `x-dead-letter-exchange` | Exchange DLX **del módulo** al que se enrutan los mensajes rechazados definitivamente. |
| `x-message-ttl` | (Opcional) Tiempo de vida en ms de mensajes en la cola principal antes de expirar a la DLQ. |

---

## Diferencias por entorno

| Parámetro | local/dev | test | producción |
|---|---|---|---|
| `host` | `localhost` | `localhost` | `${RABBITMQ_HOST}` |
| `username/password` | `guest/guest` | `guest/guest` | `${RABBITMQ_USERNAME}` / `${RABBITMQ_PASSWORD}` |
| `ssl.enabled` | `false` | `false` | `true` |
| `publisher-confirm-type` | `none` | `none` | `correlated` |
| `concurrency` | `3` | `1` | `5` |
| `max-concurrency` | — | — | `20` |
| `prefetch` | `250` (default) | `1` | `10` |
| `retry.max-attempts` | `3` | `3` | `5` |
| `retry.multiplier` | — | — | `2.0` |

---

## Checklist de producción

- [ ] Credenciales en variables de entorno (sin valores por defecto expuestos)
- [ ] Usuario dedicado (no `guest`) creado en el broker con permisos mínimos necesarios
- [ ] SSL habilitado (`ssl.enabled: true`, puerto `5671`)
- [ ] `acknowledge-mode: manual` configurado
- [ ] Dead Letter Queue declarada para cada cola consumida
- [ ] `publisher-confirm-type: correlated` + `publisher-returns: true` + `template.mandatory: true`
- [ ] `prefetch` ajustado (recomendado `10`, no el default `250`)
- [ ] `retry.multiplier` configurado (backoff exponencial)
- [ ] `max-concurrency` definido para escalar bajo carga
- [ ] `connection-timeout` y `requested-heartbeat` configurados
- [ ] Monitoreo de DLQ con alertas activas

---

**Versión:** 1.0  
**Última actualización:** 2026-04-04
