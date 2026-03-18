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

  sync:
    - caller: orders               # módulo que hace la llamada
      calls: customers             # módulo destino
      port: OrderCustomerService   # PascalCase + Service — prefijado con caller
      using:
        - GET /customers/{id}      # debe existir en exposes: de 'customers'
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
- [ ] Todos los `calls.using:` existen en `exposes:` del destino
- [ ] Módulos pasivos no son `caller`
- [ ] `useCases` en PascalCase
- [ ] Port names únicos por módulo (prefijados con bounded context del caller)
- [ ] Todo el contenido en inglés
- [ ] Archivo guardado en `system/system.yaml`
