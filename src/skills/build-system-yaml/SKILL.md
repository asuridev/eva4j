---
name: build-system-yaml
description: 'Construir o actualizar el system.yaml de un proyecto eva4j. Usar cuando se necesita diseñar la arquitectura del sistema: módulos, endpoints REST, eventos asíncronos (Kafka/RabbitMQ/SNS-SQS) y llamadas síncronas HTTP entre módulos. Invoca este skill al describir un nuevo sistema, al agregar módulos, al rediseñar integraciones entre servicios, o cuando el usuario pida diagramas C4 de contexto o contenedores del sistema. USE FOR: system architecture design, adding modules, designing async event flows, sync HTTP calls between modules, generating C4 diagrams, building system.yaml + domain YAML + module specifications.'
argument-hint: 'Describe el sistema o los módulos que necesitas (ej: tienda online con pedidos, pagos y notificaciones)'
---

# Build System YAML

Eres dos roles simultáneos:

1. **Arquitecto de software** experto en DDD y arquitectura hexagonal. Decides cómo estructurar el sistema en módulos, qué patrones aplicar y cómo deben comunicarse los bounded contexts.

2. **Experto funcional del negocio** — el dominio lo define el usuario en el chat. Razonas como alguien que conoce en profundidad las reglas, procesos y restricciones del negocio: entiendes qué operaciones tienen sentido, qué flujos son obligatorios, qué invariantes nunca pueden violarse y cómo los actores interactúan con el sistema.

> **Principio de claridad:** cuando detectes ambigüedades que podrían afectar decisiones de diseño, **pregunta al usuario** antes de continuar. Nunca más de 3–5 preguntas a la vez. Solo preguntas genuinamente funcionales.

## Descubrimiento del proyecto

Antes de generar nada, lee estos archivos del proyecto para obtener contexto:
- `system/system.yaml` — si existe, el proyecto ya tiene arquitectura definida; léelo primero
- El `package.json` o configuración del proyecto para nombre, groupId, versiones
- [AGENTS.md](../../../AGENTS.md) — patrones y convenciones de eva4j

## Idioma de los archivos generados

> **REGLA ABSOLUTA — SIEMPRE EN INGLÉS:**
> Todo contenido en archivos `.yaml` y `.md` debe estar en inglés: nombres de módulos, descriptions, comentarios, títulos, invariantes, texto narrativo. La conversación puede ser en cualquier idioma; los archivos, siempre en inglés.

## Cuándo usar este skill

- Diseñar la arquitectura inicial de un sistema nuevo
- Agregar módulos a un proyecto existente
- Definir integraciones asíncronas (Kafka/RabbitMQ) entre módulos
- Definir llamadas síncronas HTTP entre módulos
- Revisar o refactorizar la estructura de módulos
- Generar diagramas C4 del sistema

---

## Workflow — secuencia completa de pasos

| Paso | Archivo generado | Referencia |
|------|------------------|------------|
| 1 | _(recopilación de info)_ | Este archivo |
| 2–5 | `system/system.yaml` (estructura base) | Este archivo + `references/system-yaml-spec.md` |
| 2b | `sagas:` en `system/system.yaml` (flujos críticos) | Este archivo (Paso 2b) |
| 6 | `system/system.md` | `references/module-spec.md` (sección system.md) |
| 6.5 | `system/c4-context.mmd` + `system/c4-container.mmd` | Este archivo (sección C4) |
| 7 | `system/{module}.yaml` (uno por módulo) | `references/domain-yaml-spec.md` |
| 8 | `system/{module}.md` (uno por módulo) | `references/module-spec.md` |
| 9a | `AGENTS.md` (project root — rewrite) | Este archivo (Paso 9) |
| 9b | `system/VALIDATION_FLOWS.md` | Este archivo (Paso 9) |
| 9c | `system/USER_FLOWS.md` | Este archivo (Paso 9) |

Ejecuta **todos** los pasos en orden antes de devolver el control al usuario.

---

## Paso 1 — Recopilar información

**Antes de preguntar nada**, verifica si ya existen artefactos del skill `requirements-elicitation`:
- `system/FUNCTIONAL_REQUIREMENTS.md` — casos de uso, actores, ciclos de vida, integraciones externas
- `system/PRODUCT_FLOWS.md` — flujos de negocio por actor (happy paths + alternativos)
- `system/BUSINESS_RULES.md` — reglas de negocio, invariantes, restricciones

Si existen, **léelos primero** y extrae de ellos el contexto de negocio. Reduce o elimina las preguntas que ya están respondidas por estos archivos. Estos documentos son la fuente de verdad funcional — los módulos, casos de uso, estados y reglas que diseñes deben ser consistentes con lo que describen.

Si el usuario no proveyó todos los datos y los archivos anteriores no existen, **pregunta** antes de generar:

0. **Contexto del negocio** — ¿Cuál es el dominio? Actores, procesos clave, reglas importantes.
1. **¿Usa mensajería asíncrona?** `kafka` | `rabbitmq` | `sns-sqs`
2. **Lista de módulos** con su responsabilidad (plural, kebab-case)
3. **Endpoints REST** por módulo (método + path + caso de uso)
4. **Flujos async**: evento → productor → consumidores + `useCase` de cada consumidor
5. **Llamadas sync**: caller → destino → endpoints usados
6. **Dependencias de datos cross-module**: ¿algún módulo necesita datos de otro para validar o enriquecer? → candidato a **Read Model** (proyección local mantenida por eventos) en vez de llamada sync

> Si `system/system.yaml` ya existe, léelo y pregunta solo por cambios.

Aplica el rol funcional: sugiere módulos necesarios no mencionados, propone flujos async coherentes, anticipa invariantes. Confirma antes de agregar elementos no solicitados.

### Read Models — decisión de diseño

Cuando un módulo necesita datos de otro módulo, evalúa antes de decidir entre `ports:` (sync HTTP) y `readModels:` (async, proyección local):

| Pregunta | Si la respuesta es SÍ → |
|---|---|
| ¿El dato se consulta en cada request o en operaciones frecuentes? | `readModels:` |
| ¿Se tolera consistencia eventual (ms de delay)? | `readModels:` |
| ¿Se prepara el sistema para microservicios (`eva detach`)? | `readModels:` |
| ¿Se necesita consistencia fuerte (ej: saldo financiero)? | `ports:` |
| ¿Es una llamada infrecuente y simple (ej: lookup puntual)? | `ports:` |

**Patrón típico:** Si un módulo ya consume eventos de otro módulo (`listeners:`) y además llama sync para obtener datos del mismo módulo (`ports:`), es candidato fuerte a reemplazar el port por un readModel.

Si decides usar readModel:
1. En `system.yaml`: declarar eventos con `consumers[].readModel:` en vez de `useCase:`
2. En `{module}.yaml`: declarar `readModels:` con `source`, `tableName`, `fields`, `syncedBy`
3. Eliminar la entrada `integrations.sync[]` que reemplaza
4. Asegurar que el módulo fuente emita los eventos necesarios en sus `events:` — usar `lifecycle:` para eventos CRUD (`create`/`update`/`delete`/`softDelete`) en vez de `triggers:`

---

## Paso 2 — Estructura del system.yaml

Lee `references/system-yaml-spec.md` para la estructura completa, convenciones de nombres, restricciones estructurales y patrones de useCases.

**Estructura clave:**

```yaml
system:
  name: project-name
  groupId: com.example
  javaVersion: 21
  springBootVersion: 3.5.5
  database: postgresql

messaging:                         # Omitir si no hay mensajería
  enabled: true
  broker: kafka
  kafka:
    bootstrapServers: localhost:9092
    defaultGroupId: project-name
    topicPrefix: project-name

modules:
  - name: orders
    description: "Order lifecycle management"
    exposes:
      - method: POST
        path: /orders
        useCase: CreateOrder
        description: "Create a new order"

integrations:
  async:
    - event: OrderPlacedEvent
      producer: orders
      topic: ORDER_PLACED
      consumers:
        - module: payments
          useCase: HandleOrderPlaced
    # Read Model sync — usa readModel: en vez de useCase:
    - event: ProductCreatedEvent
      producer: products
      topic: PRODUCT_CREATED
      consumers:
        - module: orders
          readModel: ProductReadModel    # proyección local de datos cross-module
  sync:
    - caller: orders
      calls: customers
      port: OrderCustomerService
      using:
        - GET /customers/{id}
```

---

## Paso 2b — Identificar flujos críticos con compensación (sagas de coreografía)

Antes de finalizar el `system.yaml`, analiza los flujos async para detectar cuáles son **multi-paso con efectos secundarios distribuidos**. Estos flujos se declaran en la sección `sagas:` del `system.yaml` para documentar el comportamiento de compensación y habilitarlo en el reporte de `eva evaluate system`.

### Criterios de identificación — ¿cuándo declarar una saga?

Un flujo async es una **saga candidata** cuando cumple 2 o más de estas condiciones:

| Criterio | Señal en el diseño |
|---|---|
| ≥ 3 módulos participan en cadena de eventos | A emite → B consume y emite → C consume y emite |
| Algún paso modifica estado no fácilmente reversible | Reserva de stock, cargo financiero, llamada a API externa |
| Un fallo tardío deja el sistema en estado inconsistente | Pago cobrado pero stock sin reservar |
| El flujo involucra recursos externos vía `ports:` | Pasarelas de pago, sistemas de envío, APIs de terceros |
| El flujo requiere rollback ordenado LIFO de pasos anteriores | Varios pasos acumulan estado antes del paso final |

> **Regla práctica:** Si ante la pregunta "¿qué pasa si falla el paso N?" la respuesta es "quedan datos inconsistentes en otro módulo", necesitas declarar una saga.

### Cuándo NO declarar una saga

- Flujo de un solo módulo (sin coordinación cross-module)
- Todos los pasos son idempotentes y sin efectos secundarios acumulados
- Los fallos son manejables con reintentos + dead letter queue
- El negocio acepta inconsistencia temporal sin necesidad de rollback explícito

### Proceso de identificación (3 pasos)

1. **Mapea la cadena:** `EventoA → MóduloB → EventoB → MóduloC → EventoC → …`
2. **Marca pasos compensables:** Para cada paso intermedio (no el primero ni el último), pregunta: ¿modifica estado en su módulo? Si sí → es compensable.
3. **Asigna compensador LIFO:** El paso N es compensado por el módulo del paso N-1. Esto garantiza que cada módulo solo revierte lo que el paso anterior inició.

### Convenciones de nombres para sagas

| Elemento | Convención | Ejemplo correcto | Ejemplo incorrecto |
|---|---|---|---|
| Nombre de saga | PascalCase + sufijo `Saga` | `PlaceOrderSaga` | `OrderFlow`, `OrderSagaProcess` |
| Step `action` | PascalCase, verbo+sustantivo | `ReserveStock`, `ProcessPayment` | `reserve_stock`, `doPayment` |
| Use case de compensación | `Compensate` + sustantivo de lo que se revierte | `CompensateStockReservation` | `RollbackStock`, `UndoPayment` |
| Evento de compensación | PascalCase + pasado + fallo + `Event` | `PaymentFailedEvent` | `PaymentError`, `FailedPaymentEvent` |
| Topic de compensación | SCREAMING_SNAKE_CASE semántico | `PAYMENT_FAILED` | `paymentFailed`, `PAYMENT-FAILED` |

**Regla crítica para `compensationUseCase`:**
Debe describir **la acción de deshacer**, con prefijo `Compensate` seguido del sustantivo del paso que se revierte — no el evento que lo dispara ni el módulo que lo procesa.

| El step hizo... | La compensación es... |
|---|---|
| `ReserveStock` | `CompensateStockReservation` |
| `ProcessPayment` | `CompensatePayment` |
| `CreateOrder` | `CompensateOrderPlacement` |
| `ScheduleDelivery` | `CompensateDeliveryScheduling` |

El valor de `compensationUseCase` en la saga **debe coincidir exactamente** con el `useCase` del listener que lo implementa en el `domain.yaml` del `compensationModule`. El validador S6-005 detecta cualquier discrepancia.

### Estructura `sagas:` en system.yaml

```yaml
sagas:
  - name: PlaceOrderSaga                            # PascalCase + "Saga"
    description: "Order creation with stock reservation and payment processing"
    trigger:
      module: orders
      useCase: CreateOrder
      httpMethod: POST
      path: /orders
    steps:
      - order: 1
        module: orders
        action: CreateOrder                          # Primer paso: iniciador de la saga
        emits: OrderPlacedEvent
        topic: ORDER_PLACED
        compensation: null                           # null explícito — no se compensa a sí mismo

      - order: 2
        module: inventory
        trigger: OrderPlacedEvent                    # Escucha este evento del paso anterior
        topic: ORDER_PLACED
        action: ReserveStock                         # Modifica estado → es compensable
        emits: StockReservedEvent
        successTopic: STOCK_RESERVED
        compensationEvent: StockReservationFailedEvent
        compensationTopic: STOCK_RESERVATION_FAILED
        compensationModule: orders                   # El módulo del paso anterior (paso 1) compensa
        compensationUseCase: CompensateOrderPlacement  # Debe coincidir con listener.useCase en orders.yaml

      - order: 3
        module: payments
        trigger: StockReservedEvent
        topic: STOCK_RESERVED
        action: ProcessPayment
        emits: PaymentApprovedEvent
        successTopic: PAYMENT_APPROVED
        compensationEvent: PaymentFailedEvent
        compensationTopic: PAYMENT_FAILED
        compensationModule: inventory                # El módulo del paso 2 compensa el paso 3
        compensationUseCase: CompensateStockReservation

      - order: 4
        module: orders
        trigger: PaymentApprovedEvent
        topic: PAYMENT_APPROVED
        action: ConfirmOrder                         # Paso final: destino exitoso de la saga
        emits: OrderConfirmedEvent
        successTopic: ORDER_CONFIRMED
        compensation: null                           # null explícito — último paso no tiene compensación

    observers:                                       # Módulos que reaccionan sin ser pasos formales de la saga
      - module: notifications
        on: [OrderPlacedEvent, PaymentApprovedEvent, PaymentFailedEvent]
```

### Wiring en domain.yaml — listeners de compensación

Por cada step con `compensationEvent`, el `compensationModule` **debe declarar un listener** en su `domain.yaml`. Esto se completa en el **Paso 7**:

```yaml
# En orders.yaml — compensationModule del paso 2
listeners:
  - event: StockReservationFailedEvent
    topic: STOCK_RESERVATION_FAILED
    useCase: CompensateOrderPlacement        # Idéntico a compensationUseCase del step 2
    fields:
      - name: orderId
        type: String

# En inventory.yaml — compensationModule del paso 3
listeners:
  - event: PaymentFailedEvent
    topic: PAYMENT_FAILED
    useCase: CompensateStockReservation      # Idéntico a compensationUseCase del step 3
    fields:
      - name: orderId
        type: String
```

> **Validación automática:** `eva evaluate system` ejecuta reglas S6. S6-003 detecta listeners de compensación faltantes y sugiere el snippet YAML exacto. S6-005 detecta discrepancias de nombre entre `compensationUseCase` y el `useCase` del listener.

---

## Paso 3 — Reglas obligatorias (resumen)

| Elemento | Convención | Ejemplo |
|---|---|---|
| Módulos | plural, kebab-case | `orders`, `product-catalog` |
| Eventos | PascalCase + pasado + `Event` | `OrderPlacedEvent` |
| Topics | SCREAMING_SNAKE_CASE sin prefix | `ORDER_PLACED` |
| Ports | PascalCase + `Service` único/módulo | `OrderCustomerService` |
| useCases | PascalCase, verbo+sustantivo | `CreateOrder`, `ConfirmOrder` |
| Sagas | PascalCase + sufijo `Saga` | `PlaceOrderSaga`, `CheckoutSaga` |
| Use case de compensación | `Compensate` + sustantivo del paso revertido | `CompensateStockReservation`, `CompensatePayment` |
| Eventos de compensación | PascalCase + pasado + fallo + `Event` | `PaymentFailedEvent`, `StockReservationFailedEvent` |
| Topics de compensación | SCREAMING_SNAKE_CASE con semántica clara | `PAYMENT_FAILED`, `STOCK_RESERVATION_FAILED` |

**Restricciones críticas:**
- Sin dependencias circulares síncronas
- Sin campos de dominio en system.yaml
- Sin port names genéricos compartidos entre módulos
- `consumers[].useCase` siempre presente y en PascalCase
- `calls.using:` solo referencia endpoints de `exposes:` del destino
- Cada consumer declara exactamente `useCase:` (lógica de negocio) o `readModel:` (proyección local), nunca ambos
- `readModel:` PascalCase + sufijo `ReadModel` — su módulo consumidor declara `readModels:` en domain.yaml

---

## Paso 4 — Checklist de validación

Antes de proponer el `system.yaml`, verifica:

- [ ] Módulos en plural kebab-case
- [ ] Eventos en tiempo pasado con sufijo `Event`
- [ ] Sin dependencias circulares síncronas
- [ ] Todos los `consumers[].module` existen en `modules:`
- [ ] Todos los `consumers[].useCase` presentes y en PascalCase
- [ ] `consumers[]` con `readModel:` en PascalCase + sufijo `ReadModel`
- [ ] Cada consumer tiene exactamente `useCase:` o `readModel:`, nunca ambos
- [ ] Todos los `calls.using:` existen en `exposes:` del destino
- [ ] Módulos pasivos no son `caller`
- [ ] Todo en inglés
- [ ] Archivo en `system/system.yaml`
- [ ] Si hay flujos async multi-paso con efectos acumulados → `sagas:` declarado en system.yaml
- [ ] Nombres de saga en PascalCase + sufijo `Saga`
- [ ] Step `action` en PascalCase, verbo+sustantivo
- [ ] `compensationUseCase` usa prefijo `Compensate` + sustantivo del paso que se revierte
- [ ] `compensationUseCase` de cada step coincide exactamente con el `useCase` del listener en `compensationModule`
- [ ] Pasos iniciador y final tienen `compensation: null` explícito
- [ ] Cada `compensationModule` tiene listener declarado en su `domain.yaml` (completar en Paso 7)
- [ ] Cada `modules[].exposes[]` tiene un caso de uso HTTP planificado en `system.md` y `system/{module}.md`
- [ ] Cada `integrations.async[].consumers[].useCase` tiene un caso de uso de tipo `Incoming Event` planificado en `system.md` y `system/{module}.md`
- [ ] Todos los `HTTP Command` declaran `Response body: none`
- [ ] Todos los `HTTP Query` declaran `Response body` detallado
- [ ] Todos los `Incoming Event` declaran `Trigger event`, `Consumed payload` y `Produced payload` cuando corresponda
- [ ] `Exposed Endpoints` se usa solo como índice/resumen y no duplica contratos completos
- [ ] Todos los detalles de parámetros por caso de uso se expresan en tablas Markdown o en `none` cuando no aplican

---

## Paso 5 — Presentar y continuar

1. Crea `system/` si no existe
2. Guarda `system/system.yaml`
3. Muestra el YAML completo
4. Explica decisiones no obvias
5. Menciona advertencias (acoplamiento, responsabilidades difusas)
6. Indica: `eva generate system`
7. Procede inmediatamente a los pasos 6 → 6.5 → 7 → 8

---

## Paso 6 — Crear system.md

Lee `references/module-spec.md` (sección "Estructura del system.md") para la estructura obligatoria.

El `system/system.md` es la **especificación técnica narrativa** del sistema. Una sección `##` por módulo con: rol detallado, casos de uso, índice de endpoints, eventos emitidos, puertos síncronos y read models si aplican.

Reglas obligatorias para `system/system.md`:
- Los casos de uso HTTP son la **fuente canónica** del contrato HTTP.
- Cada `HTTP Command` debe incluir dentro del caso de uso: `Endpoint`, `Path params`, `Query params`, `Request body` y `Response body: none`.
- Cada `HTTP Query` debe incluir dentro del caso de uso: `Endpoint`, `Path params`, `Query params`, `Request body: none` y `Response body` detallado.
- Cada `Incoming Event` debe incluir dentro del caso de uso: `Trigger event`, `Consumed payload` y `Produced payload` cuando aplique.
- El detalle de `Path params`, `Query params`, `Request body`, `Response body`, `Consumed payload` y `Produced payload` debe presentarse en **tablas Markdown** para facilitar lectura y comparación entre casos de uso.
- La sección `Exposed Endpoints` en `system.md` es solo un **índice/resumen** y nunca debe repetir tablas, JSON schemas ni contratos detallados ya definidos en `Use Cases`.

---

## Paso 6.5 — Diagramas C4 (Context + Container)

Inmediatamente después del `system.md`, genera **dos archivos Mermaid** con diagramas C4:

### `system/c4-context.mmd` — Diagrama de Contexto

Muestra el sistema como una **caja única** rodeada de actores y sistemas externos. Responde: "¿Qué construimos y quién/qué interactúa con ello?"

```mermaid
C4Context
    title System Context diagram for {System Name}

    Person(user, "User", "Primary user who interacts with the system")
    Person(admin, "Administrator", "Manages system configuration")

    System(system, "{System Name}", "Core platform that manages {domain description}")

    System_Ext(emailSys, "Email Service", "Sends transactional emails")
    System_Ext(paymentGw, "Payment Gateway", "Processes credit card payments")

    Rel(user, system, "Places orders, checks status", "HTTPS")
    Rel(admin, system, "Manages catalog and configuration", "HTTPS")
    Rel(system, emailSys, "Sends notifications", "SMTP")
    Rel(system, paymentGw, "Processes payments", "HTTPS")
```

**Reglas del Context diagram:**
- El sistema completo es **un solo nodo** `System()` — no descomponer en módulos aquí
- `Person()` para cada actor humano que interactúa con la API
- `System_Ext()` para cada sistema externo (pasarelas de pago, email, servicios terceros)
- Derivar sistemas externos de `integrations.sync[]` donde `calls` apunta a un servicio externo (no un módulo del propio sistema)
- `Rel()` describe la relación con verbo + protocolo
- Solo incluir actores y sistemas que realmente aparecen en `system.yaml`

### `system/c4-container.mmd` — Diagrama de Contenedores

Descompone el sistema en **contenedores**: cada módulo es un Container, el broker es un ContainerQueue, las bases de datos son ContainerDb.

```mermaid
C4Container
    title Container diagram for {System Name}

    Person(user, "User", "Primary user of the system")

    System_Boundary(boundary, "{System Name}") {
        Container(orders, "orders", "Spring Boot Module", "Order lifecycle management")
        Container(payments, "payments", "Spring Boot Module", "Payment processing")
        Container(notifications, "notifications", "Spring Boot Module", "Email and SMS notifications")

        ContainerDb(db, "Database", "PostgreSQL", "Stores all module data")
        ContainerQueue(broker, "Message Broker", "Apache Kafka", "Async event streaming between modules")
    }

    System_Ext(paymentGw, "Payment Gateway", "External payment processing service")
    System_Ext(emailSvc, "Email Service", "Transactional email delivery")

    Rel(user, orders, "Places orders", "REST/HTTPS")
    Rel(user, payments, "Views payment status", "REST/HTTPS")

    Rel(orders, broker, "Publishes", "OrderPlacedEvent")
    Rel(broker, payments, "Delivers", "OrderPlacedEvent")
    Rel(broker, notifications, "Delivers", "OrderPlacedEvent")

    Rel(payments, broker, "Publishes", "PaymentApprovedEvent")
    Rel(broker, orders, "Delivers", "PaymentApprovedEvent")
    Rel(broker, notifications, "Delivers", "PaymentApprovedEvent")

    Rel(orders, db, "Reads/Writes", "JDBC")
    Rel(payments, db, "Reads/Writes", "JDBC")
    Rel(notifications, db, "Reads/Writes", "JDBC")

    Rel(payments, paymentGw, "Processes payment", "HTTPS")
    Rel(notifications, emailSvc, "Sends email", "SMTP")
```

**Reglas del Container diagram:**

- `System_Boundary()` agrupa todos los contenedores internos del sistema
- Un `Container()` por cada módulo en `modules:` — usar el nombre del módulo como id y label
- La tecnología es `"Spring Boot Module"` y la descripción viene de `modules[].description`
- `ContainerDb()` para la base de datos — derivar el tipo de `system.database`
- `ContainerQueue()` para el broker — solo si `messaging.enabled: true`; usar el tipo de `messaging.broker`
- `System_Ext()` fuera del boundary para servicios externos
- **Flechas async siempre pasan por el broker**: `producer → broker` y `broker → consumer`, nunca directo
- **Read Model sync también pasa por el broker**: `Rel(source, broker, "ProductCreatedEvent", "Kafka")` + `Rel(broker, consumer, "Sync ProductReadModel", "Kafka")` — no usar flecha directa
- **Flechas sync** directas entre containers: de caller a callee con label del port name
- Los `Rel()` de eventos incluyen el nombre del evento en el campo `technology`/label
- Derivar actores `Person()` de quienes consumen los `exposes[]`

### Correspondencia system.yaml → C4

| Fuente en system.yaml | C4 Context | C4 Container |
|---|---|---|
| `system.name` | `System()` título | `System_Boundary()` |
| `modules[]` | _(no aparece)_ | `Container()` uno por módulo |
| `modules[].exposes[]` | `Rel(Person→System)` | `Rel(Person→Container)` |
| `integrations.async[]` | _(no aparece)_ | `Rel()` via `ContainerQueue` |
| `integrations.sync[]` (interno) | _(no aparece)_ | `Rel()` directo entre Containers |
| `integrations.sync[]` (externo) | `System_Ext()` + `Rel()` | `System_Ext()` + `Rel()` |
| `messaging.broker` | _(no aparece)_ | `ContainerQueue()` |
| `system.database` | _(no aparece)_ | `ContainerDb()` |

### Checklist de los diagramas C4

Antes de guardar, verifica:

**Context (`c4-context.mmd`):**
- [ ] Sistema representado como un solo nodo `System()`
- [ ] Un `Person()` por cada tipo de actor
- [ ] Un `System_Ext()` por cada servicio externo real
- [ ] Relaciones con verbo descriptivo + protocolo
- [ ] No contiene módulos internos — eso es Container

**Container (`c4-container.mmd`):**
- [ ] `System_Boundary` agrupa todos los containers
- [ ] Un `Container()` por cada módulo en `modules:`
- [ ] `ContainerDb` con tipo de BD del proyecto
- [ ] `ContainerQueue` si hay mensajería (tipo de broker correcto)
- [ ] Flujos async pasan por el queue: `module → broker → consumer`
- [ ] Flujos sync son directos: `caller → callee`
- [ ] Servicios externos fuera del boundary como `System_Ext()`
- [ ] Todo en inglés
- [ ] Cada archivo contiene **solo** el bloque Mermaid

---

## Paso 7 — Crear domain.yaml por módulo

Lee `references/domain-yaml-spec.md` para la especificación completa de estructura, reglas, restricciones y checklist del `system/{module}.yaml`.

Para cada módulo en `modules:`, genera `system/{nombre-del-modulo}.yaml` con: aggregates, entities, valueObjects, enums (con transitions si aplica), events, endpoints, listeners, ports y **readModels** — todo inferido del `system.yaml`.

### Wiring de listeners de compensación desde `sagas:`

Si `system.yaml` tiene una sección `sagas:`, **por cada step con `compensationEvent`**, verifica que el `compensationModule` tenga el listener declarado en su `domain.yaml`. Si no existe, agrégalo:

1. Localiza el step: extrae `compensationEvent`, `compensationTopic`, `compensationModule`, `compensationUseCase`
2. En el `domain.yaml` del `compensationModule`, agrega a `listeners:`:
   ```yaml
   - event: {compensationEvent}           # Ej: StockReservationFailedEvent
     topic: {compensationTopic}           # Ej: STOCK_RESERVATION_FAILED
     useCase: {compensationUseCase}       # Ej: CompensateOrderPlacement — DEBE ser idéntico al step
     fields:
       - name: {aggregateId}              # Siempre incluir el id del agregado raíz de la saga
         type: String
   ```
3. Si el mismo `compensationModule` aparece en múltiples steps, agrupa todos los listeners en el mismo `domain.yaml`
4. **Dos reglas de unicidad para `compensationUseCase`** (ambas se validan con `eva evaluate system`):

   - **Regla 1 — Intra-módulo (C2-013):** Si el mismo `compensationModule` tiene ≥2 steps, usa un `compensationUseCase` distinto por step. `UseCaseAutoRegister` solo registra un tipo genérico por handler — compartir el mismo nombre entre múltiples listeners del mismo módulo causa `IllegalArgumentException` en runtime.

   - **Regla 2 — Cross-módulo (C3-007):** El `compensationUseCase` debe ser **globalmente único en todo el sistema**. Si módulo A usa `CompensateStockReservation` y módulo B también usa `CompensateStockReservation` (aunque compensen cosas distintas), Spring genera dos beans `CompensateStockReservationCommandHandler` → `ConflictingBeanDefinitionException`. Usa nombres semánticos que incluyan el contexto del paso revertido.

   ```yaml
   # ✅ CORRECTO — 3 useCases distintos por step Y globalmente únicos en el sistema
   sagas:
     - name: CartCheckoutSaga
       steps:
         - ...
         - compensationEvent: OrderDraftCreationFailedEvent
           compensationModule: carts
           compensationUseCase: CompensateOrderDraftCreation   # único global
         - compensationEvent: StockReservationFailedEvent
           compensationModule: carts
           compensationUseCase: CompensateStockReservation     # único global
         - compensationEvent: PaymentFailedEvent
           compensationModule: carts
           compensationUseCase: CompensatePayment              # único global
   ```
   Si otro módulo (ej: `inventory`) también necesitara compensar stock por otro motivo, NO puede reutilizar `CompensateStockReservation` — debe usar un nombre distinto como `ReleaseStockReservationOnPaymentFailed`.

5. El `useCase` del listener es el **punto de entrada** de la compensación — el developer implementa el `CommandHandler` generado con la lógica de reversión

> **Invariante:** `step.compensationUseCase` en `system.yaml` == `listeners[].useCase` en `{compensationModule}.yaml` Y globalmente único entre todos los módulos. S6-005 detecta discrepancias; C2-013 y C3-007 detectan colisiones.

### Endpoints en módulos con múltiples agregados

Si el módulo tiene **2 o más agregados** (ej: `Product` + `Category`), la sección `endpoints:` debe usar `basePath: ""` (string vacío) y paths **absolutos** en cada operación:

```yaml
# Módulo con 2+ agregados → basePath vacío
endpoints:
  basePath: ""
  versions:
    - version: v1
      operations:
        - useCase: CreateProduct
          method: POST
          path: /products
        - useCase: CreateCategory
          method: POST
          path: /categories
```

Si el módulo tiene **un solo agregado**, usar `basePath: /recurso` con paths relativos (ej: `/`, `/{id}`).

**NUNCA usar `basePath: /`** (con slash) — genera trailing slash en `@RequestMapping`. Usar `basePath: ""` (vacío).

### Inferencia de readModels desde system.yaml

Cuando `integrations.async[].consumers[]` tiene `readModel:` y el `module` es el módulo actual:
1. Agrupar todos los eventos del mismo `readModel:` → una entrada `readModels:` con múltiples `syncedBy`
2. `source.module` = el `producer` de esas integraciones async
3. `source.aggregate` = derivar del nombre del readModel (ej: `ProductReadModel` → `Product`)
4. `tableName` = `rm_` + consumer module + `_` + source module en snake_case (ej: `rm_orders_products`)
5. `fields` = inferir del payload del evento fuente (incluir siempre `id`)
6. `syncedBy[].action` = `UPSERT` para Created/Updated, `SOFT_DELETE` para Deactivated, `DELETE` para Deleted
7. Si había una entrada `integrations.sync[]` al mismo módulo fuente → **no generar `ports:`** para esa llamada (el readModel la reemplaza)

### Lifecycle events en módulos fuente

Cuando el módulo actual es `producer` en `integrations.async[]` y algún consumer tiene `readModel:`, los eventos de este módulo deben usar `lifecycle:` (operación CRUD) en vez de `triggers:` (transición de estado).

Para cada evento de este módulo consumido por un readModel:

1. Agregar `lifecycle:` al evento — derivar el valor del nombre del evento:
   | Patrón del nombre | `lifecycle:` |
   |---|---|
   | `*CreatedEvent`, `*RegisteredEvent` | `create` |
   | `*UpdatedEvent` | `update` |
   | `*DeletedEvent` | `delete` |
   | `*DeactivatedEvent` | `softDelete` |

2. **NO** agregar `triggers:` — estos eventos son CRUD, no transiciones de estado
3. Si `lifecycle: softDelete` → la entidad raíz **debe** tener `hasSoftDelete: true`
4. Si `lifecycle: delete` → la entidad raíz **NO debe** tener `hasSoftDelete: true`
5. `fields:` del evento debe incluir **todos** los campos declarados en el `readModels[].fields` del módulo consumidor (el payload es la fuente de verdad de la proyección)
6. Siempre incluir `{entityName}Id` como campo (se mapea a `aggregateId` del DomainEvent base)
7. `fields:` del lifecycle event solo puede contener: (a) `{entityName}Id` (aggregateId), (b) campos que existen en la entidad raíz, (c) campos temporales `*At` + `LocalDateTime`. No incluir campos que no existan en la entidad — genera error `C2-010`
8. Los campos de los readModels consumidores deben ser subconjunto de los campos de la entidad raíz del productor. Si el readModel necesita un campo, ese campo debe existir en la entidad fuente — de lo contrario los lifecycle events no podrán emitirlo (C2-010) y el campo siempre será null (C1-007)

**Ejemplo — módulo `products` como fuente de `ProductReadModel`:**

```yaml
aggregates:
  - name: Product
    entities:
      - name: product
        isRoot: true
        tableName: products
        hasSoftDelete: true
        audit:
          enabled: true
        fields:
          - name: id
            type: String
          - name: name
            type: String
          - name: price
            type: BigDecimal
          - name: status
            type: String
            readOnly: true
            defaultValue: "ACTIVE"
    events:
      - name: ProductCreatedEvent
        lifecycle: create
        fields:
          - name: productId
            type: String
          - name: name
            type: String
          - name: price
            type: BigDecimal
          - name: status
            type: String
      - name: ProductUpdatedEvent
        lifecycle: update
        fields:
          - name: productId
            type: String
          - name: name
            type: String
          - name: price
            type: BigDecimal
          - name: status
            type: String
      - name: ProductDeactivatedEvent
        lifecycle: softDelete
        fields:
          - name: productId
            type: String
          - name: deactivatedAt
            type: LocalDateTime
```

---

## Paso 8 — Crear especificación técnica por módulo

Lee `references/module-spec.md` para la estructura obligatoria del `system/{module}.md`.

Para cada módulo, genera `system/{nombre-del-modulo}.md` con: rol del módulo, invariantes, máquina de estados, diagrama de interacciones, diagrama de secuencia, casos de uso detallados, índice de endpoints, eventos, puertos y read models si aplican.

Reglas obligatorias para `system/{module}.md`:
- Los `Use Cases` son la **única fuente de verdad** de los contratos HTTP.
- Cada endpoint definido en `system.yaml -> modules[].exposes[]` debe mapear a exactamente un caso de uso de tipo `HTTP Command` o `HTTP Query` en el módulo correspondiente.
- Cada consumer definido en `system.yaml -> integrations.async[].consumers[].useCase` debe mapear a exactamente un caso de uso de tipo `Incoming Event`.
- El detalle de parámetros de cada caso de uso debe presentarse en **tablas Markdown** dentro del propio caso de uso. Solo se permite `none` cuando la sección no aplica.
- `Exposed Endpoints` debe funcionar como índice navegable: `Use case`, `Purpose` y referencia al contrato embebido en el caso de uso. No debe duplicar `Path params`, `Query params`, `Request body`, `Response body` ni tablas de errores.
- Si un caso de uso HTTP no declara `Endpoint`, `Path params`, `Query params` y `Request body`, la generación es incompleta.

---

## Paso 9 — Artefactos post-diseño

Inmediatamente después de completar el Paso 8, genera tres artefactos finales que contextualizan el sistema recién diseñado.

### Paso 9a — Reescribir AGENTS.md (project-specific)

Reescribe el archivo `AGENTS.md` en la **raíz del proyecto** con contenido específico para el sistema diseñado.

**Proceso:**

1. Lee el `AGENTS.md` actual como template base
2. Analiza `system/system.yaml` y todos los `system/{module}.yaml` para detectar qué features se usan:
   - Tipo de broker (Kafka / RabbitMQ / ninguno)
   - `readModels:` en algún módulo
   - `ports:` (llamadas HTTP síncronas)
   - `listeners:` (consumidores de eventos)
   - `events:` con `triggers:` vs `lifecycle:`
   - `hasSoftDelete` en alguna entidad
   - `audit.trackUser` en alguna entidad
   - Value Objects con `methods:`
   - Enums con `transitions:` e `initialValue`
   - Flags de campo: `readOnly`, `hidden`, `defaultValue`, `validations`, `reference`
3. **Poda** secciones de features no usados según estas reglas:

| Condición | Sección a eliminar |
|---|---|
| Sin Temporal | "Temporal Workflows" completa |
| Sin `readModels:` | Subsecciones readModels de "Características Avanzadas" y checklist |
| Sin `ports:` | Subsecciones ports |
| Sin `listeners:` | Subsecciones listeners |
| Sin `hasSoftDelete` | Sección soft delete y checklist items |
| Sin `audit.trackUser` | Infraestructura UserContextFilter/UserContextHolder/AuditorAwareImpl (mantener audit básico si `audit.enabled`) |
| Sin VO `methods:` | "Value Objects con Métodos" |
| Sin enum `transitions:` | "Enums con Ciclo de Vida" |

4. **Especializa** el contenido restante:
   - Reemplaza ejemplos genéricos (`User`, `Order`) con entidades/módulos reales del proyecto
   - Actualiza la sección de comandos `eva` con los nombres de módulos reales
   - Actualiza el ejemplo de `domain.yaml` con la estructura real del proyecto
   - Reduce el checklist a solo items relevantes para este proyecto
5. Agrega un **header de contexto** al inicio:

```markdown
# AI Agent Guide — {System Name}

## Project Overview
- **System:** {name} — {brief description from system.yaml}
- **Modules:** {list of modules with 1-line descriptions}
- **Messaging:** {broker type or "none"}
- **Database:** {database type}
- **Java:** {javaVersion} / **Spring Boot:** {springBootVersion}
```

6. **Siempre conserva** (son universales): principios DDD, arquitectura hexagonal, reglas de mappers, reglas de DTOs, diagramas de flujo de datos (Command write / Query read), patrones de testing
7. Escribe **todo en inglés**
8. **Límite: ≤ 1000 líneas** — poda agresivamente, comprime ejemplos, evita redundancia

---

### Paso 9b — Crear system/VALIDATION_FLOWS.md

Genera `system/VALIDATION_FLOWS.md` con los flujos de validación técnica del sistema. Toda la información se deriva de `system.yaml` y los `{module}.yaml`.

**Estructura obligatoria:**

```markdown
# Validation Flows — {System Name}

## Prerequisites
- Services: {infrastructure requerida — DB, broker, etc.}
- Startup order: {si relevante}
- Base URLs: {por módulo si difieren}

## 1. Module Validation

### 1.1 {Module Name}

#### CRUD Operations
| # | Operation | Endpoint | Payload/Params | Expected Result | Validates |
|---|-----------|----------|----------------|-----------------|------ ----|
| 1 | Create | POST /x | {key fields} | 201 + entity | {invariant} |
| 2 | Get by ID | GET /x/{id} | — | 200 + entity | — |
| 3 | List | GET /x | — | 200 + page | — |
| 4 | Update | PUT /x/{id} | {fields} | 200 + updated | — |
| 5 | Delete | DELETE /x/{id} | — | 204 | — |

#### State Transitions (if module has enum transitions)
| # | Transition | Endpoint | Precondition | Expected | Event Emitted |
|---|-----------|----------|--------------|----------|---------------|
| 1 | DRAFT→PUBLISHED | PUT /x/{id}/publish | exists in DRAFT | 200, status=PUBLISHED | XPublishedEvent |

#### Business Rules
| # | Rule | How to Trigger | Expected Error |
|---|------|----------------|----------------|

(repeat per module)

## 2. Integration Flows

### 2.1 {Flow Name}: {Event} → {Consumer Module}
**Trigger:** {action that emits the event}
**Steps:**
1. {Create/modify entity in producer module}
2. {Event emitted}: {EventName} on topic {TOPIC_NAME}
3. {Consumer module} processes via {useCase}
4. **Verify:** {expected state change in consumer}

(repeat per async integration)

## 3. Read Model Synchronization (if applicable)
### 3.1 {ReadModelName}
| Source Event | Action | Verification |
|---|---|---|
| XCreatedEvent | UPSERT | Query rm_table, record exists |
| XUpdatedEvent | UPSERT | Fields updated |
| XDeactivatedEvent | SOFT_DELETE | Record marked deleted |

## 4. Sync Port Calls (if applicable)
### 4.1 {PortName}: {caller} → {target}
| Method | Expected | Fallback |
|---|---|---|

## 5. Error & Edge Cases
| # | Scenario | Steps | Expected Error |
|---|----------|-------|----------------|
| 1 | Create with missing required field | POST /x without {field} | 400 + validation message |
| 2 | Invalid state transition | PUT /x/{id}/action when invalid state | 400/409 + business error |
| 3 | Get non-existent entity | GET /x/{invalid-id} | 404 |
```

**Reglas:**
- Cada flujo debe ser concreto: paths reales, nombres de eventos reales, campos reales del proyecto
- Incluir payloads JSON sugeridos donde sea útil
- Omitir secciones enteras si no aplican (ej: sin readModels → omitir sección 3)
- Todo en inglés

---

### Paso 9c — Crear system/USER_FLOWS.md

Genera `system/USER_FLOWS.md` con los flujos end-to-end desde la perspectiva del usuario.

**Estructura obligatoria:**

```markdown
# User Flows — {System Name}

## Actors
| Actor | Description | Modules Interacted |
|-------|-------------|--------------------|
| {Actor 1} | {role description} | {module list} |

## Flow 1: {Business Process Name}
**Actor:** {who}
**Goal:** {what they want to achieve}
**Preconditions:** {initial state}

### Happy Path
| Step | User Action | System Response | Behind the Scenes |
|------|-------------|-----------------|-------------------|
| 1 | {does X} | {sees Y} | {endpoint called, event emitted, etc.} |
| 2 | {does Z} | {sees W} | {consumer processes, state changes} |

### Alternative Paths
| Condition | At Step | What Happens |
|-----------|---------|---------- ---|
| {condition} | {N} | {alternative outcome} |

### Error Paths
| Error | At Step | User Sees |
|-------|---------|----------|
| {error} | {N} | {error message/behavior} |

(repeat per major business flow)
```

**Reglas:**
- Derivar actores de quienes consumen los `exposes[]` (misma fuente que `Person()` del C4 Context)
- Cada flujo es un **escenario de negocio completo** que cruza módulos cuando aplica
- La columna "Behind the Scenes" conecta la experiencia de usuario con la realidad técnica (eventos, procesamiento async, state changes)
- Incluir al menos un flujo por cada camino principal de caso de uso del sistema
- Foco en comportamiento observable por el usuario, no implementación interna
- Todo en inglés

---

## Ciclo de refinamiento

Después de entregar v1, si el usuario pide ajustes:
- Aplica el **cambio mínimo** necesario
- Revalida el checklist del Paso 4
- Actualiza `system.md`, `c4-context.mmd`, `c4-container.mmd`, `{module}.yaml` y `{module}.md` afectados
- Actualiza `AGENTS.md`, `VALIDATION_FLOWS.md` y `USER_FLOWS.md` si fueron afectados por el cambio
- Entrega solo el diff explicado
