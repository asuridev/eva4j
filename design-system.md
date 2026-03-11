# Design: System-First Development con `system.yaml`

> **Estado:** Propuesta en evolución  
> **Versión:** 0.1.0  
> **Fecha:** 2026-03-09

---

## 📋 Tabla de Contenidos

- [Visión](#visión)
- [Motivación](#motivación)
- [Principio Central](#principio-central)
- [Los Dos Artefactos](#los-dos-artefactos)
- [Anatomía de system.yaml](#anatomía-de-systemyaml)
- [Puertos Secundarios en domain.yaml](#puertos-secundarios-en-domainyaml)
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
> El `domain.yaml` describe **qué es el dominio de cada módulo y qué puertos secundarios necesita**.

Los dos archivos son independientes y evolucionan en momentos distintos, pero tienen una relación de coherencia que eva4j puede validar.

---

## Los Dos Artefactos

| Archivo | Nivel | Responde a | Lo define |
|---|---|---|---|
| `system.yaml` | Sistema | ¿Qué módulos existen? ¿Qué fluye entre ellos? ¿Qué exponen? | Arquitecto / diseñador del sistema |
| `domain.yaml` | Módulo | ¿Qué entidades, reglas, eventos y puertos secundarios tiene este módulo? | Desarrollador del módulo |

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
      - method: GET
        path: /orders/{id}
        useCase: GetOrder
        description: "Obtener detalle de un pedido"
      - method: GET
        path: /orders
        useCase: FindAllOrders
        description: "Listar pedidos con filtros y paginación"
      - method: POST
        path: /orders
        useCase: CreateOrder
        description: "Crear nuevo pedido"
      - method: PUT
        path: /orders/{id}/confirm
        useCase: ConfirmOrder
        description: "Confirmar pedido pendiente"
      - method: PUT
        path: /orders/{id}/cancel
        useCase: CancelOrder
        description: "Cancelar pedido (PENDING o CONFIRMED)"

  - name: customers
    description: "Registro y gestión de clientes"
    exposes:
      - method: GET
        path: /customers/{id}
        useCase: GetCustomer
        description: "Obtener cliente por ID"
      - method: GET
        path: /customers
        useCase: FindAllCustomers
        description: "Listar clientes con filtros"
      - method: POST
        path: /customers
        useCase: CreateCustomer
        description: "Registrar nuevo cliente"
      - method: PUT
        path: /customers/{id}
        useCase: UpdateCustomer
        description: "Actualizar datos del cliente"

  - name: payments
    description: "Procesamiento de pagos"
    exposes:
      - method: POST
        path: /payments
        useCase: CreatePayment
        description: "Iniciar procesamiento de pago"
      - method: GET
        path: /payments/{id}
        useCase: GetPayment
        description: "Consultar estado de un pago"
      - method: POST
        path: /payments/{id}/refund
        useCase: RefundPayment
        description: "Solicitar reembolso"

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
- Los endpoints en `exposes:` usan sintaxis objeto: `method`, `path`, `useCase` (obligatorio) y `description`
- El campo `useCase` permite a `eva generate system` pre-generar la sección `endpoints:` completa en `domain.yaml`
- Los endpoints en `exposes:` sirven también para validar los `calls.using:`
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
      - method: POST
        path: /orders
        useCase: CreateOrder
        description: "Crear nuevo pedido"
      - method: PUT
        path: /orders/{id}/confirm
        useCase: ConfirmOrder
        description: "Confirmar pedido pendiente"
      - method: PUT
        path: /orders/{id}/cancel
        useCase: CancelOrder
        description: "Cancelar pedido"

  - name: payments
    description: "Procesamiento de pagos"
    exposes:
      - method: POST
        path: /payments
        useCase: CreatePayment
        description: "Iniciar procesamiento de pago"

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

## Puertos Secundarios en `domain.yaml`

Los **puertos secundarios** son interfaces del dominio que representan dependencias hacia otros módulos. Al ser propiedad del dominio en arquitectura hexagonal, se declaran en `domain.yaml` bajo la sección `ports:`:

```yaml
# orders/domain.yaml (fragmento)
aggregates:
  - name: Order
    entities: [...]
    events:
      - name: OrderPlacedEvent
        fields:
          - name: orderId
            type: String
          - name: customerId
            type: String
        kafka: true

ports:                                    # puertos secundarios del módulo
  - name: CustomerService
    target: customers                     # módulo destino — validado contra system.yaml modules:
    methods:
      - name: findCustomerById
        http: GET /customers/{id}
        response:
          - name: id
            type: String
          - name: fullName
            type: String
          - name: email
            type: String
```

### Por qué `ports:` pertenece al dominio

En arquitectura hexagonal, la **interfaz del puerto secundario es propiedad del dominio** — el dominio define qué necesita, la infraestructura decide cómo obtenerlo (Feign, RestTemplate, stub). Declararlos en `domain.yaml` es semánticamente correcto y consistente con el precedente establecido por `reference:` en los campos.

### Lo que `eva g entities` genera a partir de `ports:`

- **Interfaz del puerto** en `domain/repositories/` → `CustomerService.java`
- **DTO de respuesta local** en `application/dtos/` → `CustomerDto.java`
- **Implementación Feign** en `infrastructure/adapters/` → `CustomerServiceFeignAdapter.java`

### Validación cruzada

> `ports[].target` en `domain.yaml` **debe existir** en `system.yaml → modules`.  
> `eva system validate` detecta referencias rotas entre módulos.

---

## Relación entre los Archivos

### Dependencias de datos

```
system.yaml
    │
    └─── genera bootstrap de ──►  domain.yaml (esqueleto con endpoints: pre-generado)


domain.yaml (events[] + ports[])
    │
    └─── genera código de ──────►  eva g entities <module>
                                   → entidades, repos, mappers, kafka events, feign clients
```

### Dependencia dura validable

> `ports[].target` en `domain.yaml` **debe existir** en `system.yaml → modules`.  
> `eva system validate` detecta referencias rotas entre módulos.

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
│     eva generate system                                                      │
│       → proyecto base (build.gradle, Application.java, shared/)         │
│       → módulo vacío por cada entrada en modules:                       │
│       → domain.yaml esqueleto con endpoints: pre-generado (del system.yaml) │
│                                                                          │
│     (re-ejecutable) agrega módulos nuevos declarados en system.yaml     │
│     que aún no existen en el proyecto                                    │
└──────────────────────────────────────┬──────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. MODELADO DE DOMINIO  (por módulo, de forma independiente)            │
│                                                                          │
│     [Editar orders/domain.yaml]    →  aggregates + events + ports:      │
│     [Editar payments/domain.yaml]  →  aggregates + events + ports:      │
│     [Editar customers/domain.yaml] →  aggregates + events               │
└──────────────────────────────────────┬──────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. GENERACIÓN DE CÓDIGO                                                 │
│                                                                          │
│     eva g entities orders   →  entidades, repos, mappers,               │
│                                 kafka events, feign clients (ports:)    │
│     eva g entities payments                                              │
│     eva g entities customers                                             │
│     eva system diagram      →  diagrama Mermaid del sistema             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Comandos Nuevos

| Comando | Descripción |
|---|---|
| `eva system validate` | Valida coherencia del `system.yaml` (referencias rotas, ciclos, eventos sin consumidor, `ports[].target` inexistentes) |
| `eva generate system` | Bootstrap completo: proyecto + módulos + `domain.yaml` esqueleto con `endpoints:` pre-generado |
| `eva system diagram` | Genera diagrama Mermaid del grafo de módulos y comunicaciones |

### Relación con comandos existentes

Los comandos actuales (`eva g kafka-event`, `eva g kafka-listener`, `eva g http-exchange`) seguirían funcionando para casos puntuales. El comando `eva g entities <module>` ahora también genera el código de infraestructura derivado de `ports:` (feign clients) y `events[]` (kafka producers/consumers), sin prompts interactivos.

---

## Validaciones de `system.yaml`

`eva system validate` detectaría los siguientes problemas:

| Tipo | Ejemplo |
|---|---|
| Módulo inexistente en consumidor | `consumers[].module: inventario` pero `inventario` no está en `modules:` |
| Evento consumido sin productor | `consumes` un `StockUpdatedEvent` que ningún módulo publica |
| Endpoint referenciado no expuesto | `calls.using: GET /customers/profile` pero `customers` no lo declara en `exposes:` |
| Dependencia circular síncrona | `orders` llama a `payments` y `payments` llama a `orders` |
| Puerto con módulo inexistente | `domain.yaml → ports[].target: inventario` pero `inventario` no está en `system.yaml → modules:` |
| Evento sin consumidores | Un evento publicado que nadie consume (advertencia, no error) |

---

## Aspectos Positivos del Enfoque

### 1. Diseño antes de código
El equipo puede definir y discutir la arquitectura del sistema completo en un solo archivo de texto antes de escribir una sola línea de código Java. El `system.yaml` es legible por cualquier miembro del equipo, incluso sin conocimiento técnico profundo.

### 2. Single source of truth arquitectural
Toda la topología del sistema — qué módulos existen, qué publican, qué consumen, a quién llaman — vive en un único lugar. Elimina la necesidad de diagramas de arquitectura que quedan desactualizados.

### 3. Eliminación de prompts interactivos
Los comandos actuales (`eva g kafka-event`, `eva g kafka-listener`, `eva g http-exchange`) requieren responder preguntas cada vez que se ejecutan. Con `domain.yaml → events[]` y `ports:`, `eva g entities <module>` genera todo (kafka producers, listeners, feign clients) de una vez, sin interacción, reproducible y apto para CI/CD.

### 4. Contratos explícitos entre módulos
Los `events[]` en `domain.yaml` del productor definen el contrato completo del evento. Los `ports:` en `domain.yaml` del consumidor declaran explícitamente qué campos del servicio remoto necesita. Esto hace visibles las dependencias de datos entre módulos y reduce el acoplamiento implícito.

### 5. Detección temprana de inconsistencias
`eva system validate` detecta problemas de arquitectura (referencias rotas, dependencias circulares, contratos mal definidos) antes de generar código y antes de desplegar, cuando el costo de corregirlos es mínimo.

### 6. Escalabilidad del proceso
El mismo flujo funciona para un sistema con 3 módulos o con 30. El `system.yaml` crece linealmente y sigue siendo el mapa del sistema.

### 7. Separación de responsabilidades clara
Cada archivo tiene una responsabilidad única y bien definida:
- `system.yaml` → **qué existe** (arquitectura — módulos y comunicación)
- `domain.yaml` → **qué es y qué necesita** (negocio + puertos secundarios)

Un cambio de dominio no toca `system.yaml`. Un cambio de arquitectura no toca `domain.yaml`. Las responsabilidades no se mezclan.

### 8. Diseño iterativo del sistema
El `system.yaml` no es solo un artefacto de arranque — **evoluciona con el proyecto**. Es normal que durante el desarrollo emerjan nuevos módulos, endpoints o integraciones que no se vieron inicialmente. Cada iteración sobre `system.yaml` sigue el mismo ciclo ligero: editar → `eva system validate` → actualizar `domain.yaml` afectado → `eva g entities`. El costo de cambiar la arquitectura permanece bajo porque la revisión ocurre en YAML, no en código.

### 9. Diagrama siempre actualizado
`eva system diagram` genera un diagrama Mermaid directamente desde `system.yaml`, garantizando que la documentación visual del sistema nunca queda desactualizada respecto al código.

### 10. Preparación natural para microservicios
El comando `eva detach <module>` (ya existente) se vuelve más potente porque el `system.yaml` ya documenta exactamente qué contratos expone el módulo y con quién se comunica — toda la información necesaria para extraerlo como servicio independiente.

---

## Colaboración con Agentes de IA

### El problema actual con AI + generación de código

Un agente de IA hoy necesita responder preguntas como: ¿qué hace este módulo?, ¿con quién se comunica?, ¿qué eventos publica o consume?, ¿qué ya existe en el sistema? Sin `system.yaml`, el agente tiene que **inferir** todo eso leyendo código, archivos de configuración dispersos y documentación posiblemente desactualizada. El contexto es ruidoso, incompleto y costoso en tokens.

### Los YAMLs como contexto perfecto para un agente

Los dos archivos juntos son **densos en significado y mínimos en ruido**. Un agente puede leerlos y tener comprensión completa de un módulo en ~100 líneas de YAML, en lugar de miles de líneas de Java:

```
system.yaml   →  "qué soy dentro del sistema y con quién hablo"
domain.yaml   →  "qué reglas de negocio tengo y qué necesito de otros módulos"
```

### División natural de trabajo humano-agente

El enfoque habilita una colaboración por capas donde el humano opera en el nivel de **intención** y el agente en el nivel de **estructura y detalle**:

| Humano | Agente de IA |
|---|---|
| Define `system.yaml` (visión arquitectural) | Valida coherencia del grafo, detecta dependencias circulares, sugiere módulos faltantes |
| Revisa y aprueba | Genera `domain.yaml` de cada módulo (entidades, campos, relaciones, enums, eventos) |
| Refina `domain.yaml` (ajusta reglas de negocio y puertos) | Completa `domain.yaml` con `ports:` y ajusta `events[]` |
| Revisa y aprueba | Ejecuta `eva g entities` por módulo — código completo listo para compilar |

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
                        editar domain.yaml   →  eva g entities orders payments
Nuevo módulo:           editar system.yaml   →  eva system validate
                        eva generate system      →  genera el módulo nuevo
                        diseñar domain.yaml  →  eva g entities <nuevo-modulo>
Nuevo endpoint:         editar system.yaml (exposes:)   →  eva system validate
                        editar domain.yaml (endpoints:) →  eva g entities orders
Nueva feature completa: agente recibe domain.yaml actual + descripción del cambio
                        propone domain.yaml actualizado (diff mínimo)
                        humano aprueba  →  eva g entities
```

Cada iteración tiene un **artefacto de revisión claro** (el YAML diff) antes de que se toque una línea de código Java.

### Los YAMLs como sistema de conocimiento del proyecto

Combinados, los cuatro archivos forman el contexto completo para cualquier agente que se incorpore al proyecto:

```
AGENTS.md     →  "cómo se hace en eva4j"              (patrones globales)
system.yaml   →  "qué existe en este proyecto"         (topología del sistema)
domain.yaml   →  "qué es este módulo y cómo habla"    (negocio + puertos)
```

Un agente que recibe estos tres archivos tiene todo lo que necesita para contribuir al proyecto **sin sesión de onboarding**.

### Generación en cascada desde una sola sesión

El flujo completo puede ejecutarse colaborativamente en una sola conversación con un agente, donde el YAML actúa como checkpoint de revisión humana entre cada paso — no es generación ciega de código, sino colaboración estructurada con puntos de control explícitos:

```
1. Humano describe el negocio en lenguaje natural
2. Agente propone system.yaml
3. Humano refina system.yaml  →  eva system validate
4. Agente genera domain.yaml de cada módulo (entities + events + ports)
5. Humano revisa y ajusta
6. eva g entities por módulo  →  código completo generado
7. Sistema funcionando
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
│     eva generate system  →  proyecto + módulos + domain.yaml          │
│                          (con endpoints: pre-generados)           │
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

1. ~~**¿`system.yaml` como fuente de verdad permanente o solo bootstrap inicial?**~~  
   ~~¿Los `domain.yaml` son siempre derivados del `system.yaml` (un cambio en uno requiere actualizar el otro), o el `system.yaml` solo se usa para el arranque inicial y después cada módulo evoluciona libremente?~~  
   **Resuelto:** el `system.yaml` es un artefacto **iterativo** que evoluciona con el proyecto. Es normal que emerjan nuevos módulos, endpoints o integraciones no previstos inicialmente. Cada cambio sigue el mismo ciclo: editar → `eva system validate` → actualizar `domain.yaml` afectado → `eva g entities`. `eva generate system` es re-ejecutable: agrega módulos nuevos que aún no existen y **siempre sobreescribe el `domain.yaml`** de todos los módulos con el esqueleto actualizado desde `system.yaml` (los módulos ya existentes no se recrean, solo se regenera su `domain.yaml`).

2. ~~**¿Cómo manejar eventos cuyos campos no están definidos en `system.yaml`?**~~  
   ~~El `system.yaml` no conoce los campos de los eventos (ese es territorio del dominio). ¿El `integration.yaml → consumes[].fields` es suficiente como contrato, o hace falta un schema compartido?~~  
   **Resuelto:** los campos del evento se declaran en `domain.yaml → events[].fields` del módulo productor. El consumidor los conoce al leer el `domain.yaml` del productor. No hace falta un schema compartido separado.

3. **¿Soporte para múltiples entornos en `system.yaml`?**  
   Los `baseUrl` de los `calls:` son distintos por entorno. ¿Se resuelve con variables de entorno, o el `system.yaml` puede tener secciones por entorno?

4. **¿Qué pasa con módulos que no están en `system.yaml` pero ya existen?**  
   Para proyectos existentes, ¿hay un comando `eva system scan` que genere el `system.yaml` a partir de la estructura actual?

5. ~~**Granularidad de `exposes:`**~~  
   ~~¿Los endpoints en `exposes:` solo son documentales, o en el futuro podrían incluir request/response bodies para generar también los DTOs del controller?~~  
   **Resuelto:** sintaxis objeto obligatoria con `method`, `path`, `useCase` y `description`. El campo `useCase` permite a `eva generate system` pre-generar la sección `endpoints:` completa en `domain.yaml`; el desarrollador solo rellena `aggregates:`.

---

*Este documento es un artefacto de diseño vivo. Las ideas aquí plasmadas están sujetas a revisión y refinamiento.*
