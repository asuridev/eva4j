# Metodología de Diseño con Temporal como Broker

## 📋 Propósito

Guía paso a paso para diseñar un sistema de microservicios usando **Temporal como único mecanismo de comunicación inter-módulo**, reemplazando Kafka (async) y Feign (sync). Define qué va en `system.yaml`, qué va en cada `{domain}.yaml`, y las mejores prácticas para tomar decisiones de diseño.

**Documentos complementarios:**
- [TEMPORAL_COMMUNICATION_PATTERNS.md](TEMPORAL_COMMUNICATION_PATTERNS.md) — Patrones de comunicación (Remote Activity, Child Workflow, Signal, Async.function)
- [system/RISKS.md](system/RISKS.md) — Análisis de riesgos y trade-offs

---

## 🗺️ Visión General de la Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        system.yaml                              │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────────────────┐   │
│  │ system:  │  │ modules: │  │ workflows:                  │   │
│  │          │  │          │  │  PlaceOrderWorkflow          │   │
│  │ name     │  │ products │  │  CancelOrderWorkflow         │   │
│  │ database │  │ orders   │  │  ProductCreatedWorkflow      │   │
│  │ temporal │  │ payments │  │  (orquestación cross-module) │   │
│  └──────────┘  └──────────┘  └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
        ↕                ↕                    ↕
┌──────────────┐ ┌──────────────┐ ┌──────────────────────────────┐
│ products.yaml│ │ orders.yaml  │ │ payments.yaml                │
│              │ │              │ │                              │
│ aggregates:  │ │ aggregates:  │ │ aggregates:                  │
│  Product     │ │  Order       │ │  Payment                     │
│              │ │              │ │                              │
│ events:      │ │ events:      │ │ events:                      │
│  (internos)  │ │  (→notifies) │ │  (internos)                  │
│              │ │              │ │                              │
│ activities:  │ │ activities:  │ │ activities:                  │
│  GetProduct  │ │  ConfirmOrder│ │  ProcessPayment              │
│  (cross-mod) │ │  (local)     │ │  RefundPayment (cross-mod)   │
│              │ │              │ │  RetryCharge (interna)       │
│ endpoints:   │ │ endpoints:   │ │                              │
│  REST API    │ │  REST API    │ │ workflows: (single-module)   │
│              │ │              │ │  RetryChargeWorkflow         │
│              │ │ workflows:   │ │                              │
│              │ │  ExpireOrder │ │ ports: (servicios EXTERNOS)  │
│              │ │  (interno)   │ │  PaymentGateway (HTTP)       │
└──────────────┘ └──────────────┘ └──────────────────────────────┘
```

---

## 📐 Qué va en Cada Archivo

### `system.yaml` — Vista de Pájaro (Orquestación)

El system.yaml es el **mapa de navegación** del sistema. Contiene todo lo que cruza fronteras de módulo.

| Sección | Contenido | Ejemplo |
|---------|-----------|---------|
| `system:` | Metadata del proyecto | nombre, database, Spring Boot version |
| `orchestration:` | Configuración de Temporal | target, namespace |
| `modules:` | Lista de módulos con endpoints REST | products, orders, payments |
| `workflows:` | **Flujos cross-module** | PlaceOrderWorkflow, CancelOrderWorkflow |

**Regla cardinal:** Si un flujo toca **2+ módulos**, se define en `system.yaml`.

```yaml
# system.yaml — SOLO orquestación cross-module
workflows:
  - name: PlaceOrderWorkflow
    trigger:
      module: orders
      on: create
    taskQueue: ORDER_WORKFLOW_QUEUE
    saga: true
    steps:
      - activity: GetCustomerById       # → customers
      - activity: GetProductsByIds      # → products   ⎫ parallel
      - activity: ReserveStock          # → inventory  ⎭
      - activity: ProcessOrderPayment   # → payments
      - activity: ConfirmOrder          # → orders (local)
      - activity: NotifyOrderPlaced     # → notifications (async)
```

### `{domain}.yaml` — Vista Interna del Módulo

Cada domain.yaml define **lo que el módulo ES y lo que OFRECE**.

| Sección | Contenido | Ejemplo |
|---------|-----------|---------|
| `aggregates:` | Modelo de dominio (entities, VOs, enums) | Product, Order, Payment |
| `events:` | Domain Events internos (con o sin `notifies`) | ProductCreatedEvent |
| `activities:` | **Capacidades del módulo** (cross-module e internas) | GetProductById, ReserveStock, ConfirmOrder |
| `workflows:` | **Flujos internos** del módulo (single-module) | RetryChargeWorkflow, ExpireOrderWorkflow |
| `endpoints:` | API REST del módulo | GET /products, POST /orders |
| `ports:` | Servicios **EXTERNOS** (no-Temporal) | PaymentGateway HTTP |

**Regla cardinal:** El domain.yaml declara lo que el módulo **sabe hacer**. NO declara cómo otros lo usan.

```yaml
# inventory.yaml — lo que inventory OFRECE
activities:
  - name: ReserveStock           # Capacidad de escritura
    type: light
    input: [orderId, items]
    output: [success]
    compensation: ReleaseStock   # Su propia compensación

  - name: ReleaseStock           # Capacidad de compensación
    type: light
    input: [orderId, items]
```

### Workflows en `system.yaml` vs `{domain}.yaml`

**Regla de separación:**

| Criterio | Ubicación | Ejemplo |
|----------|-----------|--------|
| Flujo cruza **2+ módulos** | `system.yaml` | PlaceOrderWorkflow (orders→inventory→payments→notifications) |
| Flujo es **interno** a 1 módulo | `{domain}.yaml` | RetryChargeWorkflow (payments→payments) |

Un workflow single-module es un proceso interno del bounded context que no involucra activities de otros módulos. Se declara en el `{domain}.yaml` del módulo porque es una **capacidad interna**, no una decisión de sistema.

```yaml
# payments.yaml — workflow INTERNO del módulo
workflows:
  - name: RetryChargeWorkflow
    trigger:
      on: paymentFailed
    taskQueue: PAYMENT_WORKFLOW_QUEUE
    steps:
      - activity: RetryCharge          # activity local de payments
        retryPolicy:
          maxAttempts: 3
          backoff: exponential
      - activity: NotifyChargeResult   # activity local de payments
```

**Ejemplos de workflows single-module:**

| Módulo | Workflow | Propósito |
|--------|----------|---------|
| payments | `RetryChargeWorkflow` | Reintentar cobro fallido con backoff exponencial |
| inventory | `ReplenishStockWorkflow` | Reabastecer cuando el stock cae bajo mínimo |
| customers | `VerifyEmailWorkflow` | Enviar código, esperar verificación con timeout |
| orders | `ExpireOrderWorkflow` | Cancelar orden pendiente tras X minutos sin pago |

**Señales de que un workflow es single-module:**
- Todas sus activities pertenecen al mismo módulo
- No necesita datos de otros bounded contexts
- Es un proceso interno (retry, timeout, scheduling, verificación)
- Otros módulos no necesitan saber que existe

---

## 🔄 Proceso de Diseño (8 Pasos)

### Paso 1: Identificar los Bounded Contexts (Módulos)

Listar los módulos del sistema con su responsabilidad principal.

```yaml
modules:
  - name: products     # "Qué vendemos"
  - name: customers    # "A quién le vendemos"
  - name: orders       # "Qué nos piden"
  - name: payments     # "Cómo nos pagan"
  - name: inventory    # "Cuánto tenemos"
  - name: notifications # "A quién avisamos"
```

**Pregunta clave:** ¿Este módulo tiene su propia base de datos / tabla? Si sí, es un módulo.

### Paso 2: Modelar los Agregados (domain.yaml)

Para cada módulo, definir el modelo de dominio puro. Este paso es **idéntico** con o sin Temporal.

```yaml
# orders.yaml
aggregates:
  - name: Order
    entities:
      - name: order
        isRoot: true
        fields: [id, customerId, status, totalAmount, ...]
    enums:
      - name: OrderStatus
        transitions: [...]
    valueObjects:
      - name: ShippingAddress
```

**No pensar en workflows todavía.** Solo el dominio puro.

### Paso 3: Identificar los Domain Events

Para cada agregado, listar los hechos de negocio relevantes:

```yaml
events:
  - name: OrderPlacedEvent       # Se colocó una orden
  - name: OrderCancelledEvent    # Se canceló una orden
  - name: ProductCreatedEvent    # Se creó un producto nuevo
  - name: PaymentApprovedEvent   # Se aprobó un pago
```

**Pregunta clave para cada evento:** ¿Algo DEBE ocurrir en OTRO módulo cuando esto pasa?

| Evento | ¿Efecto cross-module? | Resultado |
|--------|----------------------|-----------|
| OrderPlacedEvent | SÍ → reservar stock, cobrar, notificar | **Workflow** |
| OrderCancelledEvent | SÍ → liberar stock, reembolsar, notificar | **Workflow** |
| ProductCreatedEvent | SÍ → inicializar stock en inventory | **Workflow** |
| ProductUpdatedEvent | NO → nadie necesita reaccionar | **Domain Event interno** |
| CustomerCreatedEvent | NO → nadie necesita reaccionar | **Domain Event interno** |
| PaymentApprovedEvent | NO → ya está dentro del workflow de orden | **Domain Event interno** |

### Paso 4: Diseñar los Workflows (system.yaml)

Para cada evento que **SÍ tiene efecto cross-module**, diseñar el workflow.

**Árbol de decisión para cada step:**

```
¿Este step modifica datos?
│
├─ SÍ → ¿En otro módulo?
│  │
│  ├─ SÍ → ¿Necesita compensación si un paso posterior falla?
│  │  │
│  │  ├─ SÍ → Activity con compensation: (dentro de saga: true)
│  │  │        Ej: ReserveStock + compensation: ReleaseStock
│  │  │
│  │  └─ NO → Activity sin compensación
│  │          Ej: paso final de la saga, nada que deshacer
│  │
│  └─ NO → Activity LOCAL del propio módulo
│          Ej: ConfirmOrder (orders actualiza su propia orden)
│
└─ NO → ¿Lee datos de otro módulo?
   │
   ├─ SÍ → Activity de lectura (Remote Activity)
   │        Ej: GetCustomerById → customers
   │
   └─ NO → ¿Notifica sin esperar respuesta?
      │
      ├─ SÍ → Activity async (type: async / Async.function)
      │        Ej: NotifyOrderPlaced → notifications
      │
      └─ NO → No necesita step
```

**¿Steps paralelos?** Si 2+ steps son **independientes entre sí**, marcarlos con `parallel: true`:

```yaml
# GetProductsByIds y ReserveStock no dependen uno del otro
- activity: GetProductsByIds
  parallel: true           # Async.function()
- activity: ReserveStock
  parallel: true           # Async.function()
# → Promise.allOf(productPromise, stockPromise).get()
```

### Paso 5: Definir las Activities de cada Módulo (domain.yaml)

Cada módulo declara las **capacidades** que ofrece — tanto a workflows cross-module como a sus propios workflows internos.

**4 tipos de activities:**

| Tipo | Ámbito | Propósito | Ejemplo | Task Queue |
|------|--------|-----------|---------|------------|
| **Lectura** | Cross-module | Consultar datos del módulo | `GetCustomerById` | `{MOD}_LIGHT_TASK_QUEUE` |
| **Escritura** | Cross-module | Ejecutar una operación de negocio | `ReserveStock`, `ProcessPayment` | `{MOD}_LIGHT_TASK_QUEUE` o `{MOD}_HEAVY_TASK_QUEUE` |
| **Compensación** | Cross-module | Deshacer una operación | `ReleaseStock`, `RefundPayment` | misma que su operación |
| **Local** | Interno | Operación invocada por workflows del propio módulo | `ConfirmOrder`, `RetryCharge` | `{MOD}_LIGHT_TASK_QUEUE` |

> **Nota:** Una activity **local** y una **cross-module** se declaran igual en `activities[]` — la diferencia es solo quién la invoca. Si un workflow de `system.yaml` referencia una activity, es cross-module. Si solo la usan workflows del propio `{domain}.yaml`, es local. No hay distinción sintáctica.

**Regla de aislamiento de datos:** Cada activity accede **SOLO** a la base de datos de su propio módulo. Datos de otro bounded context deben llegar como input del workflow — la activity nunca consulta repositorios ajenos.

```yaml
# ❌ INCORRECTO — la activity consulta la BD de otro módulo
activities:
  - name: NotifyOrderPlaced
    input: [orderId, customerId]
    # Internamente: customerRepo.findById(customerId) ← ACOPLAMIENTO CROSS-MODULE

# ✅ CORRECTO — el workflow ensambla la data y se la pasa
activities:
  - name: NotifyOrderPlaced
    input: [orderId, customerEmail, customerName, totalAmount]
    # No necesita saber nada de customers
```

> **Aclaración:** Una activity SÍ consulta su propia BD. `ReserveStock` lee el stock actual de su repositorio de inventory — eso es correcto. Lo prohibido es que una activity de inventory consulte la tabla de customers.

**Regla de compensación explícita:** Si una activity tiene compensación, declararla en el mismo módulo.

```yaml
activities:
  - name: ReserveStock
    compensation: ReleaseStock       # ← declarado aquí mismo

  - name: ReleaseStock               # ← la compensación es otra activity
    input: [orderId, items]
```

### Paso 6: Conectar Events con Workflows (notifies)

Solo los eventos que disparan workflows llevan `notifies:`.

```yaml
# orders.yaml — el evento SABE qué workflow lanza
events:
  - name: OrderPlacedEvent
    notifies:
      - workflow: PlaceOrderWorkflow     # definido en system.yaml

  - name: OrderCancelledEvent
    notifies:
      - workflow: CancelOrderWorkflow
```

```yaml
# customers.yaml — el evento NO lanza ningún workflow
events:
  - name: CustomerCreatedEvent
    # SIN notifies → Domain Event interno puro
    # Otros módulos obtienen datos de customer via GetCustomerById
```

**Regla de desacoplamiento:** Si un evento solo sirve para que **otro módulo se entere** de datos actualizados (sincronización), **NO necesita notifies**. El workflow que necesite esos datos los obtiene on-demand via Remote Activity de lectura.

### Paso 7: Diseñar Workflows Internos (domain.yaml)

Para cada módulo, identificar si existen **procesos internos que necesitan durabilidad**: reintentos con backoff, timeouts, scheduling, verificaciones con espera.

**Pregunta clave:** ¿Este proceso interno necesita sobrevivir a reinicios del servicio, tiene reintentos complejos, o espera eventos con timeout?

| SÍ → | NO → |
|-------|-------|
| Workflow single-module en `{domain}.yaml` | Lógica síncrona directa (service method, @Scheduled) |

```yaml
# orders.yaml — workflow INTERNO
workflows:
  - name: ExpireOrderWorkflow
    trigger:
      on: orderCreated
    taskQueue: ORDER_WORKFLOW_QUEUE
    steps:
      - activity: WaitForPayment         # Workflow.sleep() o Signal + Await
        timeout: 30m
      - activity: CancelExpiredOrder      # activity local de orders
```

```yaml
# payments.yaml — workflow INTERNO
workflows:
  - name: RetryChargeWorkflow
    trigger:
      on: paymentFailed
    taskQueue: PAYMENT_WORKFLOW_QUEUE
    steps:
      - activity: RetryCharge             # activity local de payments
        retryPolicy:
          maxAttempts: 3
          backoff: exponential
      - activity: NotifyChargeResult      # activity local de payments
```

**Regla:** Los workflows single-module solo componen activities del propio módulo. Si descubres que un step necesita datos o acciones de otro módulo, el workflow debe subir a `system.yaml`.

### Paso 8: Declarar Servicios Externos (ports)

`ports[]` solo se usa para servicios que **NO corren workers Temporal**: APIs de terceros, payment gateways, servicios SaaS externos.

```yaml
# payments.yaml — el gateway externo es HTTP puro
ports:
  - name: processCharge
    service: PaymentGatewayService
    target: payment-gateway
    baseUrl: https://api.payments.example.com
    http: POST /charges
```

**Regla:** Si el servicio está **dentro** de tu sistema (tiene domain.yaml), usa Activities. Si es **externo**, usa `ports[]`.

---

## ✅ Checklist por Tipo de Módulo

> **Nota:** Los roles no son categorías excluyentes — un módulo puede combinar características de varios tipos. Por ejemplo, `orders` es principalmente Orquestador (sus eventos disparan sagas), pero también declara activities locales (`ConfirmOrder`) y workflows internos (`ExpireOrderWorkflow`). Los checklists son guías por **rol principal**, no restricciones absolutas.

### Módulo Orquestador (ej: orders)

Es el módulo que **inicia** los workflows cross-module. Sus eventos disparan sagas.

- [ ] `events[].notifies` → apunta a workflows en system.yaml
- [ ] Puede tener `activities[]` **locales** invocadas por workflows que corren en su queue (ej: `ConfirmOrder`)
- [ ] Puede tener `workflows[]` **single-module** para procesos internos (ej: `ExpireOrderWorkflow`)
- [ ] **NO tiene** `listeners[]`, `readModels[]`
- [ ] **NO** declara sagas cross-module — la orquestación va en system.yaml

```yaml
# orders.yaml — orquestador
events:
  - name: OrderPlacedEvent
    notifies:
      - workflow: PlaceOrderWorkflow

activities:
  - name: ConfirmOrder             # local: invocada por PlaceOrderWorkflow
    type: light

workflows:
  - name: ExpireOrderWorkflow      # interno: cancelar orden si no paga
```

### Módulo Proveedor de Datos (ej: customers, products)

Sus datos son consumidos **on-demand** por workflows de otros módulos.

- [ ] `activities[]` → al menos una activity de **lectura** (GetXById)
- [ ] `events[]` → Domain Events internos, **SIN notifies** (a menos que haya un efecto de negocio real)
- [ ] Considerar activities **batch** si se consultan múltiples registros (GetProductsByIds)

```yaml
# customers.yaml — proveedor de datos
activities:
  - name: GetCustomerById        # ← lectura on-demand
    type: light
    input: [customerId]
    output: [id, firstName, lastName, email, phone]

events:
  - name: CustomerCreatedEvent   # ← interno, SIN notifies
```

### Módulo Ejecutor (ej: inventory, payments)

Ofrece **operaciones de negocio** que los workflows invocan.

- [ ] `activities[]` → operaciones de escritura + sus compensaciones
- [ ] `compensation:` → declarada explícitamente en cada activity reversible
- [ ] `timeout:` y `retryPolicy:` → configurados por activity
- [ ] `ports[]` → solo si llama a servicios EXTERNOS (ej: payment gateway)

```yaml
# inventory.yaml — ejecutor
activities:
  - name: ReserveStock
    type: light
    input: [orderId, items]
    compensation: ReleaseStock

  - name: ReleaseStock
    type: light
    input: [orderId, items]
```

### Módulo Reactor (ej: notifications)

Ejecuta efectos secundarios (emails, SMS, webhooks) invocados por workflows.

- [ ] `activities[]` → reciben **TODA** la data como input (zero lookups)
- [ ] Invocados como `type: async` en el workflow (non-blocking)
- [ ] **NO** tienen `readModels[]` — son stateless para datos cross-module
- [ ] Solo persisten sus propias entidades (ej: registro de notificación enviada)

```yaml
# notifications.yaml — reactor
activities:
  - name: NotifyOrderPlaced
    type: light
    input: [orderId, customerEmail, customerName, totalAmount]
    # Toda la data viene del workflow caller
```

---

## 🏗️ Patrones de Diseño de Workflows

### Patrón 1: Saga con Compensación

Flujo multi-step donde el fallo de un paso deshace los anteriores.

```yaml
workflows:
  - name: PlaceOrderWorkflow
    saga: true
    steps:
      - activity: ReserveStock
        compensation: ReleaseStock       # ← se ejecuta si paso posterior falla
      - activity: ProcessOrderPayment
        compensation: RefundPayment
      - activity: ConfirmOrder           # último paso, sin compensación
```

**Cuándo:** Operaciones que involucran escritura en múltiples módulos y necesitan consistencia eventual.

### Patrón 2: Enriquecimiento + Acción

Obtener datos de lectura antes de ejecutar la acción principal.

```yaml
steps:
  # 1. Enriquecimiento (lectura on-demand)
  - activity: GetCustomerById
    output: [firstName, email]

  # 2. Acción (usa los datos obtenidos)
  - activity: ProcessOrderPayment
    input: [orderId, customerId, totalAmount]
```

**Cuándo:** El workflow necesita datos de otro módulo para tomar decisiones o pasarlos a steps posteriores.

### Patrón 3: Steps Paralelos (Async.function)

Ejecutar steps independientes en paralelo para reducir latencia.

```yaml
steps:
  - activity: GetProductsByIds
    parallel: true                    # ⎫ ejecutar juntos
  - activity: ReserveStock            # ⎭
    parallel: true
  # → Promise.allOf().get()
  - activity: ProcessOrderPayment     # después de ambos
```

**Cuándo:** 2+ steps son independientes entre sí (no usan el output del otro).

### Patrón 4: Efecto de Negocio Puntual

Un evento dispara una única acción en otro módulo.

```yaml
workflows:
  - name: ProductCreatedWorkflow
    trigger:
      module: products
      on: create
    steps:
      - activity: InitializeStock       # solo 1 step
        compensation: DeleteStock
```

**Cuándo:** Efecto colateral simple, no una saga compleja.

### Patrón 5: Notificación Non-Blocking

Último step del workflow, no afecta el resultado de la saga.

```yaml
steps:
  # ... pasos críticos de la saga ...
  - activity: NotifyOrderPlaced
    type: async                        # fire-and-forget
    # NO tiene compensation — si falla, no revierte la saga
```

**Cuándo:** Efectos secundarios no-críticos (emails, logs, analytics).

---

## ⚠️ Errores Comunes

### ❌ Crear workflows de sincronización de datos

```yaml
# ❌ NO HACER — workflow que solo sincroniza datos
- name: CustomerUpdatedWorkflow
  steps:
    - activity: SyncCustomerReadModel
      target: orders
    - activity: SyncCustomerReadModel
      target: notifications

# ✅ SÍ HACER — lectura on-demand en el workflow que necesita el dato
# PlaceOrderWorkflow → GetCustomerById → customers
```

**Por qué:** Los workflows de sync acoplan al productor con todos sus consumidores. La lectura on-demand invierte la dependencia.

### ❌ Activities que hacen lookups cross-module

```yaml
# ❌ NO HACER — la activity de notifications busca datos de customers
activities:
  - name: NotifyOrderPlaced
    input: [orderId, customerId]
    # Internamente: fetch customer data from DB/service

# ✅ SÍ HACER — el workflow obtiene los datos y los pasa
activities:
  - name: NotifyOrderPlaced
    input: [orderId, customerEmail, customerName, totalAmount]
    # La activity tiene todo lo que necesita
```

**Por qué:** Si notifications busca datos de customers internamente, crea una dependencia oculta. El workflow debe ser el orquestador que ensambla la data.

### ❌ Poner orquestación **cross-module** en el domain.yaml

```yaml
# ❌ NO HACER en orders.yaml
saga:
  workflow: PlaceOrderWorkflow
  steps: [...]

# ✅ SÍ HACER — la orquestación cross-module va en system.yaml
# El domain.yaml solo declara el evento con notifies:
events:
  - name: OrderPlacedEvent
    notifies:
      - workflow: PlaceOrderWorkflow
```

**Por qué:** La orquestación cross-module es una **decisión de sistema**, no del módulo individual.

> **Excepción:** Los workflows **single-module** SÍ se declaran en `{domain}.yaml` porque son procesos internos del bounded context (ej: `RetryChargeWorkflow`, `ExpireOrderWorkflow`). La regla aplica solo a sagas que tocan 2+ módulos.

### ❌ Usar `notifies:` para eventos que no tienen efecto cross-module

```yaml
# ❌ NO HACER — evento de sync disfrazado de workflow
events:
  - name: CustomerUpdatedEvent
    notifies:
      - workflow: CustomerUpdatedWorkflow  # solo sincroniza datos

# ✅ SÍ HACER — Domain Event interno
events:
  - name: CustomerUpdatedEvent
    # SIN notifies — otros módulos obtienen la data on-demand
```

### ❌ Olvidar `compensation:` en activities dentro de sagas

```yaml
# ❌ NO HACER — sin compensación, la saga no puede deshacer
steps:
  - activity: ReserveStock              # ¿qué pasa si el pago falla?

# ✅ SÍ HACER
steps:
  - activity: ReserveStock
    compensation: ReleaseStock          # deshace si falla un paso posterior
```

---

## 📊 Matriz de Decisión: ¿Es un Workflow o un Domain Event Interno?

| Pregunta | SÍ → | NO → |
|----------|------|------|
| ¿Algo DEBE ocurrir en otro módulo? | Workflow cross-module (system.yaml) | ↓ siguiente pregunta |
| ¿Es un proceso interno con durabilidad (retry, timeout, scheduling)? | Workflow single-module (domain.yaml) | Domain Event interno |
| ¿Son múltiples pasos coordinados cross-module? | Saga (workflow) | Activity puntual |
| ¿Necesita consistencia (compensación)? | Saga con compensación | Activity async |
| ¿Solo otro módulo necesita enterarse de datos nuevos? | **NI workflow NI notifies** — lectura on-demand | — |

---

## 📊 Matriz de Decisión: ¿Qué Tipo de Activity?

| Pregunta | Tipo |
|----------|------|
| ¿Solo lee datos de este módulo? | **Lectura** (`GetXById`, `GetXsByIds`) |
| ¿Modifica datos y puede deshacerse? | **Escritura** + `compensation:` |
| ¿Modifica datos irreversiblemente? | **Escritura** sin compensación |
| ¿Es el reverso de otra activity? | **Compensación** (referenciada en `compensation:`) |
| ¿Es un efecto secundario no-crítico? | **Reactor** (invocado como `type: async`) |
| ¿Es una operación interna del módulo? | **Local** (invocada por workflows del propio `{domain}.yaml` o por un workflow cross-module que corre en el queue del módulo) |

---

## 🔧 Convenciones de Naming

### Task Queues (Module-Prefixed)

```
{MODULE_SCREAMING_SNAKE}_WORKFLOW_QUEUE     → ORDER_WORKFLOW_QUEUE
{MODULE_SCREAMING_SNAKE}_LIGHT_TASK_QUEUE   → ORDER_LIGHT_TASK_QUEUE
{MODULE_SCREAMING_SNAKE}_HEAVY_TASK_QUEUE   → PAYMENT_HEAVY_TASK_QUEUE
```

### Activities

| Tipo | Patrón | Ejemplo |
|------|--------|---------|
| Lectura singular | `Get{Entity}ById` | `GetCustomerById` |
| Lectura batch | `Get{Entities}ByIds` | `GetProductsByIds` |
| Escritura | `{Verbo}{Sustantivo}` | `ReserveStock`, `ProcessOrderPayment` |
| Compensación | `{Verbo inverso}{Sustantivo}` | `ReleaseStock`, `RefundPayment` |
| Reactor | `Notify{Evento}` | `NotifyOrderPlaced`, `NotifyOrderCancelled` |
| Local | `{Verbo}{Sustantivo}` (mismo patrón que escritura) | `ConfirmOrder`, `RetryCharge` |

### Workflows

```
{Verbo}{Entidad}Workflow          → PlaceOrderWorkflow
{Entidad}{Evento}Workflow         → ProductCreatedWorkflow
{Verbo}{Entidad}Workflow          → CancelOrderWorkflow
```

---

## 📦 Resumen: Distribución de Responsabilidades

```
system.yaml
├── system:          → Metadata del proyecto
├── orchestration:   → Configuración de Temporal (target, namespace)
├── modules:         → Lista de módulos + endpoints REST
└── workflows:       → Flujos cross-module (sagas, efectos de negocio)
                        ¿QUIÉN orquesta QUÉ?

{domain}.yaml
├── aggregates:      → Modelo de dominio (entities, VOs, enums, transitions)
├── events:          → Domain Events (con o sin notifies: → workflow)
├── activities:      → Capacidades del módulo (cross-module + internas)
├── workflows:       → Flujos INTERNOS del módulo (single-module, no cross-module)
├── endpoints:       → API REST del módulo
└── ports:           → Solo servicios EXTERNOS no-Temporal (HTTP)
                        ¿QUÉ sabe hacer este módulo?
```

**Principio fundamental:**
> `system.yaml` define **la coreografía** (quién habla con quién).
> `{domain}.yaml` define **las capacidades** (qué puede hacer cada uno).
> Los workflows cross-module **ensamblan** las capacidades en flujos de negocio.
> Los workflows single-module son **procesos internos** del bounded context.

---

**Última actualización:** 2026-04-07
