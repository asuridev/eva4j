# Design: System-First Development con `system.yaml`

> **Estado:** Propuesta en evolución  
> **Versión:** 0.1.0  
> **Fecha:** 2026-03-09

---

## 📋 Tabla de Contenidos

- [Visión](#visión)
- [Motivación](#motivación)
- [Principio Central](#principio-central)
- [Los Tres Artefactos](#los-tres-artefactos)
- [Anatomía de system.yaml](#anatomía-de-systemyaml)
- [Anatomía de integration.yaml](#anatomía-de-integrationyaml)
- [Relación entre los Archivos](#relación-entre-los-archivos)
- [Flujo de Trabajo](#flujo-de-trabajo)
- [Comandos Nuevos](#comandos-nuevos)
- [Validaciones de system.yaml](#validaciones-de-systemyaml)
- [Aspectos Positivos del Enfoque](#aspectos-positivos-del-enfoque)
- [Colaboración con Agentes de IA](#colaboración-con-agentes-de-ia)
- [Cómo Construir el system.yaml con un Agente de IA](#cómo-construir-el-systemyaml-con-un-agente-de-ia)
- [Preguntas Abiertas](#preguntas-abiertas)

---

## Visión

> Construir sistemas backend robustos, con calidad de arquitectura enterprise, en una fracción del tiempo tradicional — iterando a la velocidad del negocio, no del código.

El objetivo final de este enfoque es habilitar un **ciclo de desarrollo acelerado por IA** donde:

- El equipo opera permanentemente en el nivel de **intención y negocio**, no en el nivel de código
- Los patrones arquitecturales correctos (hexagonal, DDD, CQRS) son **garantizados por el tooling**, no por la disciplina individual
- La IA amplifica la capacidad del equipo sin introducir inconsistencias
- Cada iteración es **quirúrgica y predecible**: cambiar una regla de negocio no requiere arqueología de código

### El ciclo fundamental

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   INTENCIÓN          ESPECIFICACIÓN        CÓDIGO           │
│   (negocio)    →     (YAML)           →    (Java)           │
│                      ↑                                      │
│                      │  revisión humana                     │
│                      │  (diff de YAML,                      │
│                      │   no de código)                      │
│                                                             │
│              ◄────── iteración ──────────────────           │
└─────────────────────────────────────────────────────────────┘
```

### Por qué este ciclo es cualitativamente diferente

| Enfoque | Velocidad | Consistencia | Revisión humana | Iteración |
|---|---|---|---|---|
| Tradicional | Lenta | Depende del equipo | Revisión de código (costosa) | Lenta |
| AI genera código directamente | Rápida | Baja — AI improvisa patrones | Difícil — código generado es opaco | Frágil |
| **System-First + eva4j + AI** | **Muy rápida** | **Alta — patrones garantizados por el generador** | **Fácil — se revisan YAMLs, no código** | **Rápida y segura** |

La clave es que **la IA y el humano colaboran en el nivel de especificación**, no en el nivel de código. El código Java es siempre un artefacto generado, determinista y consistente. Nadie necesita revisar si el mapper excluye los campos de auditoría — eva4j siempre lo hace bien.

### La promesa concreta

Un sistema con 5-8 módulos, con comunicación asíncrona (Kafka) y síncrona (HTTP), con arquitectura hexagonal completa y cobertura de casos de uso principales:

- **Hoy (sin este enfoque):** semanas de desarrollo + semanas de revisión arquitectural
- **Con este enfoque:** días para la especificación colaborativa + horas para la generación y validación

La ganancia no viene de generar código más rápido — viene de **eliminar las decisiones repetitivas** (¿cómo nombro este mapper?, ¿dónde va esta clase?, ¿cómo estructuro este evento?) y dejar al equipo enfocado en las decisiones que realmente importan: qué reglas de negocio son correctas, qué contratos entre módulos tienen sentido, qué comportamientos del dominio necesitan transiciones de estado.

---

## Motivación

Hoy en eva4j el punto de entrada es el módulo: se crea uno a uno, se diseña su `domain.yaml` de forma aislada, y la comunicación entre módulos se configura de forma imperativa e interactiva mediante comandos como `eva g kafka-event`, `eva g kafka-listener` y `eva g http-exchange`.

Esto funciona bien para módulos individuales, pero deja una brecha: **no existe ningún artefacto que describa el sistema como un todo** — qué módulos existen, cómo se comunican, y cuáles son los contratos entre ellos.

La propuesta introduce un enfoque **System-First**: el diseño comienza definiendo la arquitectura del sistema en un único archivo de alto nivel (`system.yaml`), a partir del cual se hace bootstrap de toda la estructura.

---

## Principio Central

> El `system.yaml` describe **qué módulos existen y cómo se comunican**.  
> El `domain.yaml` describe **qué es el dominio de cada módulo**.  
> El `integration.yaml` describe **cómo cada módulo habla con el mundo exterior**.

Los tres archivos son independientes y evolucionan en momentos distintos, pero tienen una relación de coherencia que eva4j puede validar.

---

## Los Tres Artefactos

| Archivo | Nivel | Responde a | Lo define |
|---|---|---|---|
| `system.yaml` | Sistema | ¿Qué módulos existen? ¿Qué fluye entre ellos? ¿Qué exponen? | Arquitecto / diseñador del sistema |
| `domain.yaml` | Módulo | ¿Qué entidades, reglas y eventos tiene este módulo? | Desarrollador del módulo |
| `integration.yaml` | Módulo | ¿Cómo se comunica este módulo con el sistema? | Desarrollador del módulo |

---

## Anatomía de `system.yaml`

El archivo vive en la **raíz del proyecto** y tiene tres secciones:

```yaml
# system.yaml

system:
  name: ecommerce-platform
  groupId: com.acme
  javaVersion: 21
  springBootVersion: 3.4.1
  database: postgresql

messaging:
  enabled: true
  broker: kafka                  # kafka | rabbitmq | sns-sqs (solo kafka soportado actualmente)
  kafka:
    bootstrapServers: localhost:9092
    defaultGroupId: ecommerce-platform
    topicPrefix: ecommerce       # opcional — prefixa todos los topics: ecommerce.ORDER_PLACED

modules:
  - name: orders
    description: "Gestión del ciclo de vida de pedidos"
    exposes:
      - GET  /orders/{id}          # Obtener detalle de un pedido
      - GET  /orders               # Listar pedidos con filtros y paginación
      - POST /orders               # Crear nuevo pedido
      - PUT  /orders/{id}/confirm  # Confirmar pedido pendiente
      - PUT  /orders/{id}/cancel   # Cancelar pedido (PENDING o CONFIRMED)

  - name: customers
    description: "Registro y gestión de clientes"
    exposes:
      - GET  /customers/{id}       # Obtener cliente por ID
      - GET  /customers            # Listar clientes con filtros
      - POST /customers            # Registrar nuevo cliente
      - PUT  /customers/{id}       # Actualizar datos del cliente

  - name: payments
    description: "Procesamiento de pagos"
    exposes:
      - POST /payments             # Iniciar procesamiento de pago
      - GET  /payments/{id}        # Consultar estado de un pago
      - POST /payments/{id}/refund # Solicitar reembolso

  - name: notifications
    description: "Envío de notificaciones"
    # Sin endpoints REST — solo consume eventos

integrations:
  async:
    - event: OrderPlacedEvent
      producer: orders
      topic: ORDER_PLACED
      consumers:
        - module: payments
        - module: notifications

    - event: OrderCancelledEvent
      producer: orders
      topic: ORDER_CANCELLED
      consumers:
        - module: payments
        - module: notifications

    - event: PaymentProcessedEvent
      producer: payments
      topic: PAYMENT_PROCESSED
      consumers:
        - module: orders

  sync:
    - caller: orders
      calls: customers
      port: CustomerService
      using:
        - GET /customers/{id}

    - caller: payments
      calls: orders
      port: OrderService
      using:
        - GET /orders/{id}
```

### Reglas del `system.yaml`

- Solo describe **qué existe** y **qué fluye** — no sabe nada de entidades, campos ni lógica de negocio
- Los endpoints en `exposes:` son referencias documentales y sirven para validar los `calls.using:`
- Los módulos en `consumers:` deben existir en `modules:`
- Los eventos en `consumers:` deben tener exactamente un `producer:`

### Sección `messaging`

| Campo | Obligatorio | Descripción |
|---|---|---|
| `enabled` | sí | `true` para activar soporte de mensajería asíncrona |
| `broker` | sí | Tipo de broker: `kafka` \| `rabbitmq` \| `sns-sqs` |
| `kafka.bootstrapServers` | cuando `broker: kafka` | Host(s) del broker Kafka |
| `kafka.defaultGroupId` | no | Consumer group ID base; cada módulo añade su sufijo |
| `kafka.topicPrefix` | no | Prefijo global para todos los topics del sistema |
| `rabbitmq.host` | cuando `broker: rabbitmq` | Host del broker RabbitMQ |
| `rabbitmq.port` | no | Puerto (default `5672`) |
| `rabbitmq.virtualHost` | no | VirtualHost (default `/`) |
| `rabbitmq.exchangeType` | no | Tipo de exchange: `topic` \| `direct` \| `fanout` (default `topic`) |
| `sns-sqs.region` | cuando `broker: sns-sqs` | Región AWS |
| `sns-sqs.accountId` | cuando `broker: sns-sqs` | AWS Account ID (para construir ARNs) |
| `sns-sqs.endpointOverride` | no | URL local para desarrollo (ej. LocalStack) |

> **Nota:** solo `kafka` está soportado actualmente. Los valores `rabbitmq` y `sns-sqs` están reservados para versiones futuras y generan un warning al ejecutar `eva system validate`.

#### Ejemplo con RabbitMQ

En brokers basados en colas, el modelo de comunicación cambia: en lugar de **topics** (Kafka) se usan **exchanges + queues** (RabbitMQ) o **topics SNS + colas SQS** (AWS). La integración sigue siendo declarativa — la diferencia está en los campos de configuración y en cómo se nombran los canales en `integrations.async`.

```yaml
# system.yaml — broker RabbitMQ

system:
  name: ecommerce-platform
  groupId: com.acme
  javaVersion: 21
  springBootVersion: 3.4.1
  database: postgresql

messaging:
  enabled: true
  broker: rabbitmq
  rabbitmq:
    host: localhost
    port: 5672
    virtualHost: /ecommerce
    exchangeType: topic            # un exchange por evento (topic exchange)

modules:
  - name: orders
    description: "Gestión del ciclo de vida de pedidos"
    exposes:
      - POST /orders               # Crear nuevo pedido
      - PUT  /orders/{id}/confirm  # Confirmar pedido pendiente
      - PUT  /orders/{id}/cancel   # Cancelar pedido

  - name: payments
    description: "Procesamiento de pagos"
    exposes:
      - POST /payments             # Iniciar procesamiento de pago

  - name: notifications
    description: "Envío de notificaciones"
    # Sin endpoints REST — solo consume eventos

integrations:
  async:
    - event: OrderPlacedEvent
      producer: orders
      exchange: orders.events          # exchange RabbitMQ
      routingKey: order.placed         # routing key del mensaje
      consumers:
        - module: payments
          queue: payments.order.placed  # cola dedicada por consumidor
        - module: notifications
          queue: notifications.order.placed

    - event: PaymentProcessedEvent
      producer: payments
      exchange: payments.events
      routingKey: payment.processed
      consumers:
        - module: orders
          queue: orders.payment.processed

  sync:
    - caller: orders
      calls: customers
      port: CustomerService
      using:
        - GET /customers/{id}
```

**Diferencias clave respecto a Kafka:**

| Concepto | Kafka | RabbitMQ |
|---|---|---|
| Canal de publicación | `topic` | `exchange` + `routingKey` |
| Canal de consumo | `topic` (compartido) | `queue` (exclusiva por consumidor) |
| Retención de mensajes | Log persistente (configurable) | Hasta que el consumidor los acepta |
| Fan-out | Un topic, múltiples consumer groups | Un exchange, múltiples queues binding |
| Replay | Sí (offset reset) | No (requiere DLQ + republicación) |

#### Ejemplo con SNS/SQS

```yaml
# system.yaml — broker SNS/SQS (AWS)

messaging:
  enabled: true
  broker: sns-sqs
  sns-sqs:
    region: us-east-1
    accountId: "123456789012"
    endpointOverride: http://localhost:4566   # LocalStack para desarrollo local

integrations:
  async:
    - event: OrderPlacedEvent
      producer: orders
      topic: arn:aws:sns:us-east-1:123456789012:OrderPlaced   # ARN del topic SNS
      consumers:
        - module: payments
          queue: arn:aws:sqs:us-east-1:123456789012:payments-order-placed
        - module: notifications
          queue: arn:aws:sqs:us-east-1:123456789012:notifications-order-placed
```

---

## Anatomía de `integration.yaml`

Vive en la **raíz de cada módulo** (`src/modules/<module>/integration.yaml`). Se genera parcialmente desde el `system.yaml` y se refina manualmente con los detalles de contrato.

```yaml
# orders/integration.yaml
module: orders

publishes:
  - event: OrderPlacedEvent        # debe existir en orders/domain.yaml events[]
    topic: ORDER_PLACED
  - event: OrderCancelledEvent
    topic: ORDER_CANCELLED

consumes:
  - event: PaymentProcessedEvent
    topic: PAYMENT_PROCESSED
    from: payments
    handler: UpdateOrderPaymentStatusHandler
    fields:                        # campos del evento que orders necesita
      - name: orderId
        type: String
      - name: status
        type: String               # como String para no acoplar el enum de payments

calls:
  - port: CustomerService
    target: customers
    methods:
      - name: findCustomerById
        http: GET /customers/{id}
        response: CustomerDto      # DTO local definido por orders
        fields:
          - name: id
            type: String
          - name: fullName
            type: String
          - name: email
            type: String
```

### Lo que `eva system init` pre-genera en `integration.yaml`

A partir del `system.yaml`, se conoce sin necesidad de diseño de dominio:

- `consumes:` → los topics y el módulo origen (de `integrations.async`)
- `calls:` → el puerto y el módulo destino (de `integrations.sync`)

Lo que el desarrollador **añade manualmente** después:

- `publishes:` → depende de los eventos declarados en `domain.yaml`
- `fields:` en `consumes:` → qué parte del evento le interesa a este módulo
- `fields:` en `calls:` → el shape del DTO de respuesta que espera recibir

---

## Relación entre los Archivos

### Dependencias de datos

```
system.yaml
    │
    ├─── genera bootstrap de ──►  domain.yaml (esqueleto vacío, por módulo)
    │
    └─── genera parcialmente ──►  integration.yaml (consumes + calls pre-llenados)


domain.yaml (events[])
    │
    └─── informa ──────────────►  integration.yaml (publishes:)
                                  [el desarrollador lo completa manualmente]


domain.yaml (use cases)
    │
    └─── hace emerger ─────────►  integration.yaml (calls:)
                                  [emerge al diseñar los use cases del dominio]
```

### Dependencia dura validable

> Los eventos en `integration.yaml → publishes:` **deben existir** en `domain.yaml → events[]`.  
> `eva g integration <module>` valida esta coherencia antes de generar código.

---

## Flujo de Trabajo

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. DISEÑO ARQUITECTURAL                                                 │
│                                                                          │
│     [Definir/editar system.yaml]                                         │
│     eva system validate   →  detecta inconsistencias en el grafo        │
└──────────────────────────────────────┬──────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. BOOTSTRAP                                                            │
│                                                                          │
│     eva system init                                                      │
│       → proyecto base (build.gradle, Application.java, shared/)         │
│       → módulo vacío por cada entrada en modules:                       │
│       → domain.yaml esqueleto (comentado, listo para diseñar)           │
│       → integration.yaml pre-llenado (consumes + calls del system.yaml) │
└──────────────────────────────────────┬──────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. MODELADO DE DOMINIO  (por módulo, de forma independiente)            │
│                                                                          │
│     [Editar orders/domain.yaml]                                          │
│     [Editar payments/domain.yaml]                                        │
│     [Editar customers/domain.yaml]                                       │
└──────────────────────────────────────┬──────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. REFINAMIENTO DE INTEGRACIÓN  (por módulo)                            │
│                                                                          │
│     [Completar integration.yaml con publishes: y fields:]               │
│     - publishes: deriva de los events[] definidos en domain.yaml        │
│     - fields en consumes: define qué datos del evento necesita          │
│     - fields en calls: define el shape del DTO de respuesta esperado    │
└──────────────────────────────────────┬──────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  5. GENERACIÓN DE CÓDIGO                                                 │
│                                                                          │
│     eva g entities orders        →  entidades, repos, mappers           │
│     eva g entities payments                                              │
│     eva g integration orders     →  kafka producers, listeners, feign   │
│     eva g integration payments                                           │
│     eva system diagram           →  diagrama Mermaid del sistema        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Comandos Nuevos

| Comando | Descripción |
|---|---|
| `eva system validate` | Valida coherencia del `system.yaml` (referencias rotas, ciclos, eventos sin consumidor) |
| `eva system init` | Bootstrap completo: proyecto + módulos + `domain.yaml` esqueleto + `integration.yaml` pre-llenado |
| `eva system diagram` | Genera diagrama Mermaid del grafo de módulos y comunicaciones |
| `eva g integration <module>` | Genera el código de infraestructura a partir de `integration.yaml` (kafka, feign clients) |

### Relación con comandos existentes

Los comandos actuales (`eva g kafka-event`, `eva g kafka-listener`, `eva g http-exchange`) seguirían funcionando para casos puntuales. El nuevo `eva g integration <module>` los orquestaría todos a partir del `integration.yaml`, sin prompts interactivos.

---

## Validaciones de `system.yaml`

`eva system validate` detectaría los siguientes problemas:

| Tipo | Ejemplo |
|---|---|
| Módulo inexistente en consumidor | `consumers[].module: inventario` pero `inventario` no está en `modules:` |
| Evento consumido sin productor | `consumes` un `StockUpdatedEvent` que ningún módulo publica |
| Endpoint referenciado no expuesto | `calls.using: GET /customers/profile` pero `customers` no lo declara en `exposes:` |
| Dependencia circular síncrona | `orders` llama a `payments` y `payments` llama a `orders` |
| Evento sin consumidores | Un evento publicado que nadie consume (advertencia, no error) |

---

## Aspectos Positivos del Enfoque

### 1. Diseño antes de código
El equipo puede definir y discutir la arquitectura del sistema completo en un solo archivo de texto antes de escribir una sola línea de código Java. El `system.yaml` es legible por cualquier miembro del equipo, incluso sin conocimiento técnico profundo.

### 2. Single source of truth arquitectural
Toda la topología del sistema — qué módulos existen, qué publican, qué consumen, a quién llaman — vive en un único lugar. Elimina la necesidad de diagramas de arquitectura que quedan desactualizados.

### 3. Eliminación de prompts interactivos
Los comandos actuales (`eva g kafka-event`, `eva g kafka-listener`, `eva g http-exchange`) requieren responder preguntas cada vez que se ejecutan. Con `integration.yaml`, `eva g integration <module>` genera todo de una vez, sin interacción, reproducible y apto para CI/CD.

### 4. Contratos explícitos entre módulos
El `integration.yaml` fuerza a declarar explícitamente qué campos de un evento consume cada módulo. Esto hace visibles las dependencias de datos entre módulos y reduce el acoplamiento implícito.

### 5. Detección temprana de inconsistencias
`eva system validate` detecta problemas de arquitectura (referencias rotas, dependencias circulares, contratos mal definidos) antes de generar código y antes de desplegar, cuando el costo de corregirlos es mínimo.

### 6. Escalabilidad del proceso
El mismo flujo funciona para un sistema con 3 módulos o con 30. El `system.yaml` crece linealmente y sigue siendo el mapa del sistema.

### 7. Separación de responsabilidades clara
Cada archivo tiene una responsabilidad única y bien definida:
- `system.yaml` → **qué existe** (arquitectura)
- `domain.yaml` → **qué es** (negocio)
- `integration.yaml` → **cómo habla** (infraestructura)

Un cambio de dominio no toca `system.yaml`. Un cambio de arquitectura no toca `domain.yaml`. Las responsabilidades no se mezclan.

### 8. Autonomía de módulos preservada
A pesar de comenzar con una visión global, cada módulo sigue siendo autónomo: su `domain.yaml` y su `integration.yaml` evolucionan de forma independiente. El `system.yaml` es el punto de partida, no una restricción permanente.

### 9. Diagrama siempre actualizado
`eva system diagram` genera un diagrama Mermaid directamente desde `system.yaml`, garantizando que la documentación visual del sistema nunca queda desactualizada respecto al código.

### 10. Preparación natural para microservicios
El comando `eva detach <module>` (ya existente) se vuelve más potente porque el `system.yaml` ya documenta exactamente qué contratos expone el módulo y con quién se comunica — toda la información necesaria para extraerlo como servicio independiente.

---

## Colaboración con Agentes de IA

### El problema actual con AI + generación de código

Un agente de IA hoy necesita responder preguntas como: ¿qué hace este módulo?, ¿con quién se comunica?, ¿qué eventos publica o consume?, ¿qué ya existe en el sistema? Sin `system.yaml`, el agente tiene que **inferir** todo eso leyendo código, archivos de configuración dispersos y documentación posiblemente desactualizada. El contexto es ruidoso, incompleto y costoso en tokens.

### Los YAMLs como contexto perfecto para un agente

Los tres archivos juntos son **densos en significado y mínimos en ruido**. Un agente puede leerlos y tener comprensión completa de un módulo en ~100 líneas de YAML, en lugar de miles de líneas de Java:

```
system.yaml      →  "qué soy dentro del sistema y con quién hablo"
domain.yaml      →  "qué reglas de negocio tengo"
integration.yaml →  "qué contratos tengo hacia afuera"
```

### División natural de trabajo humano-agente

El enfoque habilita una colaboración por capas donde el humano opera en el nivel de **intención** y el agente en el nivel de **estructura y detalle**:

| Humano | Agente de IA |
|---|---|
| Define `system.yaml` (visión arquitectural) | Valida coherencia del grafo, detecta dependencias circulares, sugiere módulos faltantes |
| Revisa y aprueba | Genera `domain.yaml` de cada módulo (entidades, campos, relaciones, enums, eventos) |
| Refina `domain.yaml` (ajusta reglas de negocio) | Genera `integration.yaml` completo (infiere `publishes:` de los `events[]`, completa `fields:` de `consumes:`) |
| Revisa y aprueba | Ejecuta `eva g entities` + `eva g integration` — código completo listo para compilar |

### Instrucciones precisas y verificables para el agente

Con el enfoque YAML-first el agente no infiere — **ejecuta sobre especificación explícita**:

- El `system.yaml` le dice el **contrato** que debe respetar
- El `AGENTS.md` le dice los **patrones** que debe seguir
- El `domain.yaml` le dice **exactamente qué generar**

El resultado es predecible, revisable y consistente entre iteraciones.

### Iteración quirúrgica sin regenerar todo

El modelo YAML como fuente de verdad hace que cada cambio sea mínimo y rastreable:

```
Cambio de negocio:      editar domain.yaml   →  eva g entities orders
Nuevo evento:           editar system.yaml   →  eva system validate
                        editar integration   →  eva g integration orders payments
Nueva feature completa: agente recibe domain.yaml actual + descripción del cambio
                        propone domain.yaml actualizado (diff mínimo)
                        humano aprueba  →  eva g entities
```

Cada iteración tiene un **artefacto de revisión claro** (el YAML diff) antes de que se toque una línea de código Java.

### Los YAMLs como sistema de conocimiento del proyecto

Combinados, los cuatro archivos forman el contexto completo para cualquier agente que se incorpore al proyecto:

```
AGENTS.md          →  "cómo se hace en eva4j"          (patrones globales)
system.yaml        →  "qué existe en este proyecto"     (topología del sistema)
domain.yaml        →  "qué es este módulo"              (negocio del módulo)
integration.yaml   →  "cómo habla este módulo"          (contratos del módulo)
```

Un agente que recibe estos cuatro archivos tiene todo lo que necesita para contribuir al proyecto **sin sesión de onboarding**.

### Generación en cascada desde una sola sesión

El flujo completo puede ejecutarse colaborativamente en una sola conversación con un agente, donde el YAML actúa como checkpoint de revisión humana entre cada paso — no es generación ciega de código, sino colaboración estructurada con puntos de control explícitos:

```
1. Humano describe el negocio en lenguaje natural
2. Agente propone system.yaml
3. Humano refina system.yaml  →  eva system validate
4. Agente genera domain.yaml de cada módulo
5. Humano revisa y ajusta
6. Agente completa integration.yaml
7. eva g entities + eva g integration
8. Sistema funcionando
```

---

## Cómo Construir el system.yaml con un Agente de IA

### Qué debe saber el agente antes de empezar

Para que el agente proponga un `system.yaml` correcto y coherente, necesita recibir en el prompt inicial:

| Información | Por qué es necesaria |
|---|---|
| Descripción del negocio en lenguaje natural | Para inferir bounded contexts y responsabilidades de cada módulo |
| Lista de módulos identificados (opcional) | Para no inventar módulos — si ya hay claridad, evita iteraciones innecesarias |
| Flujos de negocio principales | Para determinar qué comunicación es async (Kafka) y qué es sync (HTTP) |
| `SYSTEM_YAML_GUIDE.md` adjunto | Para respetar la sintaxis exacta y las reglas de validación |
| Metadata del proyecto (groupId, Java version) | Para completar la sección `system:` correctamente |

### Prompt inicial recomendado

```
Eres un arquitecto de software experto en DDD y arquitectura hexagonal.
Tu tarea es construir el system.yaml para un proyecto eva4j.

Sistema: [descripción del negocio en 2-5 oraciones]

Módulos identificados:
- [módulo 1]: [responsabilidad]
- [módulo 2]: [responsabilidad]
- ...

Flujos principales:
- [flujo 1]: cuando [evento de negocio], [módulo A] notifica a [módulo B] y [módulo C]
- [flujo 2]: para [operación], [módulo X] necesita datos de [módulo Y]

Metadata:
- groupId: com.acme
- javaVersion: 21
- springBootVersion: 3.4.1
- database: postgresql

Adjunto: SYSTEM_YAML_GUIDE.md con la sintaxis completa y restricciones.

Genera el system.yaml completo respetando:
1. Sección system: con la metadata del proyecto
2. Sección modules: con los endpoints REST que expone cada módulo
3. Sección integrations.async: eventos Kafka con producer y consumers
4. Sección integrations.sync: llamadas HTTP entre módulos
5. Eventos nombrados en pasado (OrderPlacedEvent, no PlaceOrder)
6. Sin dependencias circulares síncronas
```

### Ciclo de refinamiento

```
┌──────────────────────────────────────────────────────────────────┐
│  1. CONTEXTO                                                      │
│     Humano provee: descripción + módulos + flujos                 │
│     + SYSTEM_YAML_GUIDE.md adjunto                                │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  2. PROPUESTA                                                     │
│     Agente genera system.yaml v1                                  │
│     - Infiere módulos y responsabilidades                         │
│     - Define endpoints REST por módulo                            │
│     - Deduce integración async (Kafka) vs sync (HTTP)             │
│     - Nombra eventos en pasado, modules en kebab-case             │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  3. VALIDACIÓN AUTOMÁTICA                                         │
│     eva system validate                                           │
│     - Módulos referenciados inexistentes                          │
│     - Dependencias circulares síncronas                           │
│     - Eventos sin consumidores                                    │
│     - Endpoints llamados no declarados en exposes:                │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  4. REVISIÓN HUMANA                                               │
│     Feedback específico al agente:                                │
│     - "El módulo X debería también exponer PUT /x/{id}/cancel"   │
│     - "El evento Y debería consumirlo también el módulo Z"        │
│     - "La llamada de A a B debería ser async, no sync"            │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  5. REFINAMIENTO                                                  │
│     Agente aplica cambios mínimos → system.yaml v2               │
│     Iterar pasos 3-5 hasta aprobación                             │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  6. BOOTSTRAP                                                     │
│     eva system init  →  proyecto + módulos + domain.yaml          │
│                          + integration.yaml pre-llenados          │
└──────────────────────────────────────────────────────────────────┘
```

### Preguntas clave para guiar al agente

Cuando el agente propone el `system.yaml`, estas preguntas ayudan a refinar el diseño:

| Pregunta | Intención |
|---|---|
| "¿Qué módulo es responsable de X?" | Clarifica bounded contexts y evita duplicación de responsabilidad |
| "¿Este flujo debería ser async o sync?" | Define el estilo de integración según tolerancia a latencia y acoplamiento |
| "¿Quién es el productor natural de este evento?" | Define el ownership del evento en el dominio |
| "¿Qué endpoints necesita el frontend?" | Completa la sección `exposes:` de cada módulo |
| "¿Hay eventos que nadie consume todavía?" | Detecta gaps en el diseño antes de generar código |
| "¿Alguna llamada sync puede volverse async?" | Reduce acoplamiento temporal entre módulos |

### Criterios de calidad del system.yaml generado

Antes de aprobar el `system.yaml` propuesto por el agente, verificar:

- ✅ Cada módulo tiene **una sola responsabilidad** claramente identificable
- ✅ Los eventos están nombrados en **tiempo pasado** (`OrderPlacedEvent`, no `PlaceOrderEvent`)
- ✅ Los nombres de módulos usan **kebab-case** (`order-management`, no `OrderManagement`)
- ✅ **Sin dependencias circulares síncronas** (A llama a B y B llama a A)
- ✅ Módulos de solo lectura (reporting, notificaciones) son **consumidores**, nunca callers síncronos
- ✅ Los eventos contienen **datos mínimos necesarios** — el consumidor pide más si necesita
- ✅ Los endpoints en `exposes:` cubren **todas las operaciones** del módulo, no solo las que otros módulos usan
- ✅ `eva system validate` **no reporta errores** (solo advertencias aceptables)

### Por qué el agente necesita el SYSTEM_YAML_GUIDE.md

Sin una referencia técnica precisa, el agente puede generar YAML semánticamente válido pero estructuralmente incorrecto para eva4j — por ejemplo: usar `consumes:` en `system.yaml` (que no existe en ese nivel), invertir la dirección de `sync.caller/calls`, o nombrar los eventos sin sufijo `Event`. El `SYSTEM_YAML_GUIDE.md` actúa como **gramática contractual** que el agente debe respetar, equivalente al rol que AGENTS.md cumple para la generación de código Java.

---

## Preguntas Abiertas

1. **¿`system.yaml` como fuente de verdad permanente o solo bootstrap inicial?**  
   ¿Los `domain.yaml` son siempre derivados del `system.yaml` (un cambio en uno requiere actualizar el otro), o el `system.yaml` solo se usa para el arranque inicial y después cada módulo evoluciona libremente?  
   *Recomendación actual: bootstrap inicial. Los módulos evolucionan de forma autónoma.*

2. **¿Cómo manejar eventos cuyos campos no están definidos en `system.yaml`?**  
   El `system.yaml` no conoce los campos de los eventos (ese es territorio del dominio). ¿El `integration.yaml → consumes[].fields` es suficiente como contrato, o hace falta un schema compartido?

3. **¿Soporte para múltiples entornos en `system.yaml`?**  
   Los `baseUrl` de los `calls:` son distintos por entorno. ¿Se resuelve con variables de entorno, o el `system.yaml` puede tener secciones por entorno?

4. **¿Qué pasa con módulos que no están en `system.yaml` pero ya existen?**  
   Para proyectos existentes, ¿hay un comando `eva system scan` que genere el `system.yaml` a partir de la estructura actual?

5. **Granularidad de `exposes:`**  
   ¿Los endpoints en `exposes:` solo son documentales, o en el futuro podrían incluir request/response bodies para generar también los DTOs del controller?

---

*Este documento es un artefacto de diseño vivo. Las ideas aquí plasmadas están sujetas a revisión y refinamiento.*
