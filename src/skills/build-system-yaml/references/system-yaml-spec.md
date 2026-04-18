# system.yaml — Especificación completa

Referencia técnica para construir y validar el archivo `system/system.yaml`.

---

## Estructura completa

```yaml
system:
  name: project-name              # kebab-case
  groupId: com.example
  javaVersion: 21
  springBootVersion: 3.5.5
  database: postgresql             # h2 | postgresql | mysql

messaging:                         # Omitir sección completa si no hay mensajería
  enabled: true
  broker: kafka                    # kafka | rabbitmq | sns-sqs (solo kafka soportado hoy)
  kafka:
    bootstrapServers: localhost:9092
    defaultGroupId: project-name
    topicPrefix: project-name      # opcional — prefixa todos los topics

modules:
  - name: orders                   # plural, kebab-case
    description: "Order lifecycle management"
    exposes:
      - method: GET                # GET | POST | PUT | PATCH | DELETE
        path: /orders/{id}
        useCase: GetOrder          # PascalCase — alimenta endpoints: en domain.yaml
        description: "Get order by ID"
      - method: GET
        path: /orders
        useCase: FindAllOrders
        description: "List orders with filters and pagination"
      - method: POST
        path: /orders
        useCase: CreateOrder
        description: "Create a new order"
      - method: PUT
        path: /orders/{id}/confirm
        useCase: ConfirmOrder
        description: "Confirm a pending order"

  - name: notifications
    description: "Notification delivery service"
    # Sin endpoints REST — solo consume eventos

integrations:
  async:
    - event: OrderPlacedEvent      # PascalCase, tiempo pasado, sufijo Event
      producer: orders
      topic: ORDER_PLACED          # SCREAMING_SNAKE_CASE
      consumers:
        - module: payments
          useCase: HandleOrderPlaced   # acción que payments ejecuta
        - module: notifications
          useCase: NotifyOrderPlaced   # acción que notifications ejecuta

    # Read Model sync — consumer usa readModel: en vez de useCase:
    - event: ProductCreatedEvent
      producer: products
      topic: PRODUCT_CREATED
      consumers:
        - module: orders
          readModel: ProductReadModel  # ← indica sync de read model, no lógica de negocio

  sync:
    - caller: orders               # módulo que hace la llamada
      calls: customers             # módulo destino
      port: OrderCustomerService   # PascalCase + Service — prefijado con caller
      using:
        - GET /customers/{id}      # debe existir en exposes: de 'customers'

sagas:                             # Omitir si no hay flujos multi-paso con compensación
  - name: PlaceOrderSaga           # PascalCase + sufijo "Saga"
    description: "Order creation with stock reservation and payment"
    trigger:
      module: orders
      useCase: CreateOrder
      httpMethod: POST
      path: /orders
    steps:
      - order: 1
        module: orders
        action: CreateOrder
        emits: OrderPlacedEvent
        topic: ORDER_PLACED
        compensation: null         # null explícito — paso iniciador
      - order: 2
        module: inventory
        trigger: OrderPlacedEvent
        topic: ORDER_PLACED
        action: ReserveStock
        emits: StockReservedEvent
        successTopic: STOCK_RESERVED
        compensationEvent: StockReservationFailedEvent
        compensationTopic: STOCK_RESERVATION_FAILED
        compensationModule: orders
        compensationUseCase: CompensateOrderPlacement
      - order: 3
        module: orders
        trigger: StockReservedEvent
        topic: STOCK_RESERVED
        action: ConfirmOrder
        emits: null
        compensation: null         # null explícito — paso final
    observers:
      - module: notifications
        on: [OrderPlacedEvent, StockReservedEvent]
```

---

## Convenciones de nombres

| Elemento | Convención | Ejemplo válido | Ejemplo inválido |
|---|---|---|---|
| Módulos | plural, kebab-case | `orders`, `order-items` | `Order`, `order_items` |
| Eventos | PascalCase + pasado + sufijo `Event` | `OrderPlacedEvent` | `PlaceOrderEvent` |
| Topics Kafka | SCREAMING_SNAKE_CASE — **sin `topicPrefix`** | `ORDER_PLACED` | `test-eva.ORDER_PLACED` |
| Port names | PascalCase + sufijo `Service` — **único por módulo** | `OrderCustomerService` | `CustomerService` (compartido) |
| useCases | PascalCase, verbo + sustantivo | `CreateOrder`, `FindAllOrders` | `createOrder`, `orders` |
| `consumers[].useCase` | PascalCase, verbo + sustantivo | `HandleOrderPlaced` | `orderPlaced` |
| `consumers[].readModel` | PascalCase + `ReadModel` | `ProductReadModel` | `productReadModel` |

---

## Restricciones estructurales

- ❌ **Sin dependencias circulares síncronas** — si `A` llama a `B`, `B` no puede llamar a `A`
- ❌ **Sin campos de dominio** — entidades, campos, enums → van en `domain.yaml`
- ❌ **Sin nombres de `port` genéricos compartidos** — si `orders` y `deliveries` llaman a `customers`, usar `OrderCustomerService` y `DeliveryCustomerService`; **nunca** `CustomerService` en ambos (causa `ConflictingBeanDefinitionException`)
- ✅ Cada módulo tiene **una sola responsabilidad**
- ✅ `calls.using:` solo referencia endpoints declarados en `exposes:` del módulo destino
- ✅ `consumers[].module` debe existir en `modules:`
- ✅ Módulos pasivos (notificaciones, auditoría) son **consumidores**, nunca `caller`
- ℹ️ Varios módulos pueden consumir el mismo evento sin riesgo de colisión de beans
- ℹ️ `consumers[]` puede usar `readModel:` en vez de `useCase:` para indicar sync de Read Model local (proyección de datos cross-module mantenida por eventos)

---

## Consumers: useCase vs readModel

Cada entrada en `consumers[]` debe declarar **exactamente uno** de:

| Campo | Cuándo usar | Qué genera en domain.yaml |
|---|---|---|
| `useCase:` | Lógica de negocio (handler + command) | `listeners:` entry |
| `readModel:` | Proyección local de datos (sync handler) | `readModels:` entry con `syncedBy` |

```yaml
consumers:
  - module: payments
    useCase: HandleOrderPlaced       # → listeners: en payments.yaml
  - module: orders
    readModel: ProductReadModel      # → readModels: en orders.yaml
```

**Reglas de `readModel:`:**
- PascalCase, sufijo `ReadModel`
- El module consumidor declara `readModels:` en su `domain.yaml` con `source.module` apuntando al producer
- Al reemplazar un port sync por un readModel, eliminar la entrada de `integrations.sync[]`

---

## useCases — patrones de nombres

### Verbos por tipo de operación

| Tipo de operación | Verbos recomendados | Ejemplo |
|---|---|---|
| Crear recurso | `Create` | `CreateOrder` |
| Actualizar | `Update` | `UpdateOrder` |
| Eliminar | `Delete` | `DeleteOrder` |
| Obtener por ID | `Get` | `GetOrder` |
| Listar con paginación | `FindAll` | `FindAllOrders` |
| Transición de estado | `Confirm`, `Cancel`, `Approve`, `Reject`, `Activate`, `Close`, `Complete`, `Submit`, `Publish` | `ConfirmOrder`, `CancelPayment` |
| Acción puntual | `Send`, `Process`, `Calculate`, `Generate`, `Assign`, `Transfer`, `Notify` | `SendNotification`, `ProcessPayment` |
| Búsqueda | `Search`, `Find`, `Lookup` | `FindOrdersByCustomer` |

### CRUD vs negocio — regla de generación

eva4j distingue dos categorías:

**CRUD estándar** — genera implementación completa del handler:

| Patrón | HTTP | Implementación |
|---|---|---|
| `Create{Aggregate}` | POST `/resource` | Handler completo |
| `Update{Aggregate}` | PUT `/resource/{id}` | Handler completo |
| `Delete{Aggregate}` | DELETE `/resource/{id}` | Handler completo |
| `Get{Aggregate}` | GET `/resource/{id}` | Handler completo |
| `FindAll{PluralAggregate}` | GET `/resource` | Handler completo |

**Negocio** — genera scaffold con `throw new UnsupportedOperationException(...)`:

```java
public class ConfirmOrderCommandHandler implements CommandHandler<ConfirmOrderCommand, Void> {
    @Override
    public Void handle(ConfirmOrderCommand command) {
        throw new UnsupportedOperationException("ConfirmOrderCommandHandler not implemented yet");
    }
}
```

### useCase en consumers

Cada `consumers[]` **debe** declarar `useCase`: la acción que el consumidor ejecuta al recibir el evento.

```yaml
consumers:
  - module: payments
    useCase: HandleReservationCreated   # payments inicia cobro
  - module: notifications
    useCase: NotifyReservationCreated   # envía email de confirmación
```

**Reglas:**
- PascalCase, `Verbo + Sustantivo`
- Describe la acción del consumidor, no repite el evento
- Se mapea a `listeners[].useCase` del `domain.yaml` del consumidor
- Verbos típicos: `Handle`, `Process`, `Confirm`, `Cancel`, `Notify`, `Accumulate`, `Release`, `Update`

---

## Sagas de coreografía

Declara flujos de negocio multi-paso distribuidos que requieren compensación (rollback semántico). La sección `sagas:` habilita el tab **Sagas** en `eva evaluate system` y activa las validaciones **S6** que detectan listeners de compensación faltantes y discrepancias de nombres entre la saga y los `domain.yaml`.

> Solo declarar cuando el flujo cumple 2 o más de: ≥ 3 módulos encadenados, algún paso tiene efectos no reversibles (cargo financiero, llamada externa), o un fallo tardío deja el sistema en estado inconsistente.

---

### Propiedades del objeto saga

| Propiedad | Tipo | Obligatorio | Rol |
|---|---|---|---|
| `name` | String | ✅ | Identificador en el reporte. **PascalCase + sufijo `Saga`** (ej: `PlaceOrderSaga`). |
| `description` | String | — | Descripción del proceso de negocio. Aparece en el header del tab. |
| `trigger` | Object | — | Endpoint HTTP que inicia la saga. Solo documentativo — no genera código. |
| `steps[]` | Array | ✅ | Lista ordenada de pasos. Mínimo 2 entradas. Define la cadena de ejecución y la secuencia LIFO de compensación. |
| `observers[]` | Array | — | Módulos que escuchan eventos de la saga de forma pasiva, sin ser pasos formales y sin generar compensaciones. |

---

### Propiedad `trigger`

Documenta el endpoint que inicia la saga. Es informativo — aparece en el reporte pero no genera artefactos.

| Sub-propiedad | Tipo | Rol |
|---|---|---|
| `module` | String | Módulo que expone el endpoint iniciador. Debe existir en `modules:`. |
| `useCase` | String | Caso de uso del endpoint. Debe existir en `exposes:` del módulo. |
| `httpMethod` | String | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` |
| `path` | String | Path del endpoint. Ej: `/orders`. |

```yaml
trigger:
  module: orders
  useCase: CreateOrder    # debe existir en modules[orders].exposes
  httpMethod: POST
  path: /orders
```

---

### Propiedad `steps[]`

Cada step es un eslabón de la cadena. El campo `order` determina la secuencia de ejecución y el orden inverso de compensación (LIFO: el último paso compensable se revierte primero).

| Propiedad | Tipo | Paso 1 | Intermedio | Paso final | Rol |
|---|---|:---:|:---:|:---:|---|
| `order` | Integer | ✅ | ✅ | ✅ | Número de secuencia (1-based). Define la cadena LIFO. |
| `module` | String | ✅ | ✅ | ✅ | Módulo que ejecuta la `action`. Debe existir en `modules:`. |
| `action` | String | ✅ | ✅ | ✅ | Caso de uso ejecutado en este paso. PascalCase, verbo+sustantivo. Ej: `ReserveStock`. |
| `trigger` | String | — | ✅ | ✅ | Evento del paso anterior que activa este paso. PascalCase + `Event`. |
| `topic` | String | ✅ | ✅ | ✅ | Topic donde se escucha el evento `trigger` (o topic propio del paso 1). SCREAMING_SNAKE_CASE. |
| `emits` | String \| null | ✅ | ✅ | — | Evento de éxito emitido al completar el paso. `null` si el paso final no emite. |
| `successTopic` | String | — | ✅ | — | Topic del evento `emits`. Lo consume el paso siguiente. |
| `compensationEvent` | String | — | ✅ | — | Evento emitido por el módulo cuando **este paso falla**. Dispara la compensación LIFO. PascalCase + fallo + `Event`. |
| `compensationTopic` | String | — | ✅ | — | Topic donde se publica `compensationEvent`. SCREAMING_SNAKE_CASE. |
| `compensationModule` | String | — | ✅ | — | Módulo que revierte el efecto del **paso anterior** (N-1). Patrón LIFO: si falla el paso N, el módulo del paso N-1 compensa. |
| `compensationUseCase` | String | — | ✅ | — | Caso de uso de compensación en `compensationModule`. Prefijo `Compensate` + sustantivo del paso revertido. **Debe coincidir exactamente** con `listeners[].useCase` en el `domain.yaml` del `compensationModule`. |
| `compensation` | `null` | ✅ | — | ✅ | Declarar `null` explícito en el **paso 1** (no puede compensarse a sí mismo) y en el **paso final** (es el destino exitoso). |

#### Patrón LIFO — quién compensa a quién

```
Paso 1 (orders)     → compensation: null        ← no puede compensarse a sí mismo
Paso 2 (inventory)  → compensationModule: orders    ← revierte el efecto del paso 1
Paso 3 (payments)   → compensationModule: inventory ← revierte el efecto del paso 2
Paso 4 (orders)     → compensation: null        ← destino exitoso, no necesita compensación
```

#### Visualización del flujo

**Happy path:**
```
orders:CreateOrder → ORDER_PLACED → inventory:ReserveStock
                                 → STOCK_RESERVED → payments:ProcessPayment
                                                  → PAYMENT_APPROVED → orders:ConfirmOrder ✅
```

**Fallo en paso 3 (payments no puede cobrar):**
```
payments emite PaymentFailedEvent
  ↩ PAYMENT_FAILED → inventory:CompensateStockReservation  (revierte paso 2)
  ↩ (si inventory emite otro evento) → orders:CompensateOrderPlacement  (revierte paso 1)
```

> El último paso que **falló** no se compensa (nunca completó su efecto). Solo se compensan los pasos anteriores que ya lo hicieron.

---

### Propiedad `observers[]`

Módulos que reaccionan a eventos de la saga de forma pasiva. No participan en la cadena de compensación. Típicamente: notificaciones, auditoría, analítica.

| Sub-propiedad | Tipo | Rol |
|---|---|---|
| `module` | String | Módulo observer. Debe existir en `modules:`. |
| `on` | String[] | Eventos de la saga que este módulo escucha. PascalCase + `Event`. |

```yaml
observers:
  - module: notifications
    on: [OrderPlacedEvent, PaymentApprovedEvent, PaymentFailedEvent]
    # notifications envía emails reactivos sin afectar el flujo de compensación
```

El validador **S6-006** verifica que cada evento en `on[]` esté declarado en algún módulo del sistema.

---

### Convenciones de nombres

| Elemento | Convención | ✅ Correcto | ❌ Incorrecto |
|---|---|---|---|
| Nombre de saga | PascalCase + `Saga` | `PlaceOrderSaga`, `CheckoutSaga` | `OrderFlow`, `SagaOrder` |
| Step `action` | PascalCase, verbo+sustantivo | `ReserveStock`, `ProcessPayment` | `reserve_stock`, `doPayment` |
| `compensationUseCase` | `Compensate` + sustantivo del paso revertido | `CompensateStockReservation` | `RollbackStock`, `UndoPayment` |
| `compensationEvent` | PascalCase + pasado + fallo + `Event` | `PaymentFailedEvent`, `StockReservationFailedEvent` | `PaymentError`, `FailedPaymentEvent` |
| `compensationTopic` | SCREAMING_SNAKE_CASE | `PAYMENT_FAILED` | `paymentFailed`, `PAYMENT-FAILED` |

**Tabla de mapping `compensationUseCase`** — siempre describe la acción de deshacer, no el evento ni el módulo:

| La `action` del paso fue... | Su `compensationUseCase` es... |
|---|---|
| `ReserveStock` | `CompensateStockReservation` |
| `ProcessPayment` | `CompensatePayment` |
| `CreateOrder` | `CompensateOrderPlacement` |
| `ScheduleDelivery` | `CompensateDeliveryScheduling` |
| `AllocateWarehouseSlot` | `CompensateWarehouseAllocation` |

> ⚠️ **Estos nombres son ejemplos para una sola saga.** Si en el mismo sistema otro módulo también necesita compensar `ReserveStock` por un motivo diferente (ej: `inventory` revierte una reserva al fallar el pago), NO puede reutilizar `CompensateStockReservation` — generaría `ConflictingBeanDefinitionException` (C3-007). Usa un nombre que incluya el contexto del trigger, ej: `ReleaseStockReservationOnPaymentFailed`.

---

### Ejemplo completo anotado

```yaml
sagas:
  - name: PlaceOrderSaga                        # PascalCase + "Saga" — aparece en el tab del reporte
    description: "Order creation with stock reservation and payment processing"
    trigger:
      module: orders                            # Módulo que recibe la petición HTTP inicial
      useCase: CreateOrder                      # Debe existir en modules[orders].exposes
      httpMethod: POST
      path: /orders

    steps:
      # ── PASO 1: Iniciador ────────────────────────────────────────────────────
      - order: 1                                # Posición en la cadena (1-based)
        module: orders                          # Módulo responsable de este paso
        action: CreateOrder                     # Caso de uso ejecutado (verbo+sustantivo PascalCase)
        emits: OrderPlacedEvent                 # Evento de éxito → activa el paso 2
        topic: ORDER_PLACED                     # Topic donde se publica OrderPlacedEvent
        compensation: null                      # null OBLIGATORIO: paso 1 no se puede compensar a sí mismo

      # ── PASO 2: Reserva de stock ─────────────────────────────────────────────
      - order: 2
        module: inventory                       # inventory ejecuta la reserva
        trigger: OrderPlacedEvent               # Escucha el éxito del paso 1
        topic: ORDER_PLACED                     # Topic donde inventory escucha
        action: ReserveStock                    # Modifica estado (reserva) → es compensable
        emits: StockReservedEvent               # Evento de éxito → activa el paso 3
        successTopic: STOCK_RESERVED            # Topic de StockReservedEvent
        compensationEvent: StockReservationFailedEvent  # inventory lo emite si no puede reservar
        compensationTopic: STOCK_RESERVATION_FAILED     # Topic del evento de fallo
        compensationModule: orders              # El módulo del PASO 1 compensa si este paso falla
        compensationUseCase: CompensateOrderPlacement   # DEBE coincidir con listeners[].useCase en orders.yaml

      # ── PASO 3: Cobro ────────────────────────────────────────────────────────
      - order: 3
        module: payments                        # payments ejecuta el cobro
        trigger: StockReservedEvent             # Escucha el éxito del paso 2
        topic: STOCK_RESERVED
        action: ProcessPayment                  # Cargo financiero → es compensable
        emits: PaymentApprovedEvent             # Evento de éxito → activa el paso 4
        successTopic: PAYMENT_APPROVED
        compensationEvent: PaymentFailedEvent   # payments lo emite si el cobro falla
        compensationTopic: PAYMENT_FAILED
        compensationModule: inventory           # El módulo del PASO 2 compensa si este paso falla
        compensationUseCase: CompensateStockReservation  # DEBE coincidir con listeners[].useCase en inventory.yaml

      # ── PASO 4: Confirmación (final) ─────────────────────────────────────────
      - order: 4
        module: orders                          # orders cierra la saga
        trigger: PaymentApprovedEvent           # Escucha el éxito del paso 3
        topic: PAYMENT_APPROVED
        action: ConfirmOrder                    # Transición de estado → orden confirmada
        emits: OrderConfirmedEvent              # Evento de cierre (opcional)
        successTopic: ORDER_CONFIRMED
        compensation: null                      # null OBLIGATORIO: paso final = destino exitoso

    observers:
      - module: notifications                   # Reacciona a eventos sin ser paso formal
        on:                                     # Lista de eventos que notifications escucha
          - OrderPlacedEvent                    # → email "tu orden fue recibida"
          - PaymentApprovedEvent                # → email "tu orden fue confirmada"
          - PaymentFailedEvent                  # → email "el pago fue rechazado"
```

---

### Relación con `domain.yaml`

Por cada step con `compensationEvent`, el `compensationModule` **debe declarar un listener** en su `{module}.yaml`. El validador **S6-003** detecta listeners faltantes y sugiere el snippet YAML exacto para corregirlos. El validador **S6-005** detecta discrepancias entre `compensationUseCase` en la saga y `useCase` en el listener.

```yaml
# En orders.yaml — es compensationModule del paso 2
listeners:
  - event: StockReservationFailedEvent  # = compensationEvent del paso 2
    topic: STOCK_RESERVATION_FAILED     # = compensationTopic del paso 2
    useCase: CompensateOrderPlacement   # = compensationUseCase del paso 2 (coincidencia exacta)
    fields:
      - name: orderId
        type: String

# En inventory.yaml — es compensationModule del paso 3
listeners:
  - event: PaymentFailedEvent           # = compensationEvent del paso 3
    topic: PAYMENT_FAILED               # = compensationTopic del paso 3
    useCase: CompensateStockReservation # = compensationUseCase del paso 3 (coincidencia exacta)
    fields:
      - name: orderId
        type: String
```

> **Dos reglas de unicidad para `compensationUseCase`:**
>
> **Regla 1 — Intra-módulo (C2-013):** Cuando el mismo `compensationModule` aparece en ≥2 steps, usa un **`compensationUseCase` distinto por step**. `UseCaseAutoRegister` solo registra un tipo genérico por handler; compartir el mismo nombre entre múltiples listeners del mismo módulo causa `IllegalArgumentException` en runtime.
>
> **Regla 2 — Cross-módulo (C3-007):** El `compensationUseCase` debe ser **globalmente único en todo el sistema**. Si el módulo A usa `CompensateStockReservation` y el módulo B también usa `CompensateStockReservation`, Spring genera dos beans `CompensateStockReservationCommandHandler` en el mismo classpath → `ConflictingBeanDefinitionException`. Usa nombres semánticos que incluyan el contexto del paso revertido.
>
> ```yaml
> # ✅ CORRECTO — 3 compensationUseCase distintos por step Y globalmente únicos
> sagas:
>   - name: CartCheckoutSaga
>     steps:
>       - ...
>       - compensationEvent: OrderDraftCreationFailedEvent
>         compensationModule: carts
>         compensationUseCase: CompensateOrderDraftCreation   # único global
>       - compensationEvent: StockReservationFailedEvent
>         compensationModule: carts
>         compensationUseCase: CompensateStockReservation     # único global
>       - compensationEvent: PaymentFailedEvent
>         compensationModule: carts
>         compensationUseCase: CompensatePayment              # único global
> ```
>
> Si otro módulo también compensara stock por un motivo distinto, no podría reusar `CompensateStockReservation` — debería llamarse ej: `ReleaseStockReservationOnPaymentFailed`.
>
> `eva evaluate system` valida ambas reglas automáticamente: **C2-013** (intra-módulo) y **C3-007** (cross-módulo).

`eva evaluate system` valida automáticamente estas coincidencias en cada ejecución.

---

## Mensajería

- Solo `kafka` está implementado; `rabbitmq` y `sns-sqs` generan warning
- Los **campos** de eventos NO van en `system.yaml` → se declaran en `domain.yaml → events[].fields`
- ❌ `listeners[].topic` NUNCA lleva el `topicPrefix` — usar solo nombre base SCREAMING_SNAKE_CASE

---

## Checklist de validación completa

- [ ] Módulos en plural kebab-case
- [ ] Eventos en tiempo pasado con sufijo `Event`
- [ ] Topics en SCREAMING_SNAKE_CASE sin topicPrefix
- [ ] Sin dependencias circulares síncronas
- [ ] Todos los `consumers[].module` existen en `modules:`
- [ ] Todos los `consumers[].useCase` presentes y en PascalCase
- [ ] `consumers[]` con `readModel:` usan PascalCase + sufijo `ReadModel`
- [ ] Cada consumer tiene exactamente uno de `useCase:` o `readModel:` (nunca ambos)
- [ ] Todos los `calls.using:` existen en `exposes:` del destino
- [ ] Módulos pasivos no son `caller`
- [ ] `useCases` en PascalCase
- [ ] Port names únicos por módulo (prefijados con bounded context del caller)
- [ ] Todo el contenido en inglés
- [ ] Archivo guardado en `system/system.yaml`
- [ ] Si hay flujos async multi-paso con efectos distribuidos → `sagas:` declarado
- [ ] Nombre de saga en PascalCase + sufijo `Saga`
- [ ] Step `action` en PascalCase, verbo+sustantivo
- [ ] `compensationUseCase` comienza con `Compensate` + sustantivo del paso revertido
- [ ] Paso 1 y paso final tienen `compensation: null` explícito
- [ ] `compensationModule` sigue el patrón LIFO (módulo del paso N-1 compensa el paso N)
- [ ] Cada `compensationModule` tiene su listener declarado en `domain.yaml` con `useCase` idéntico al `compensationUseCase`
- [ ] Si el mismo `compensationModule` aparece en ≥2 steps → usar `compensationUseCase` distinto por step (C2-013 — intra-módulo)
- [ ] `compensationUseCase` globalmente único entre todos los módulos del sistema (C3-007 — cross-módulo: dos módulos distintos no pueden compartir el mismo `compensationUseCase` aunque compensen cosas diferentes)
