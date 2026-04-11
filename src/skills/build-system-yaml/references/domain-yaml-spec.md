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
7. ❌ **`endpoints:` NUNCA es lista plana** — siempre `{ basePath, versions: [{ version, operations }] }`. Si el módulo tiene **2+ agregados**, usar `basePath: ""` y paths absolutos por operación
8. ❌ **No inventar eventos** — deben coincidir con `integrations.async[]` donde `producer` es este módulo
9. ❌ **No inventar listeners** — deben coincidir con `integrations.async[].consumers[]` donde `module` es este módulo
10. ❌ **No inventar ports** — deben coincidir con `integrations.sync[]` donde `caller` es este módulo
11. ❌ **Todo en inglés**
12. ❌ **No transiciones sin evidencia de activación** — toda transición activada por `ports:` o scheduler necesita un domain event con `triggers`
13. ❌ **No reutilizar `service:` en `ports[]` entre módulos** — nombres propios del bounded context
14. ❌ **No `readModels[].source.module` igual al módulo actual** — readModels son cross-module exclusivamente
15. ❌ **No auditoría, endpoints REST ni lógica de negocio en `readModels:`** — son proyecciones inmutables
16. ❌ **No `readModels[].name` sin sufijo `ReadModel`** — siempre `PascalCase + ReadModel`
17. ❌ **No `readModels[].tableName` sin prefijo `rm_`** — identificación visual obligatoria
18. ❌ **No `lifecycle:` y `triggers:` en el mismo evento** — son mutuamente excluyentes
19. ❌ **No `lifecycle: softDelete` sin `hasSoftDelete: true`** en la entidad raíz
20. ❌ **No `lifecycle: delete` con `hasSoftDelete: true`** — delete es hard delete
21. ❌ **No declarar campos en lifecycle events que no existan en la entidad raíz** — solo `{entityName}Id`, campos de la entidad y campos temporales auto-resolubles (`*At` + `LocalDateTime`). Genera error `C2-010`

---

## Inferencia desde system.yaml

| Fuente en system.yaml | Destino en domain.yaml |
|---|---|
| `modules[x].exposes[]` | `endpoints:` con `basePath` + `versions[].operations[]` |
| `integrations.async[]` donde `producer = módulo` | `events:` |
| `integrations.async[].consumers[]` donde `module = módulo` y tiene `useCase` | `listeners:` (con `useCase`) |
| `integrations.async[].consumers[]` donde `module = módulo` y tiene `readModel` | `readModels:` (con `syncedBy`) |
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

### Módulos con múltiples agregados

Cuando un módulo contiene **2 o más agregados** (ej: Product + Category), NO es posible usar un solo `basePath` porque cada agregado tiene su propio recurso REST. En este caso:

- Usar `basePath: ""` (string vacío — **NO** `basePath: /` que genera slash trailing)
- Declarar paths **absolutos** en cada operación (ej: `/products`, `/categories/{id}`)
- El controlador generado tendrá `@RequestMapping("/api/v1")` (limpio, sin slash extra)

```yaml
# ✅ Módulo con múltiples agregados — basePath vacío + paths absolutos
endpoints:
  basePath: ""
  versions:
    - version: v1
      operations:
        # ── Product operations ──
        - useCase: CreateProduct
          method: POST
          path: /products
        - useCase: GetProduct
          method: GET
          path: /products/{id}
        - useCase: FindAllProducts
          method: GET
          path: /products
        # ── Category operations ──
        - useCase: CreateCategory
          method: POST
          path: /categories
        - useCase: GetCategory
          method: GET
          path: /categories/{id}
        - useCase: FindProductsByCategory
          method: GET
          path: /categories/{id}/products
```

**Regla de decisión:**

| Agregados en el módulo | basePath | Paths en operations |
|---|---|---|
| 1 agregado | `/recurso` (ej: `/orders`) | Relativos: `/`, `/{id}`, `/{id}/confirm` |
| 2+ agregados | `""` (vacío) | Absolutos: `/products`, `/categories/{id}` |

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

      # ── Lifecycle events (CRUD-based, no transitions) ──
      # Use lifecycle: instead of triggers: when the event is emitted
      # at a CRUD operation (create/update/delete/softDelete).
      # Typical use: source modules whose events feed readModels.
      #
      # - name: ProductCreatedEvent
      #   lifecycle: create          # raise() in creation constructor
      #   fields:
      #     - name: productId
      #       type: String
      #     - name: name
      #       type: String
      #
      # - name: ProductUpdatedEvent
      #   lifecycle: update          # raise() in UpdateCommandHandler
      #   fields: [...]
      #
      # - name: ProductDeletedEvent
      #   lifecycle: delete          # raise() in DeleteCommandHandler
      #   fields:
      #     - name: productId
      #       type: String
      #
      # - name: ProductDeactivatedEvent
      #   lifecycle: softDelete      # raise() in softDelete() method
      #   fields:
      #     - name: productId
      #       type: String

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

## Proyecciones locales (`readModels:`)

Cuando un módulo necesita datos de otro bounded context para validar precondiciones o enriquecer entidades, usar `readModels:` en vez de `ports:` (sync HTTP). Esto elimina dependencias síncronas y mejora autonomía, resiliencia y rendimiento.

### Cuándo usar readModels vs ports

| Criterio | `readModels:` (async) | `ports:` (sync) |
|---|---|---|
| Consistencia eventual aceptable | ✅ | — |
| Se necesita consistencia fuerte | — | ✅ |
| Datos se consultan frecuentemente | ✅ | — |
| Llamada infrecuente y simple | — | ✅ |
| Preparación para microservicios | ✅ | — |

### Estructura

```yaml
# Nivel raíz, sibling de aggregates:, listeners:, ports:
readModels:
  - name: ProductReadModel               # PascalCase + sufijo "ReadModel" (OBLIGATORIO)
    source:                              # Trazabilidad al módulo fuente (OBLIGATORIO)
      module: products                   # Módulo fuente (kebab-case)
      aggregate: Product                 # Agregado fuente (PascalCase)
    tableName: rm_orders_products         # Tabla en BD (OBLIGATORIO, prefijo rm_{consumer}_{source})
    fields:                              # Campos proyectados — subconjunto del fuente
      - name: id
        type: String
      - name: name
        type: String
      - name: price
        type: BigDecimal
      - name: status
        type: String
    syncedBy:                            # Eventos que mantienen esta tabla (min 1)
      - event: ProductCreatedEvent       # Nombre del evento (PascalCase + sufijo Event)
        action: UPSERT                   # Acción: UPSERT | DELETE | SOFT_DELETE
      - event: ProductUpdatedEvent
        action: UPSERT
      - event: ProductDeactivatedEvent
        action: SOFT_DELETE
```

### Reglas

- **`name:`** — PascalCase, **DEBE** terminar con `ReadModel`
- **`tableName:`** — **DEBE** seguir el patrón `rm_{consumerModule}_{sourceModule}` (ej: `rm_orders_products`) para evitar colisiones en monolitos
- **`fields:`** — **DEBE** incluir un campo `id`
- **`syncedBy:`** — **DEBE** tener al menos una entrada
- **`source.module:`** — **NO PUEDE** ser el mismo módulo actual (cross-module exclusivamente)
- **Sin auditoría** — Los readModels **nunca** tienen campos de auditoría
- **Sin endpoints REST** — Los readModels **nunca** exponen endpoints
- **Sin lógica de negocio** — La clase de dominio es inmutable (solo getters)

### Acciones de sincronización

| Acción | Significado | Uso |
|---|---|---|
| `UPSERT` | Insertar si es nuevo, actualizar si existe | Creaciones, actualizaciones, cambios de estado |
| `DELETE` | Eliminar el registro permanentemente | Hard deletes en el módulo fuente |
| `SOFT_DELETE` | Marcar como inactivo con timestamp | Cuando el fuente usa soft delete |

### Inferencia desde system.yaml

| Fuente en system.yaml | Destino en domain.yaml |
|---|---|
| `consumers[].readModel: ProductReadModel` | `readModels:` entry con ese nombre |
| `integrations.async[].producer` | `readModels[].source.module` |
| `integrations.async[].topic` | Topic derivado automáticamente del nombre del evento |

### Impacto en el módulo fuente

El módulo fuente **debe** emitir los eventos referenciados en `syncedBy`. Asegurar que los `events:` del fuente incluyan todos los campos declarados en `readModels[].fields` (el payload es la fuente de verdad para la proyección).

**Restricción de cobertura:** Los campos del readModel (excepto `id`) deben estar cubiertos por al menos un evento UPSERT en `syncedBy[]`. Si un campo no aparece en ningún evento UPSERT, siempre será null — genera warning `C1-007`. Además, los campos del readModel deben ser subconjunto de los campos de la entidad raíz del módulo fuente (por C2-010, los lifecycle events no pueden emitir campos ajenos a la entidad).

### Propiedad `lifecycle:` en eventos del módulo fuente

Cuando un evento existe para alimentar un readModel (operación CRUD pura, sin transición de estado), usar `lifecycle:` en vez de `triggers:`.

| Valor | Punto de emisión | Descripción |
|---|---|---|
| `create` | Constructor de creación de la entidad | UUID auto-generado como id antes de raise() |
| `update` | UpdateCommandHandler, antes de `repository.save()` | raise() sobre la entidad reconstruida |
| `delete` | DeleteCommandHandler, antes de `repository.delete()` | Hard delete — requiere `hasSoftDelete` ausente o false |
| `softDelete` | Método `softDelete()` de la entidad | Requiere `hasSoftDelete: true` en la entidad raíz |

**Derivación desde el nombre del evento:**

| Patrón del nombre del evento | `lifecycle:` |
|---|---|
| `*CreatedEvent`, `*RegisteredEvent` | `create` |
| `*UpdatedEvent` | `update` |
| `*DeletedEvent` | `delete` |
| `*DeactivatedEvent` | `softDelete` |

**Ejemplo — módulo fuente `products`:**

```yaml
aggregates:
  - name: Product
    entities:
      - name: product
        isRoot: true
        tableName: products
        hasSoftDelete: true              # requerido por lifecycle: softDelete
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

**Reglas:**
- `lifecycle:` y `triggers:` son mutuamente excluyentes — un evento usa uno u otro, nunca ambos
- `lifecycle: softDelete` requiere `hasSoftDelete: true` en la entidad raíz
- `lifecycle: delete` requiere que `hasSoftDelete` sea `false` o esté ausente
- `fields:` del evento debe incluir **todos** los campos del readModel que lo consume (el payload es la fuente de verdad para la proyección)
- Siempre incluir `{entityName}Id` como campo (se mapea a `aggregateId` del DomainEvent base)
- `fields:` del lifecycle event solo puede contener: (a) `{entityName}Id`, (b) campos que existen en la entidad raíz del agregado, (c) campos temporales auto-resolubles (nombre termina en `At` + tipo `LocalDateTime`). Cualquier otro campo genera error `C2-010`

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
- [ ] Módulo con 1 agregado → `basePath: /recurso` y paths relativos
- [ ] Módulo con 2+ agregados → `basePath: ""` y paths absolutos por operación
- [ ] `endpoints[].path` coherentes con el basePath elegido
- [ ] `listeners[]` para todos los eventos donde este módulo es consumidor
- [ ] `listeners[].useCase` coincide con `consumers[].useCase`
- [ ] `listeners[].topic` bare SCREAMING_SNAKE_CASE (sin topicPrefix)
- [ ] `ports[]` para todas las entradas sync donde `caller = este módulo`
- [ ] `ports[].baseUrl` solo en primera entrada de cada `service:`
- [ ] `nestedTypes[]` para campos de tipo objeto en listeners/ports
- [ ] Transiciones por `ports:` tienen domain event con `triggers`
- [ ] Cada enum `*Type` valor trazable a listener/endpoint/event
- [ ] Proyecciones cross-module: usar `readModels:` con `source`, `tableName` (prefijo `rm_`), `fields` (incluye `id`), `syncedBy`
- [ ] `readModels[].name` termina con `ReadModel` (PascalCase)
- [ ] `readModels[].source.module` ≠ módulo actual
- [ ] `readModels[].syncedBy` → al menos una entrada con `action` válida (UPSERT, DELETE, SOFT_DELETE)
- [ ] Eventos en `syncedBy` deben existir como `events:` en el módulo fuente
- [ ] Eventos del módulo fuente consumidos por readModels → deben tener `lifecycle:` (no `triggers:`)
- [ ] `lifecycle:` derivado del nombre del evento: `*CreatedEvent`→`create`, `*UpdatedEvent`→`update`, `*DeletedEvent`→`delete`, `*DeactivatedEvent`→`softDelete`
- [ ] `lifecycle: softDelete` → entidad raíz tiene `hasSoftDelete: true`
- [ ] `lifecycle: delete` → entidad raíz NO tiene `hasSoftDelete: true`
- [ ] `lifecycle:` y `triggers:` nunca en el mismo evento
- [ ] Lifecycle event fields son campos de la entidad raíz (excluyendo `{entityName}Id` y `*At` temporal) — `C2-010`
- [ ] ReadModel fields cubiertos por eventos UPSERT del productor — `C1-007`
- [ ] ReadModel fields son subconjunto de los campos de la entidad raíz fuente
- [ ] Si `readModels:` reemplaza un `ports:`, eliminar la entrada sync correspondiente
- [ ] Todo en inglés
