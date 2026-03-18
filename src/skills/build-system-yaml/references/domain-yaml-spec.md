# domain.yaml por módulo — Especificación completa

Referencia técnica para construir `system/{module}.yaml` — el modelo de dominio de cada módulo. Este archivo es el input para `eva g entities <module>`.

---

## Rol de experto por módulo

Al construir cada `system/{module}.yaml`, activa el rol de experto en el dominio específico:

- **`orders`** → ciclos de vida, estados, invariantes, relaciones con items, totales calculados
- **`payments`** → métodos de pago, reintentos, estados terminales, doble cobro
- **`inventory`** → stock disponible vs. reservado, movimientos, reposición
- **`notifications`** → canales, plantillas, idempotencia, reintentos

Propón campos necesarios no mencionados, Value Objects expresivos, invariantes implícitas, transiciones de estado realistas. Si necesitas reglas de negocio específicas de la empresa, pregunta.

---

## Restricciones absolutas

1. ❌ **No `@ManyToOne`/`@OneToMany` entre agregados** — referencias cross-aggregate son IDs con `reference:`
2. ❌ **No campos de auditoría en `fields:`** (`createdAt`, `updatedAt`, `createdBy`, `updatedBy`) — `audit.enabled: true` los genera
3. ❌ **No `defaultValue` en campos no `readOnly`**
4. ❌ **No `transitions` sin `initialValue`** en el enum
5. ❌ **No inventar módulos en `reference.module`** — solo los de `system/system.yaml`
6. ❌ **No duplicar en `endpoints:`** lo de `system.yaml → exposes:`
7. ❌ **`endpoints:` NUNCA es lista plana** — siempre `{ basePath, versions: [{ version, operations }] }`
8. ❌ **No inventar eventos** — deben coincidir con `integrations.async[]` donde `producer` es este módulo
9. ❌ **No inventar listeners** — deben coincidir con `integrations.async[].consumers[]` donde `module` es este módulo
10. ❌ **No inventar ports** — deben coincidir con `integrations.sync[]` donde `caller` es este módulo
11. ❌ **Todo en inglés**
12. ❌ **No transiciones sin evidencia de activación** — toda transición activada por `ports:` o scheduler necesita un domain event con `triggers`
13. ❌ **No reutilizar `service:` en `ports[]` entre módulos** — nombres propios del bounded context

---

## Inferencia desde system.yaml

| Fuente en system.yaml | Destino en domain.yaml |
|---|---|
| `modules[x].exposes[]` | `endpoints:` con `basePath` + `versions[].operations[]` |
| `integrations.async[]` donde `producer = módulo` | `events:` |
| `integrations.async[].consumers[]` donde `module = módulo` | `listeners:` (con `useCase`) |
| `integrations.sync[]` donde `caller = módulo` | `ports:` (con `service`, `http`) |

### Formato correcto de endpoints

```yaml
# ❌ NUNCA — lista plana (el generador la ignora)
endpoints:
  - method: POST
    path: /orders
    useCase: CreateOrder

# ✅ SIEMPRE — objeto con basePath + versions
endpoints:
  basePath: /orders
  versions:
    - version: v1
      operations:
        - useCase: CreateOrder
          method: POST
          path: /
        - useCase: GetOrder
          method: GET
          path: /{id}
```

---

## Estructura completa del module.yaml

```yaml
aggregates:
  - name: Order                         # PascalCase
    entities:
      - name: order                     # camelCase — entidad raíz
        isRoot: true
        tableName: orders               # snake_case
        hasSoftDelete: false
        audit:
          enabled: true                 # adds createdAt, updatedAt
          trackUser: false              # adds createdBy, updatedBy
        fields:
          - name: id
            type: String
          - name: orderNumber
            type: String
            validations:
              - type: NotBlank
                message: "Order number is required"
          - name: totalAmount
            type: BigDecimal
            readOnly: true
            defaultValue: "0.00"
          - name: status
            type: OrderStatus
            readOnly: true
          - name: processingToken
            type: String
            hidden: true
          - name: customerId
            type: String
            reference:
              aggregate: Customer
              module: customers
        relationships:
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY

      - name: orderItem                 # entidad secundaria
        tableName: order_items
        fields:
          - name: id
            type: String
          - name: productId
            type: String
          - name: quantity
            type: Integer
            validations:
              - type: Min
                value: 1
          - name: unitPrice
            type: BigDecimal

    valueObjects:
      - name: ShippingAddress
        fields:
          - name: street
            type: String
          - name: city
            type: String
          - name: zipCode
            type: String
        methods:
          - name: format
            returnType: String
            parameters: []
            body: "return street + \", \" + city + \" \" + zipCode;"

    enums:
      - name: OrderStatus
        initialValue: PENDING
        transitions:
          - from: PENDING
            to: CONFIRMED
            method: confirm
          - from: CONFIRMED
            to: SHIPPED
            method: ship
          - from: [PENDING, CONFIRMED]
            to: CANCELLED
            method: cancel
            guard: "this.status == OrderStatus.DELIVERED"
        values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]

    events:
      - name: OrderPlacedEvent
        topic: ORDER_PLACED
        triggers:
          - confirm
        fields:
          - name: customerId
            type: String
          - name: confirmedAt
            type: LocalDateTime
      - name: OrderCancelledEvent
        topic: ORDER_CANCELLED
        triggers:
          - cancel
        fields:
          - name: reason
            type: String

endpoints:
  basePath: /orders
  versions:
    - version: v1
      operations:
        - useCase: GetOrder
          method: GET
          path: /{id}
        - useCase: FindAllOrders
          method: GET
          path: /
        - useCase: CreateOrder
          method: POST
          path: /
        - useCase: ConfirmOrder
          method: PUT
          path: /{id}/confirm

listeners:
  - event: PaymentApprovedEvent
    producer: payments
    topic: PAYMENT_APPROVED
    useCase: ConfirmOrder
    fields:
      - name: orderId
        type: String
      - name: approvedAt
        type: LocalDateTime
      - name: paymentDetails
        type: PaymentDetails
    nestedTypes:
      - name: paymentDetails
        fields:
          - name: paymentId
            type: String
          - name: amount
            type: BigDecimal

ports:
  - name: findCustomerById
    service: OrderCustomerService
    target: customers
    baseUrl: http://localhost:8080
    http: GET /customers/{id}
    fields:
      - name: id
        type: String
      - name: email
        type: String
```

---

## Visibilidad de campos

| Configuración | Business constructor | CreateDto | ResponseDto |
|---|---|---|---|
| Normal | ✅ | ✅ | ✅ |
| `readOnly: true` | ❌ | ❌ | ✅ |
| `readOnly` + `defaultValue` | ⚡ asignado con default | ❌ | ✅ |
| `hidden: true` | ✅ | ✅ | ❌ |
| Ambos flags | ❌ | ❌ | ❌ |

---

## Tipos de datos soportados

| YAML | Java |
|---|---|
| `String` | String |
| `Integer` | Integer |
| `Long` | Long |
| `BigDecimal` | BigDecimal |
| `Boolean` | Boolean |
| `LocalDate` | LocalDate |
| `LocalDateTime` | LocalDateTime |
| `LocalTime` | LocalTime |
| `Instant` | Instant |
| `UUID` | UUID |

---

## Relaciones

- ✅ `OneToMany`/`OneToOne` entre entidades del **mismo agregado** → declarar solo en raíz
- ✅ El generador infiere el lado inverso (`ManyToOne`) — **no declararlo en la secundaria**
- ✅ Referencia cross-aggregate → `reference:` en campo ID, nunca `relationships:`
- `mappedBy` debe coincidir con el nombre del campo inverso

---

## Validaciones JSR-303

Declarar en `fields[].validations` — se aplican **únicamente** en Command y CreateDto.

```yaml
validations:
  - type: NotBlank
    message: "Required"
  - type: Email
    message: "Invalid email"
  - type: Size
    min: 3
    max: 50
  - type: Min
    value: 1
  - type: Positive
```

Anotaciones: `NotNull`, `NotBlank`, `NotEmpty`, `Email`, `Size`, `Min`, `Max`, `Pattern`, `Digits`, `Positive`, `PositiveOrZero`, `Negative`, `Past`, `Future`, `AssertTrue`, `AssertFalse`.

---

## Proyecciones locales (read models)

Agregados sincronizados por listeners Kafka. Señales:
- Campos coinciden con `listeners[].fields`
- useCase: `Register*InLocalCatalog`, `Sync*`, `Update*FromEvent`
- Sin endpoints de escritura
- Existe para evitar llamadas síncronas en tiempo real

**Auditoría:** `audit.enabled: true`, `trackUser: false` (cambios vienen de eventos, no de usuarios).

```yaml
- name: BikeCatalog
  entities:
    - name: bikeCatalogEntry
      isRoot: true
      tableName: bike_catalog_entries
      audit:
        enabled: true
        trackUser: false
      fields:
        - name: id
          type: String
        - name: isAvailable
          type: Boolean
          readOnly: true
          defaultValue: true
```

---

## Clasificación de campos readOnly

Antes de declarar `events:`, clasifica cada campo `readOnly`:

| Categoría | Cuándo se asigna | Debe aparecer en... |
|---|---|---|
| Constante del sistema | Constructor con `defaultValue` | Ningún evento |
| Estado de máquina | Cada transición (enum) | Ningún campo explícito |
| Timestamp de transición | Una transición específica | El evento de **esa** transición |
| Dato calculado | Al ejecutar transición | El evento de esa transición |
| Acumulador | Múltiples operaciones | Eventos de cada operación |

**Protocolo para cada campo `readOnly` sin `defaultValue` y sin enum con `transitions`:**
1. ¿En qué transición se asigna?
2. ¿Esa transición tiene evento con triggers? → Sí: agregar al `fields[]`; No: crear evento + triggers
3. Si se asigna en múltiples transiciones: incluir en el evento principal

> Transición que asigna campos `readOnly` sin evento asociado = **brecha de diseño**.

---

## Análisis de activación de transiciones

Para cada método en `transitions[]`, clasificar:

| Quién activa | Mecanismo correcto |
|---|---|
| Endpoint HTTP | `endpoints:` con useCase semántico |
| Listener Kafka | `listeners:` con useCase semántico |
| Respuesta exitosa de port | Domain event + `triggers: [método]` |
| Respuesta error de port | Domain event + `triggers: [método]` |
| Scheduler / proceso interno | Domain event + `triggers: [método]` |

**Patrón port con dos ramas:**
```yaml
events:
  - name: NotificationSentEvent
    triggers: [markAsSent]
    fields:
      - name: sentAt
        type: LocalDateTime
  - name: NotificationFailedEvent
    triggers: [markAsFailed]
    fields: []
```

---

## Trazabilidad de enums *Type

Enums con nombre `*Type` representan clasificaciones. Cada valor debe ser trazable a:

| Origen | Traza semántica |
|---|---|
| Listener (nombre evento) | Tokens del nombre del evento |
| Listener (nombre campo) | Tokens del campo |
| Endpoint (useCase) | Tokens del useCase |
| Domain event (nombre) | Tokens del evento |

Si un valor no es trazable → falta un endpoint o listener en el diseño.

---

## Checklist del domain.yaml por módulo

- [ ] Campo `id` en todas las entidades
- [ ] Solo una entidad `isRoot: true` por agregado
- [ ] Relaciones solo en raíz; inverso NO declarado
- [ ] Campos de auditoría NO en `fields:`
- [ ] `readOnly` con `defaultValue` si hay valor inicial
- [ ] Enums con lifecycle tienen `initialValue` + `transitions`
- [ ] Value Objects sin `id`
- [ ] Referencias cross-aggregate con `reference:`, no `relationships:`
- [ ] `events[].name` consistente con `integrations.async[]`
- [ ] `events[].topic` explícito, coincide con `integrations.async[].topic`
- [ ] `events[].triggers[]` referencia métodos existentes en `transitions[].method`
- [ ] `{entityName}Id` en `events[].fields` cuando cruza módulos via Kafka
- [ ] `endpoints:` con estructura `{ basePath, versions }` — no lista plana
- [ ] `endpoints[].path` relativos al basePath
- [ ] `listeners[]` para todos los eventos donde este módulo es consumidor
- [ ] `listeners[].useCase` coincide con `consumers[].useCase`
- [ ] `listeners[].topic` bare SCREAMING_SNAKE_CASE (sin topicPrefix)
- [ ] `ports[]` para todas las entradas sync donde `caller = este módulo`
- [ ] `ports[].baseUrl` solo en primera entrada de cada `service:`
- [ ] `nestedTypes[]` para campos de tipo objeto en listeners/ports
- [ ] Transiciones por `ports:` tienen domain event con `triggers`
- [ ] Cada enum `*Type` valor trazable a listener/endpoint/event
- [ ] Proyecciones: `audit.enabled: true`, `trackUser: false`
- [ ] Todo en inglés
