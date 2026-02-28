# Command `generate entities` (alias: `g entities`)

---

## Índice

1. [Descripción y propósito](#1-descripción-y-propósito)
2. [Sintaxis y ubicación del YAML](#2-sintaxis-y-ubicación-del-yaml)
3. [Estructura base del domain.yaml](#3-estructura-base-del-domainyaml)
4. [Tipos de datos soportados](#4-tipos-de-datos-soportados)
5. [Propiedades de campo](#5-propiedades-de-campo)
6. [Validaciones JSR-303](#6-validaciones-jsr-303)
7. [Auditoría](#7-auditoría)
8. [Relaciones](#8-relaciones)
9. [Value Objects](#9-value-objects)
10. [Enums y transiciones de estado](#10-enums-y-transiciones-de-estado)
11. [Eventos de dominio](#11-eventos-de-dominio)
12. [Múltiples agregados](#12-múltiples-agregados)
13. [Archivos generados](#13-archivos-generados)
14. [Ejemplos completos](#14-ejemplos-completos)
15. [Prerequisitos y errores comunes](#15-prerequisitos-y-errores-comunes)

---

## 1. Descripción y propósito

`generate entities` es el comando central de eva4j. A partir de un archivo `domain.yaml`, genera la arquitectura hexagonal completa del módulo:

- **Capa de dominio** – Entidades, Value Objects, Enums, interfaces de repositorio
- **Capa de aplicación** – Commands, Queries, handlers, DTOs, mappers
- **Capa de infraestructura** – Entidades JPA, repositorios Spring Data, implementaciones de repositorio, controladores REST

El generador entiende relaciones, auditoría, visibilidad de campos, validaciones, transiciones de estado y eventos de dominio.

---

## 2. Sintaxis y ubicación del YAML

```bash
eva generate entities <module>
eva g entities <module>          # alias corto
```

### Parámetros

| Parámetro | Requerido | Descripción |
|-----------|-----------|-------------|
| `<module>` | Sí | Nombre del módulo (debe existir en el proyecto) |

### Opciones

| Opción | Descripción |
|--------|-------------|
| `--force` | Sobrescribe archivos con cambios del desarrollador |

### Ubicación del YAML

El archivo se lee desde:

```
src/main/java/<package>/<module>/domain.yaml
```

> El generador detecta cambios de desarrollador mediante checksums. Si un archivo fue modificado manualmente, **no se sobreescribe** a menos que uses `--force`.

---

## 3. Estructura base del domain.yaml

```yaml
aggregates:                          # Lista de agregados en el módulo
  - name: Order                      # Nombre del agregado (PascalCase)
    entities:                        # Entidades del agregado
      - name: order                  # Nombre de entidad (camelCase)
        isRoot: true                 # true = raíz del agregado
        tableName: orders            # Nombre de tabla SQL (opcional)
        audit:                       # Auditoría (opcional)
          enabled: true
          trackUser: false
        fields:                      # Campos de la entidad
          - name: id
            type: String
          - name: status
            type: OrderStatus        # Referencia a enum o VO
        relationships:               # Relaciones JPA (opcional)
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY

      - name: orderItem              # Entidad secundaria (sin isRoot o isRoot: false)
        tableName: order_items
        fields:
          - name: id
            type: Long
          - name: quantity
            type: Integer

    valueObjects:                    # Value Objects del agregado
      - name: Money
        fields:
          - name: amount
            type: BigDecimal
          - name: currency
            type: String

    enums:                           # Enums del agregado
      - name: OrderStatus
        values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]

    events:                          # Eventos de dominio (opcional)
      - name: OrderPlaced
        fields:
          - name: customerId
            type: String
```

> **Sinónimos soportados**: `fields` = `properties`; `target` = `targetEntity`

### Regla del campo `id`

Toda entidad **debe** tener un campo llamado exactamente `id`:

| Tipo del `id` | Estrategia generada |
|---------------|---------------------|
| `String` | `@GeneratedValue(strategy = GenerationType.UUID)` |
| `Long` | `@GeneratedValue(strategy = GenerationType.IDENTITY)` |

---

## 4. Tipos de datos soportados

| Tipo YAML | Tipo Java | Observaciones |
|-----------|-----------|---------------|
| `String` | `String` | Para `id` genera UUID |
| `Integer` | `Integer` | Para `id` genera IDENTITY |
| `Long` | `Long` | Para `id` genera IDENTITY |
| `Double` | `Double` | |
| `BigDecimal` | `BigDecimal` | |
| `Boolean` | `Boolean` | |
| `LocalDate` | `LocalDate` | Import automático |
| `LocalDateTime` | `LocalDateTime` | Import automático |
| `LocalTime` | `LocalTime` | Import automático |
| `UUID` | `UUID` | Import automático |
| `List<String>` | `List<String>` | `@ElementCollection` |
| `List<VO>` | `List<VoJpa>` | `@ElementCollection` |
| Nombre de Enum | Enum del módulo | `@Enumerated(STRING)` |
| Nombre de VO | Value Object | `@Embedded` |

---

## 5. Propiedades de campo

```yaml
fields:
  - name: fieldName        # camelCase, requerido
    type: String           # tipo Java, requerido
    readOnly: false        # default false
    hidden: false          # default false
    validations: []        # anotaciones JSR-303
    annotations: []        # anotaciones JPA crudas
    reference:             # referencia semántica a otro agregado
      aggregate: Customer
      module: customers
    enumValues: []         # enum inline (alternativa a enums:)
```

### Matriz de visibilidad

| Campo | Constructor creación | CreateDto/Command | Constructor completo | ResponseDto |
|-------|---------------------|-------------------|----------------------|-------------|
| normal | ✅ | ✅ | ✅ | ✅ |
| `readOnly: true` | ❌ | ❌ | ✅ | ✅ |
| `hidden: true` | ✅ | ✅ | ✅ | ❌ |
| `readOnly + hidden` | ❌ | ❌ | ✅ | ❌ |

### readOnly

Marca un campo como calculado/derivado: se excluye del constructor de negocio y del `CreateDto`/`CreateCommand`, pero sí aparece en el constructor completo (reconstrucción desde persistencia) y en `ResponseDto`.

```yaml
fields:
  - name: totalAmount
    type: BigDecimal
    readOnly: true    # calculado de la suma de items
```

> Cuando un enum tiene `initialValue`, el campo correspondiente se trata como `readOnly` automáticamente.

### hidden

Marca un campo como sensible: se incluye en creación pero NO aparece en `ResponseDto`.

```yaml
fields:
  - name: passwordHash
    type: String
    hidden: true    # no exponer en API
```

### annotations (JPA crudas)

Permite agregar anotaciones JPA personalizadas a la entidad JPA generada.

```yaml
fields:
  - name: email
    type: String
    annotations:
      - "@Column(unique = true, nullable = false)"
```

### reference

Declara una referencia semántica a un campo de otro agregado. Genera un comentario Javadoc indicando la relación, sin crear dependencia de código.

```yaml
fields:
  - name: customerId
    type: String
    reference:
      aggregate: Customer
      module: customers
```

Genera en la entidad de dominio:

```java
/** @see customers.Customer */
private String customerId;
```

---

## 6. Validaciones JSR-303

Las validaciones se declaran en el campo y se aplican al `CreateCommand` y `CreateDto`. **No** se añaden a las entidades de dominio.

```yaml
fields:
  - name: name
    type: String
    validations:
      - type: NotBlank
        message: "El nombre es obligatorio"
      - type: Size
        min: 2
        max: 100
```

Genera import automático: `import jakarta.validation.constraints.*;`

### Parámetros soportados

| Parámetro | Descripción |
|-----------|-------------|
| `type` | Nombre de la anotación sin `@` (requerido) |
| `message` | Mensaje de error personalizado |
| `value` | Valor único (para `@Min`, `@Max`) |
| `min` | Valor mínimo (para `@Size`, `@DecimalMin`) |
| `max` | Valor máximo (para `@Size`, `@DecimalMax`) |
| `regexp` | Expresión regular (para `@Pattern`) |
| `integer` | Dígitos enteros (para `@Digits`) |
| `fraction` | Dígitos decimales (para `@Digits`) |
| `inclusive` | Inclusivo (para `@DecimalMin`, `@DecimalMax`) |

### Ejemplos por tipo

```yaml
# @NotBlank
- type: NotBlank
  message: "Campo obligatorio"

# @NotNull
- type: NotNull

# @Size
- type: Size
  min: 2
  max: 255

# @Email
- type: Email

# @Min / @Max (para numéricos)
- type: Min
  value: 1
- type: Max
  value: 999

# @Pattern
- type: Pattern
  regexp: "^[A-Z]{2}[0-9]{6}$"
  message: "Formato inválido"

# @DecimalMin / @DecimalMax
- type: DecimalMin
  min: "0.01"
  inclusive: true
- type: DecimalMax
  max: "9999.99"

# @Digits
- type: Digits
  integer: 6
  fraction: 2
```

---

## 7. Auditoría

### Sintaxis

```yaml
# Nuevo (recomendado)
audit:
  enabled: true       # agrega createdAt, updatedAt
  trackUser: true     # también agrega createdBy, updatedBy

# Legacy (equivalente a audit.enabled: true, trackUser: false)
auditable: true
```

### Herencia JPA generada

| Configuración | Clase base JPA |
|---------------|----------------|
| Sin auditoría | sin herencia |
| `audit.enabled: true` | `extends AuditableEntity` |
| `audit.trackUser: true` | `extends FullAuditableEntity` |

### Campos generados

| Campo | `audit.enabled` | `audit.trackUser` | En ResponseDto |
|-------|-----------------|-------------------|----------------|
| `createdAt` | ✅ | ✅ | ✅ |
| `updatedAt` | ✅ | ✅ | ✅ |
| `createdBy` | ❌ | ✅ | ❌ |
| `updatedBy` | ❌ | ✅ | ❌ |

> `createdBy` y `updatedBy` son metadatos administrativos: nunca se exponen en DTOs de respuesta.

### Infraestructura generada con `trackUser: true`

Cuando se activa `trackUser`, eva4j genera automáticamente:

| Archivo | Propósito |
|---------|-----------|
| `UserContextHolder.java` | ThreadLocal para el usuario actual |
| `UserContextFilter.java` | Captura el header `X-User` de cada request |
| `AuditorAwareImpl.java` | Provee el usuario actual para JPA Auditing |

La clase `Application.java` se configura con `@EnableJpaAuditing(auditorAwareRef = "auditorProvider")`.

### Ejemplo

```yaml
entities:
  - name: order
    isRoot: true
    tableName: orders
    audit:
      enabled: true
      trackUser: true
    fields:
      - name: id
        type: String
      - name: amount
        type: BigDecimal
```

> Los campos de auditoría **no se definen manualmente** en `fields:`; se heredan de la clase base JPA.

---

## 8. Relaciones

### Propiedades

| Propiedad | Valores | Descripción |
|-----------|---------|-------------|
| `type` | `OneToMany`, `ManyToOne`, `OneToOne`, `ManyToMany` | Tipo de relación |
| `target` / `targetEntity` | Nombre de entidad | Entidad relacionada |
| `mappedBy` | nombre de campo | Lado inverso de la relación |
| `joinColumn` | nombre de columna | Nombre de la FK |
| `cascade` | array de `PERSIST`, `MERGE`, `REMOVE`, `REFRESH`, `DETACH`, `ALL` | Operaciones en cascada |
| `fetch` | `LAZY` (default), `EAGER` | Estrategia de carga |

### Auto-generación del lado inverso

Cuando defines `OneToMany` con `mappedBy`, eva4j genera automáticamente el `@ManyToOne` en la entidad JPA del target. **No es necesario definir ambos lados.**

```yaml
# ✅ Solo esto es necesario
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY

# Eva4j genera en OrderItemJpa:
# @ManyToOne(fetch = FetchType.LAZY)
# @JoinColumn(name = "order_id")
# private OrderJpa order;
```

> Si defines `ManyToOne` manualmente, esa definición tiene prioridad sobre la auto-generación.

### OneToMany

```yaml
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE, REMOVE]
    fetch: LAZY
```

Genera en dominio:

```java
private List<OrderItem> orderItems = new ArrayList<>();
public void addOrderItem(OrderItem item) { orderItems.add(item); }
public void removeOrderItem(OrderItem item) { orderItems.remove(item); }
```

### ManyToOne (manual, cuando necesitas FK específica)

```yaml
relationships:
  - type: ManyToOne
    target: Order
    joinColumn: fk_order_uuid
    fetch: LAZY
```

### OneToOne

```yaml
# Lado con mappedBy (inverso)
relationships:
  - type: OneToOne
    target: OrderSummary
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY

# Lado propietario (con FK)
relationships:
  - type: OneToOne
    target: Order
    joinColumn: order_id
    fetch: LAZY
```

### Cuándo definir ManyToOne manualmente

| Escenario | ¿Definir ManyToOne? |
|-----------|---------------------|
| Relación estándar con `mappedBy` | ❌ Eva4j lo genera |
| FK con nombre personalizado | ✅ Sí, para controlar `joinColumn` |
| Múltiples FKs a la misma entidad | ✅ Sí, para nombres distintos |
| Relación unidireccional (sin inverso) | ✅ Sí |

### Cascade recomendado

```yaml
# Hijo no tiene sentido sin padre → incluir REMOVE
cascade: [PERSIST, MERGE, REMOVE]

# Hijo tiene ciclo de vida independiente
cascade: [PERSIST, MERGE]
```

---

## 9. Value Objects

Son objetos inmutables que representan conceptos de dominio sin identidad propia.

```yaml
valueObjects:
  - name: Money
    fields:
      - name: amount
        type: BigDecimal
      - name: currency
        type: String
```

Genera:

- `Money.java` – clase de dominio inmutable con constructor, getters, `equals()`, `hashCode()`
- `MoneyJpa.java` – `@Embeddable` con Lombok

Uso en campo:

```yaml
- name: totalAmount
  type: Money    # detectado automáticamente como @Embedded
```

### Lista de Value Objects

```yaml
- name: addresses
  type: List<Address>
```

Genera:

```java
@ElementCollection
@CollectionTable(name = "entity_addresses", joinColumns = @JoinColumn(name = "entity_id"))
@Builder.Default
private List<AddressJpa> addresses = new ArrayList<>();
```

---

## 10. Enums y transiciones de estado

### Enum simple

```yaml
enums:
  - name: OrderStatus
    values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]
```

Genera `OrderStatus.java` con los valores enumerados. En JPA: `@Enumerated(EnumType.STRING)`.

### Enum con transiciones de estado

Las transiciones generan métodos de negocio en la entidad, lógica de validación en el enum y previenen estados inválidos.

```yaml
enums:
  - name: OrderStatus
    initialValue: PENDING          # asigna valor inicial; campo queda readOnly
    values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]
    transitions:
      - from: PENDING              # puede ser string o [array]
        to: CONFIRMED
        method: confirm            # nombre del método generado en la entidad
      - from: [PENDING, CONFIRMED]
        to: CANCELLED
        method: cancel
        guard: "this.status == OrderStatus.DELIVERED"  # BusinessException si es true
      - from: CONFIRMED
        to: SHIPPED
        method: ship
```

#### Lo que genera en el Enum

```java
private static final Map<OrderStatus, List<OrderStatus>> VALID_TRANSITIONS = Map.of(
    PENDING,   List.of(CONFIRMED, CANCELLED),
    CONFIRMED, List.of(SHIPPED, CANCELLED),
    SHIPPED,   List.of(DELIVERED));

public boolean canTransitionTo(OrderStatus next) {
    return VALID_TRANSITIONS.getOrDefault(this, List.of()).contains(next);
}

public OrderStatus transitionTo(OrderStatus next) {
    if (!canTransitionTo(next)) {
        throw new InvalidStateTransitionException(this, next);
    }
    return next;
}
```

#### Lo que genera en la entidad raíz

Un método por transición, más helpers `is*()` y `can*()`:

```java
public void confirm() {
    this.status = this.status.transitionTo(OrderStatus.CONFIRMED);
}

public void cancel() {
    if (this.status == OrderStatus.DELIVERED) {
        throw new BusinessException("Cannot cancel a delivered order");
    }
    this.status = this.status.transitionTo(OrderStatus.CANCELLED);
}

public boolean isPending() { return this.status == OrderStatus.PENDING; }
public boolean canConfirm() { return this.status.canTransitionTo(OrderStatus.CONFIRMED); }
```

### `initialValue`

Asigna un valor por defecto al campo de estado en el constructor de creación. El campo queda marcado como `readOnly` automáticamente (no aparece en `CreateDto`/`CreateCommand`).

```yaml
enums:
  - name: OrderStatus
    initialValue: PENDING
```

### `guard`

Condición Java evaluada en el método de transición. Si la expresión es `true`, se lanza `BusinessException`.

```yaml
- from: [PENDING, CONFIRMED]
  to: CANCELLED
  method: cancel
  guard: "this.totalAmount.compareTo(BigDecimal.ZERO) == 0"
```

---

## 11. Eventos de dominio

Los eventos se declaran bajo el agregado (a mismo nivel que `entities:`, `enums:`, `valueObjects:`).

```yaml
aggregates:
  - name: Order
    events:
      - name: OrderPlaced        # sufijo "Event" se agrega automáticamente
        fields:
          - name: customerId
            type: String
          - name: totalAmount
            type: BigDecimal
      - name: OrderCancelled
        fields:
          - name: reason
            type: String
    entities:
      - name: order
        # ...
```

### Archivos generados

| Archivo | Descripción |
|---------|-------------|
| `shared/domain/DomainEvent.java` | Clase base abstracta (generada una vez por proyecto) |
| `domain/models/events/OrderPlacedEvent.java` | Evento concreto que extiende `DomainEvent` |
| `domain/models/events/OrderCancelledEvent.java` | Evento concreto |
| `raise()` / `pullDomainEvents()` en el agregado raíz | Infraestructura de eventos en la entidad |
| `OrderRepositoryImpl.java` | Llama `eventPublisher.publishEvent()` al guardar |
| `OrderDomainEventHandler.java` | Clase con `@TransactionalEventListener` por cada evento |

### Evento generado

```java
public final class OrderPlacedEvent extends DomainEvent {
    private final String customerId;
    private final BigDecimal totalAmount;

    public OrderPlacedEvent(String customerId, BigDecimal totalAmount) {
        this.customerId = customerId;
        this.totalAmount = totalAmount;
    }

    // getters
}
```

### Cómo disparar el evento en la entidad

```java
public class Order {
    private final List<DomainEvent> domainEvents = new ArrayList<>();

    public void place(String customerId, BigDecimal totalAmount) {
        // lógica de negocio...
        raise(new OrderPlacedEvent(customerId, totalAmount));
    }

    protected void raise(DomainEvent event) {
        domainEvents.add(event);
    }

    public List<DomainEvent> pullDomainEvents() {
        List<DomainEvent> events = new ArrayList<>(domainEvents);
        domainEvents.clear();
        return events;
    }
}
```

---

## 12. Múltiples agregados

Un `domain.yaml` puede contener varios agregados. Cada uno genera su propio conjunto de archivos.

```yaml
aggregates:
  - name: Customer
    entities:
      - name: customer
        isRoot: true
        fields:
          - name: id
            type: String
          - name: email
            type: String

  - name: Product
    entities:
      - name: product
        isRoot: true
        fields:
          - name: id
            type: String
          - name: name
            type: String
    enums:
      - name: ProductCategory
        values: [ELECTRONICS, CLOTHING, FOOD]
```

> Los enums y Value Objects son locales al agregado donde se definen. Si dos agregados necesitan el mismo VO, se debe declarar en cada uno.

---

## 13. Archivos generados

Por cada agregado se generan aproximadamente los siguientes archivos:

| Archivo | Capa | Descripción |
|---------|------|-------------|
| `{Root}.java` | Domain | Entidad raíz del agregado |
| `{Entity}.java` | Domain | Entidades secundarias |
| `{Vo}.java` | Domain | Value Objects |
| `{Enum}.java` | Domain | Enums (con VALID_TRANSITIONS si hay transiciones) |
| `{Root}Repository.java` | Domain | Interfaz de repositorio (puerto) |
| `Create{Root}Command.java` | Application | Comando de creación |
| `Create{Root}CommandHandler.java` | Application | Handler del comando |
| `Get{Root}Query.java` | Application | Query por ID |
| `Get{Root}QueryHandler.java` | Application | Handler de query |
| `List{Root}Query.java` | Application | Query paginada |
| `List{Root}QueryHandler.java` | Application | Handler de lista |
| `{Root}ResponseDto.java` | Application | DTO de respuesta |
| `Create{Root}Dto.java` | Application | DTO de creación |
| `{Root}ApplicationMapper.java` | Application | Mapper Command/DTO ↔ Domain |
| `{Root}Jpa.java` | Infrastructure | Entidad JPA |
| `{Entity}Jpa.java` | Infrastructure | Entidades secundarias JPA |
| `{Vo}Jpa.java` | Infrastructure | Value Objects JPA (@Embeddable) |
| `{Root}Mapper.java` | Infrastructure | Mapper Domain ↔ JPA |
| `{Root}JpaRepository.java` | Infrastructure | Repositorio Spring Data |
| `{Root}RepositoryImpl.java` | Infrastructure | Implementación del repositorio |
| `{Root}Controller.java` | Infrastructure | Controlador REST |

### Endpoints REST generados

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/{module}/{entity}` | Crear |
| `GET` | `/api/{module}/{entity}/{id}` | Obtener por ID |
| `GET` | `/api/{module}/{entity}?page=0&size=20` | Listar paginado |
| `PUT` | `/api/{module}/{entity}/{id}` | Actualizar |
| `DELETE` | `/api/{module}/{entity}/{id}` | Eliminar |

---

## 14. Ejemplos completos

### Ejemplo 1: Pedido con transiciones y eventos

```yaml
aggregates:
  - name: Order
    entities:
      - name: order
        isRoot: true
        tableName: orders
        audit:
          enabled: true
        fields:
          - name: id
            type: String
          - name: customerId
            type: String
            reference:
              aggregate: Customer
              module: customers
          - name: status
            type: OrderStatus
          - name: totalAmount
            type: BigDecimal
            readOnly: true
        relationships:
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY

      - name: orderItem
        tableName: order_items
        fields:
          - name: id
            type: Long
          - name: productId
            type: String
          - name: quantity
            type: Integer
            validations:
              - type: Min
                value: 1
          - name: unitPrice
            type: BigDecimal

    enums:
      - name: OrderStatus
        initialValue: PENDING
        values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]
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

    events:
      - name: OrderPlaced
        fields:
          - name: customerId
            type: String
      - name: OrderCancelled
        fields:
          - name: reason
            type: String
```

### Ejemplo 2: Usuario con auditoría y campo sensible

```yaml
aggregates:
  - name: User
    entities:
      - name: user
        isRoot: true
        tableName: users
        audit:
          enabled: true
          trackUser: true
        fields:
          - name: id
            type: String
          - name: username
            type: String
            validations:
              - type: NotBlank
              - type: Size
                min: 3
                max: 50
          - name: email
            type: String
            validations:
              - type: Email
            annotations:
              - "@Column(unique = true)"
          - name: passwordHash
            type: String
            hidden: true
          - name: role
            type: UserRole
          - name: active
            type: Boolean

    enums:
      - name: UserRole
        values: [ADMIN, USER, MODERATOR]
```

---

## 15. Prerequisitos y errores comunes

### Prerequisitos

- Proyecto creado con `eva create`
- Módulo existente (`eva add module <module>`)
- Archivo `domain.yaml` en `src/main/java/<package>/<module>/`

### Errores comunes

| Error | Causa | Solución |
|-------|-------|----------|
| `Module does not exist` | El módulo no fue creado | Ejecutar `eva add module <module>` |
| `YAML file not found` | No existe `domain.yaml` en la ruta correcta | Verificar `src/main/java/<pkg>/<module>/domain.yaml` |
| `Invalid relationship target` | El target no está definido en el mismo YAML | Definir la entidad target en el mismo `domain.yaml` |
| `Column 'x_id' is duplicated` | ManyToOne definido manualmente + auto-generado | Eliminar el ManyToOne manual; dejar que eva4j lo genere |
| Archivo no regenerado | El archivo fue modificado manualmente (checksum) | Usar `--force` para sobreescribir |
| Import errors | Campo `type` no coincide con nombre en `enums:` o `valueObjects:` | Verificar que los nombres coincidan exactamente |

## 💡 Examples

### Example 1: Simple Customer Aggregate

**File:** `examples/customer.yaml`

```yaml
module: customer

aggregates:
  - name: Customer
    tableName: customers
    auditable: true
    
    entities:
      - name: customer
        isRoot: true
        fields:
          - name: id
            type: Long
          - name: firstName
            type: String
            validations:
              - "@NotBlank"
              - "@Size(max = 100)"
          - name: email
            type: String
            validations:
              - "@Email"
          - name: status
            type: CustomerStatus
```

**Generate:**
```bash
eva4j g entities customer
```

### Example 2: Complex Order with Relations

**File:** `examples/order.yaml`

```yaml
module: order

aggregates:
  - name: Order
    tableName: orders
    auditable: true
    
    entities:
      - name: order
        isRoot: true
        fields:
          - name: id
            type: Long
          - name: orderNumber
            type: String
          - name: totalAmount
            type: BigDecimal
          - name: status
            type: OrderStatus
        relationships:
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: ALL
            fetch: LAZY
      
      - name: orderItem
        isRoot: false
        tableName: order_items
        fields:
          - name: id
            type: Long
          - name: quantity
            type: Integer
          - name: unitPrice
            type: BigDecimal
        relationships:
          - type: ManyToOne
            target: Order
            fetch: LAZY
    
    enums:
      - name: OrderStatus
        values:
          - PENDING
          - CONFIRMED
          - SHIPPED
          - DELIVERED
          - CANCELLED
```

**Generate:**
```bash
eva4j g entities order
```

### Example 3: With Value Objects

**File:** `examples/evaluation.yaml`

```yaml
module: evaluation

aggregates:
  - name: Evaluation
    tableName: evaluations
    
    entities:
      - name: evaluation
        isRoot: true
        fields:
          - name: id
            type: String
          - name: score
            type: Integer
        relationships:
          - type: OneToMany
            target: EvaluationDoctor
            cascade: ALL
      
      - name: evaluationDoctor
        isRoot: false
        fields:
          - name: id
            type: Long
          - name: degrees
            type: List<Degrees>
    
    valueObjects:
      - name: Degrees
        fields:
          - name: title
            type: String
          - name: institution
            type: String
          - name: year
            type: Integer
          - name: typeDegrees
            type: TypeDegrees
    
    enums:
      - name: TypeDegrees
        values:
          - BACHELOR
          - MASTER
          - PHD
```

**Generate:**
```bash
eva4j g entities evaluation
```

## 📦 Generated Code Structure

```
src/main/java/com/example/project/<module>/
├── domain/
│   ├── models/
│   │   ├── Customer.java                    # Domain entity (root)
│   │   ├── OrderItem.java                   # Domain entity (secondary)
│   │   ├── valueobjects/
│   │   │   └── Degrees.java                 # Value object
│   │   └── enums/
│   │       └── OrderStatus.java             # Enum
│   └── repositories/
│       └── CustomerRepository.java          # Repository port (interface)
│
├── application/
│   ├── commands/
│   │   ├── CreateCustomerCommand.java       # Create command
│   │   └── CreateCustomerCommandHandler.java # Command handler
│   ├── queries/
│   │   ├── GetCustomerQuery.java            # Get query
│   │   ├── GetCustomerQueryHandler.java     # Get handler
│   │   ├── ListCustomersQuery.java          # List query
│   │   └── ListCustomersQueryHandler.java   # List handler
│   ├── dtos/
│   │   ├── CreateCustomerDto.java           # Create DTO
│   │   ├── CreateOrderItemDto.java          # Nested entity DTO
│   │   └── CustomerResponseDto.java         # Response DTO
│   └── mappers/
│       └── CustomerApplicationMapper.java   # Application mapper (Command/DTO → Domain)
│
└── infrastructure/
    ├── database/
    │   ├── entities/
    │   │   ├── CustomerJpa.java             # JPA entity (root)
    │   │   ├── OrderItemJpa.java            # JPA entity (secondary)
    │   │   └── valueobjects/
    │   │       └── DegreesJpa.java          # JPA value object
    │   ├── repositories/
    │   │   ├── CustomerJpaRepository.java   # Spring Data repository
    │   │   └── CustomerRepositoryImpl.java  # Repository implementation
    │   └── mappers/
    │       └── CustomerMapper.java          # Infrastructure mapper (Domain ↔ JPA)
    └── rest/
        └── controllers/
            └── CustomerController.java      # REST controller with CRUD endpoints
```

## ✨ Features

### 1. Domain Layer (Pure Business Logic)
- ✅ **Entities** - Aggregate root and secondary entities
- ✅ **Value Objects** - Immutable value types with `@Embedded` support
- ✅ **Enums** - Type-safe enumerations
- ✅ **Repository Interfaces** - Ports for persistence

### 2. Application Layer (Use Cases - CQRS)
- ✅ **Commands** - `CreateCustomerCommand` with validation
- ✅ **CommandHandlers** - Business logic orchestration
- ✅ **Queries** - `GetCustomerQuery`, `ListCustomersQuery`
- ✅ **QueryHandlers** - Read operations with pagination
- ✅ **DTOs** - Request/Response data transfer objects
- ✅ **Application Mappers** - Command/DTO → Domain transformations

### 3. Infrastructure Layer (Technical Details)
- ✅ **JPA Entities** - Persistence annotations (`@Entity`, `@Table`)
- ✅ **JPA Repositories** - Spring Data JPA implementation
- ✅ **Infrastructure Mappers** - Domain ↔ JPA bidirectional mapping
- ✅ **REST Controllers** - CRUD endpoints (`POST`, `GET`, `GET list`)

### 4. Advanced Capabilities
- ✅ **Relationships** - OneToMany, ManyToOne, OneToOne, ManyToMany
- ✅ **Nested Entities** - Secondary entities with their own relationships
- ✅ **Value Object Collections** - `List<ValueObject>` with `@ElementCollection`
- ✅ **Auditing** - `@CreatedDate`, `@LastModifiedDate` when `auditable: true`
- ✅ **Cascade Operations** - Configurable cascade types
- ✅ **Fetch Strategies** - LAZY/EAGER configuration
- ✅ **Validations** - Bean Validation annotations
- ✅ **Pagination** - Built-in pagination support for list queries

## 🔄 Supported Relationships

### OneToMany / ManyToOne (Bidirectional)

```yaml
# Parent entity
entities:
  - name: order
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order      # Field in OrderItem that owns the relationship
        cascade: ALL
        fetch: LAZY

# Child entity
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Order
        fetch: LAZY
```

### OneToOne

```yaml
entities:
  - name: user
    relationships:
      - type: OneToOne
        target: UserProfile
        cascade: ALL

  - name: userProfile
    relationships:
      - type: OneToOne
        target: User
```

### ManyToMany

```yaml
entities:
  - name: student
    relationships:
      - type: ManyToMany
        target: Course
        cascade: PERSIST

  - name: course
    relationships:
      - type: ManyToMany
        target: Student
        mappedBy: courses
```

### Relations Between Secondary Entities

```yaml
entities:
  - name: evaluationDoctor
    relationships:
      - type: OneToMany
        target: EvaluationBranch      # Another secondary entity
        cascade: ALL

  - name: evaluationBranch
    relationships:
      - type: ManyToOne
        target: EvaluationDoctor
```

## 🎯 Supported Data Types

### Primitive Types
- `String`, `Integer`, `Long`, `Double`, `Float`, `Boolean`
- `BigDecimal`, `BigInteger`
- `LocalDate`, `LocalDateTime`, `LocalTime`
- `ZonedDateTime`, `Instant`

### Collections
- `List<ValueObject>` - Generates `@ElementCollection`
- `List<Entity>` - Generates `@OneToMany`

### Custom Types
- Value Objects (defined in `valueObjects` section)
- Enums (defined in `enums` section)

## 🚀 Next Steps

After generating entities:

1. **Review generated code:**
   ```bash
   # Check domain models
   cat src/main/java/com/example/project/<module>/domain/models/*.java
   ```

2. **Add business logic:**
   - Edit domain entities to add business methods
   - Implement domain validations
   - Add domain events if needed

3. **Test the API:**
   ```bash
   ./gradlew bootRun
   # POST http://localhost:8080/api/<module>/<entity>
   # GET  http://localhost:8080/api/<module>/<entity>/{id}
   # GET  http://localhost:8080/api/<module>/<entity>
   ```

4. **Extend functionality:**
   ```bash
   eva4j g usecase UpdateCustomer --type command
   eva4j g usecase DeleteCustomer --type command
   ```

## ⚠️ Prerequisites

- Be in a project created with `eva4j create`
- Module must exist (created with `eva4j add module`)
- YAML file must exist at `examples/<aggregate-name>.yaml`

## 🔍 Validations

The command validates:
- ✅ Valid eva4j project
- ✅ Target module exists
- ✅ YAML file exists and is valid
- ✅ No syntax errors in YAML
- ✅ Entity names are unique
- ✅ Relationship targets exist
- ✅ Field types are valid

## 📚 See Also

- [DOMAIN_YAML_GUIDE.md](../../DOMAIN_YAML_GUIDE.md) - Complete YAML syntax reference
- [add-module](./ADD_MODULE.md) - Create modules
- [generate-usecase](./GENERATE_USECASE.md) - Add more use cases

## 🐛 Troubleshooting

**Error: "YAML file not found"**
- Solution: Create `examples/<aggregate-name>.yaml` file first

**Error: "Module does not exist"**
- Solution: Run `eva4j add module <module-name>` first

**Error: "Invalid relationship target"**
- Solution: Ensure the target entity is defined in the same aggregate

**Import errors after generation**
- Solution: This has been fixed in recent versions. Make sure you're using eva4j 1.0.3+
- If still happening, check that field types match defined ValueObjects/Enums

**Compilation errors with List<ValueObject>**
- Solution: Updated in latest version to use `List<ValueObjectJpa>` in JPA entities
  - Mapper name: `OrderMapper.java`
  - File organization
  - Generated code references

---

## Entities

### Root Entity (Aggregate Root)

The root entity is the entry point to the aggregate. All operations must go through it.

**⚠️ Important**: The root entity is defined within the `entities` array with `isRoot: true`.

```yaml
aggregates:
  - name: Order
    entities:
      - name: order              # Entity name (camelCase or snake_case)
        isRoot: true             # ← REQUIRED to mark the root
        tableName: orders        # Table name in DB (optional)
        
        fields:
          - name: id
            type: String         # String generates UUID, Long generates IDENTITY
            
          - name: orderNumber
            type: String
            
          - name: status
            type: OrderStatus    # Reference to an enum
            
          - name: totalAmount
            type: Money          # Reference to a value object
            
          - name: createdAt
            type: LocalDateTime
        
        relationships:
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY
```

### Secondary Entities

Entities that belong to the aggregate but are not the root. They are defined in the same `entities` array **without** `isRoot` (or with `isRoot: false`).

```yaml
aggregates:
  - name: Order
    entities:
      # ... root entity order with isRoot: true ...
      
      - name: orderItem          # ← Secondary entity
        tableName: order_items
        # Without isRoot or isRoot: false = secondary
        
        fields:
          - name: id
            type: Long
            
          - name: productId
            type: String
            
          - name: quantity
            type: Integer
            
          - name: unitPrice
            type: Money
        
        relationships:
          - type: ManyToOne
            target: Order
            joinColumn: order_id
            fetch: LAZY
```

### Fields

#### Syntax

```yaml
fields:
  - name: fieldName          # Field name (camelCase) - REQUIRED
    type: String             # Java data type - REQUIRED
```

**Supported properties:**
- `name`: Field name (required)
- `type`: Java data type (required)

#### Automatic Type Detection

eva4j automatically detects field types based **only** on `type`:

**✅ Value Objects** - Automatically detected
```yaml
fields:
  - name: totalAmount
    type: Money        # If Money is in valueObjects → automatic @Embedded
```

**✅ Enums** - Automatically detected
```yaml
fields:
  - name: status
    type: OrderStatus  # If OrderStatus is in enums → @Enumerated(STRING)
```

**✅ Primitive types**
```yaml
fields:
  - name: name
    type: String       # → VARCHAR
  - name: age
    type: Integer      # → INTEGER
  - name: price
    type: BigDecimal   # → DECIMAL
```

**✅ Date types** - Automatically imported
```yaml
fields:
  - name: createdAt
    type: LocalDateTime  # → timestamp + import java.time.LocalDateTime
```

**✅ Collections** - Automatic @ElementCollection
```yaml
fields:
  - name: tags
    type: List<String>   # → @ElementCollection with secondary table
```

#### ❌ NO need to specify

eva4j automatically generates the correct JPA annotations:
- `@Embedded` for Value Objects
- `@Enumerated(EnumType.STRING)` for Enums
- `@ElementCollection` for lists
- Required imports

#### ⚠️ MANDATORY RULE: `id` Field

**All entities MUST have a field named exactly `id`.**

```yaml
# ✅ CORRECT - All entities have 'id'
entities:
  - name: order
    isRoot: true
    fields:
      - name: id          # ← REQUIRED
        type: String      # String = UUID, Long = IDENTITY
      - name: orderNumber
        type: String
  
  - name: orderItem
    fields:
      - name: id          # ← REQUIRED also in secondary entities
        type: Long
      - name: productId
        type: String
```

**Reasons:**
- ✅ JPA requires `@Id` in all entities
- ✅ Eva4j automatically generates `@Id` and `@GeneratedValue` for the `id` field
- ✅ Clear and consistent convention across the domain

**Supported types for `id`:**
- `String` → Generates `@GeneratedValue(strategy = GenerationType.UUID)`
- `Long` → Generates `@GeneratedValue(strategy = GenerationType.IDENTITY)`

**❌ INCORRECT:**
```yaml
# ❌ Without 'id' field - Application will fail
fields:
  - name: orderNumber
    type: String
  # ← Missing 'id' field

# ❌ Different name - Won't work
fields:
  - name: orderId     # ← Must be named exactly 'id'
    type: String
```

**💡 Business Identifiers:**

If you need a business identifier in addition to the technical ID:

```yaml
fields:
  - name: id              # ← Technical ID (required)
    type: String
  - name: orderNumber     # ← Business ID (optional)
    type: String
  - name: invoiceNumber   # ← Another business identifier
    type: String
```

---

#### Correct Examples

```yaml
# Value Object
fields:
  - name: totalAmount
    type: Money              # ✅ Sufficient - eva4j automatically detects

# Enum
fields:
  - name: status
    type: OrderStatus        # ✅ Sufficient - eva4j automatically detects

# Primitive type
fields:
  - name: description
    type: String             # ✅ Basic type

# Collection
fields:
  - name: tags
    type: List<String>       # ✅ Automatic @ElementCollection
```

---

### Automatic Auditing

eva4j supports automatic entity auditing using the `auditable` property. When set to `true`, the entity will automatically include creation and modification date fields.

#### Syntax

```yaml
entities:
  - name: order
    isRoot: true
    auditable: true  # ← Activates automatic auditing
    fields:
      - name: orderNumber
        type: String
```

#### What `auditable: true` Generates

**In the domain entity (`Order.java`):**
```java
public class Order {
    private String orderNumber;
    private LocalDateTime createdAt;   // ← Automatically added
    private LocalDateTime updatedAt;   // ← Automatically added
    
    // getters/setters automatically generated
}
```

**In the JPA entity (`OrderJpa.java`):**
```java
@Entity
@Table(name = "orders")
public class OrderJpa extends AuditableEntity {  // ← Extends base class
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String orderNumber;
    
    // createdAt/updatedAt fields inherited from AuditableEntity
}
```

**Generated base class (`AuditableEntity.java`):**
```java
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class AuditableEntity {
    
    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
    
    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
    
    // getters/setters
}
```

#### Features

✅ **Fully automatic**: Timestamps update without additional code  
✅ **Entity level**: Can be enabled for specific entities  
✅ **Spring Data JPA**: Uses `@CreatedDate` and `@LastModifiedDate`  
✅ **Mapper included**: Audit fields are automatically mapped between domain and JPA  

#### Required Configuration

The Spring Boot application already has JPA auditing enabled in the main class:

```java
@SpringBootApplication
@EnableJpaAuditing  // ← Already configured by eva4j
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

#### Complete Example

```yaml
aggregates:
  - name: Product
    entities:
      - name: product
        isRoot: true
        auditable: true  # ← Enables auditing
        fields:
          - name: productId
            type: String
          - name: name
            type: String
          - name: price
            type: BigDecimal
          # createdAt and updatedAt are automatically added
      
      - name: review
        auditable: true  # ← Secondary entities can also have auditing
        fields:
          - name: reviewId
            type: Long
          - name: comment
            type: String
        relationships:
          - type: ManyToOne
            target: product
            fetch: LAZY
            joinColumn: product_id
```

**Resultado en la tabla:**
```sql
CREATE TABLE products (
    product_id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255),
    price DECIMAL(19,2),
    created_at TIMESTAMP NOT NULL,  -- ← Automático
    updated_at TIMESTAMP NOT NULL   -- ← Automático
);

CREATE TABLE reviews (
    review_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    comment TEXT,
    product_id VARCHAR(36),
    created_at TIMESTAMP NOT NULL,  -- ← Automático
    updated_at TIMESTAMP NOT NULL,  -- ← Automático
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);
```

#### Notas importantes

- ✅ `auditable` es **opcional** - por defecto es `false`
- ✅ Puede usarse en **entidad raíz** o **entidades secundarias**
- ✅ Los campos `createdAt` y `updatedAt` **no deben** definirse manualmente en `fields`
- ✅ El tipo es siempre `LocalDateTime`
- ❌ **No incluye** auditoría de usuario (createdBy/updatedBy) - ver [FUTURE_FEATURES.md](FUTURE_FEATURES.md) para esa funcionalidad

---

## Value Objects

Los Value Objects son objetos inmutables que representan conceptos del dominio sin identidad propia.

### Definición básica

```yaml
valueObjects:
  - name: Money
    fields:
      - name: amount
        type: BigDecimal
      
      - name: currency
        type: String
```

### Generated Value Object (Domain)

```java
public class Money {
    private final BigDecimal amount;
    private final String currency;
    
    public Money(BigDecimal amount, String currency) {
        this.amount = amount;
        this.currency = currency;
    }
    
    // Getters
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    
    // equals() and hashCode() based on all fields
}
```

### Value Object JPA (@Embeddable)

```java
@Embeddable
public class MoneyJpa {
    private BigDecimal amount;
    private String currency;
    
    // Constructor, getters, setters (Lombok)
}
```

### Usage in Entities

```yaml
fields:
  - name: totalAmount
    type: Money        # Automatically detected as VO
```

Generates in JPA:
```java
@Embedded
private MoneyJpa totalAmount;
```

### Example: Complex Value Object

```yaml
valueObjects:
  - name: Address
    fields:
      - name: street
        type: String
      
      - name: city
        type: String
      
      - name: state
        type: String
      
      - name: zipCode
        type: String
      
      - name: country
        type: String
```

---

## Enums

### Definition

```yaml
enums:
  - name: OrderStatus
    values:
      - PENDING
      - CONFIRMED
      - SHIPPED
      - DELIVERED
      - CANCELLED
```

### Generated Enum

```java
package com.example.myapp.order.domain.models.enums;

public enum OrderStatus {
    PENDING,
    CONFIRMED,
    SHIPPED,
    DELIVERED,
    CANCELLED
}
```

### Uso en entidades

```yaml
fields:
  - name: status
    type: OrderStatus  # Se detecta y se importa automáticamente
```

Genera en JPA:
```java
@Enumerated(EnumType.STRING)
private OrderStatus status;
```

### Múltiples enums

```yaml
enums:
  - name: OrderStatus
    values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]
  
  - name: PaymentMethod
    values: [CREDIT_CARD, DEBIT_CARD, CASH, BANK_TRANSFER]
  
  - name: ShippingMethod
    values: [STANDARD, EXPRESS, OVERNIGHT]
```

---

## Relaciones

eva4j soporta relaciones JPA bidireccionales completas con generación automática del lado inverso.

### 🎯 Relaciones Bidireccionales Automáticas

**Característica clave**: Cuando defines una relación OneToMany con `mappedBy`, eva4j genera AUTOMÁTICAMENTE la relación inversa ManyToOne en la entidad target.

**Solo necesitas definir UN lado:**

```yaml
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order          # ← eva4j crea automáticamente ManyToOne en OrderItem
        cascade: [PERSIST, MERGE]
        fetch: LAZY
```

**eva4j genera automáticamente en OrderItem:**

```java
// OrderItemJpa.java (automatically generated)
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "order_id")
private OrderJpa order;
```

**Ventajas:**
- ✅ No necesitas definir ambos lados manualmente
- ✅ Evita inconsistencias entre relaciones
- ✅ JPA persiste correctamente la relación bidireccional
- ✅ Menos código YAML, misma funcionalidad

**Nota**: Si defines manualmente ambos lados en el YAML, la definición manual tiene prioridad sobre la autogeneración.

---

### OneToMany (Uno a Muchos)

**Definición en la entidad que tiene la colección:**

```yaml
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem        # Entidad relacionada
        mappedBy: order          # Campo en OrderItem que apunta a Order
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY
```

**Genera en dominio:**
```java
private List<OrderItem> orderItems = new ArrayList<>();

public void addOrderItem(OrderItem orderItem) {
    this.orderItems.add(orderItem);
}

public void removeOrderItem(OrderItem orderItem) {
    this.orderItems.remove(orderItem);
}
```

**Genera en JPA:**
```java
@OneToMany(mappedBy = "order", cascade = {CascadeType.PERSIST, CascadeType.MERGE, CascadeType.REMOVE}, fetch = FetchType.LAZY)
@Builder.Default
private List<OrderItemJpa> orderItems = new ArrayList<>();
```

**Genera automáticamente en OrderItem (lado inverso):**
```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "order_id")  // Inferido desde mappedBy
private OrderJpa order;
```

### ManyToOne (Muchos a Uno)

**Definición manual (opcional si ya usaste mappedBy en OneToMany):**

```yaml
entities:
  - name: orderItem
    # Sin isRoot = entidad secundaria
    relationships:
      - type: ManyToOne
        target: Order
        joinColumn: order_id   # Columna FK en la tabla
        fetch: LAZY
```

**Genera en JPA:**
```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "order_id")
private OrderJpa order;
```

**💡 Tip**: Si ya definiste `OneToMany` con `mappedBy` en Order, NO necesitas definir manualmente el `ManyToOne` en OrderItem. eva4j lo genera automáticamente.

---

### ⚠️ REGLA CRÍTICA: Relaciones Bidireccionales

**Para relaciones bidireccionales OneToMany/ManyToOne:**

#### ✅ CORRECTO - Solo definir en la entidad raíz

```yaml
entities:
  - name: invoice
    isRoot: true
    relationships:
      - type: OneToMany
        target: InvoiceItem
        mappedBy: invoice      # ← Solo esta definición
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY
  
  - name: invoiceItem
    fields:
      - name: id
        type: Long
    # ← SIN relationships definidas
    # Eva4j genera automáticamente el ManyToOne en InvoiceItemJpa
```

**Resultado generado:**
```java
// InvoiceJpa.java
@OneToMany(mappedBy = "invoice", cascade = {...})
private List<InvoiceItemJpa> invoiceItems;

// InvoiceItemJpa.java (automatically generated)
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "invoice_id")
private InvoiceJpa invoice;
```

#### ❌ INCORRECTO - Definir en ambos lados

```yaml
entities:
  - name: invoice
    isRoot: true
    relationships:
      - type: OneToMany
        target: InvoiceItem
        mappedBy: invoice      # ← Primera definición
  
  - name: invoiceItem
    relationships:
      - type: ManyToOne        # ← ❌ DUPLICADO - Causará error
        target: Invoice
        joinColumn: invoice_id
```

**Problema:** Genera DOS relaciones `@ManyToOne` en `InvoiceItemJpa`, ambas mapeando a `invoice_id`:

```java
// InvoiceItemJpa.java (INCORRECTO - Duplicado)
@ManyToOne
@JoinColumn(name = "invoice_id")
private InvoiceJpa invoice;   // ← Del mappedBy

@ManyToOne
@JoinColumn(name = "invoice_id")
private InvoiceJpa invoices;  // ← Del ManyToOne explícito

// Error de Hibernate:
// "Column 'invoice_id' is duplicated in mapping"
```

#### 📋 Regla de Oro

| Escenario | Definir en Raíz | Definir en Secundaria | Eva4j Genera |
|-----------|-----------------|----------------------|-------------|
| **Bidireccional** | `OneToMany` con `mappedBy` | ❌ NADA | `@OneToMany` en raíz + `@ManyToOne` en JPA de secundaria |
| **Unidireccional** | Opcional | `ManyToOne` con `joinColumn` | Solo lo definido |

#### 💡 Separación Dominio/Persistencia

**Importante:** Eva4j sigue correctamente DDD:

- **Capa de Dominio:** Las entidades secundarias NO tienen referencia a la raíz
  ```java
  // InvoiceItem.java (dominio puro)
  public class InvoiceItem {
      private Long id;
      private String description;
      // ← SIN private Invoice invoice
  }
  ```

- **Capa de Persistencia (JPA):** Solo aquí existe la relación
  ```java
  // InvoiceItemJpa.java (persistencia)
  public class InvoiceItemJpa {
      private Long id;
      
      @ManyToOne
      @JoinColumn(name = "invoice_id")
      private InvoiceJpa invoice;  // ← Solo en capa JPA
  }
  ```

**Ventajas:**
- ✅ Sin dependencias circulares en dominio
- ✅ Modelo de dominio más simple
- ✅ Relación bidireccional solo donde se necesita (persistencia)
- ✅ Cumple principios de DDD y arquitectura hexagonal

---

### OneToOne (Uno a Uno)

**Bidireccional con mappedBy:**

```yaml
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToOne
        target: OrderSummary
        mappedBy: order
        cascade: [PERSIST, MERGE]
        fetch: LAZY
```

**Sin mappedBy (owner):**

```yaml
entities:
  - name: orderSummary
    relationships:
      - type: OneToOne
        target: Order
        joinColumn: order_id
        fetch: LAZY
```

### Relationship Options

| Option | Values | Description |
|--------|--------|-------------|
| `type` | OneToMany, ManyToOne, OneToOne, ManyToMany | Relationship type |
| `target` | EntityName | Related entity |
| `mappedBy` | fieldName | For the inverse side of the relationship |
| `joinColumn` | column_name | FK column name |
| `cascade` | [PERSIST, MERGE, REMOVE, REFRESH, DETACH, ALL] | Cascade operations |
| `fetch` | LAZY, EAGER | Loading strategy |

---

### 🔥 Cascade Options (Cascade Operations)

The `cascade` options determine which operations on the parent are automatically propagated to related entities.

#### **⚠️ IMPORTANT: Cascade and Persistence**

If you DON'T define `cascade`, related entities will **NOT be persisted automatically**. This is the most common error:

```yaml
# ❌ BAD - OrderItems will NOT be saved in DB
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: []        # ← Empty array = no cascade
    fetch: LAZY

# ✅ GOOD - OrderItems are saved automatically with Order
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE, REMOVE]  # ← Required to persist
    fetch: LAZY
```

#### **Cascade Options:**

| Option | Description | When to use? |
|--------|-------------|--------------|
| `PERSIST` | When saving the parent, saves new children | ✅ **Always in OneToMany** to create items |
| `MERGE` | When updating the parent, updates children | ✅ **Always in OneToMany** to edit items |
| `REMOVE` | When deleting the parent, deletes children | ✅ If children don't make sense without the parent |
| `REFRESH` | When refreshing the parent, refreshes children | ⚠️ Rarely needed |
| `DETACH` | When detaching the parent, detaches children | ⚠️ Rarely needed |
| `ALL` | All of the above operations | ⚠️ Only if you're sure |

#### **Recommended Configurations:**

```yaml
# 🎯 RECOMMENDED for OneToMany (Order → OrderItem)
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE, REMOVE]  # ← Creates, updates and deletes items
    fetch: LAZY

# 🎯 RECOMMENDED for entities with independent lifecycle
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]  # ← Without REMOVE, items persist
    fetch: LAZY

# ⚠️ CAREFUL with ALL - includes REMOVE
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [ALL]  # ← Deleting Order removes all OrderItems
    fetch: LAZY

# ❌ AVOID empty array if you want to persist children
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: []  # ← Requires manually saving OrderItem
    fetch: LAZY
```

#### **What happens without Cascade?**

```yaml
# Without cascade: [PERSIST]
cascade: []

# Behavior:
order.addOrderItem(item);
repository.save(order);  // ❌ Order is saved, OrderItem is NOT
```

```yaml
# With cascade: [PERSIST, MERGE]
cascade: [PERSIST, MERGE]

# Behavior:
order.addOrderItem(item);
repository.save(order);  // ✅ Order and OrderItem are saved automatically
```

---

### 🚀 Fetch Options (Loading Strategy)

The `fetch` options determine WHEN related entities are loaded from the database.

#### **Fetch Options:**

| Option | Description | Behavior | When to use? |
|--------|-------------|----------|--------------|
| `LAZY` | Load on demand (when accessed) | Only fetches parent initially | ✅ **Recommended by default** |
| `EAGER` | Immediate load (always) | Fetches parent + children in same query | ⚠️ Only if you ALWAYS need children |

#### **LAZY Example (Recommended):**

```yaml
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY  # ← Loads items only when accessed
```

**Generated SQL:**
```sql
-- First query: Only fetches Order
SELECT * FROM orders WHERE id = ?

-- Second query: Only if you access order.getOrderItems()
SELECT * FROM order_items WHERE order_id = ?
```

**✅ Advantages:**
- Better initial performance
- Only loads what you need
- Avoids loading unnecessary data

**⚠️ Disadvantage:**
- Can cause N+1 queries if you don't use `JOIN FETCH`

#### **Ejemplo EAGER (Usar con cuidado):**

```yaml
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: EAGER  # ← Always loads items with Order
```

**Generated SQL:**
```sql
-- Single query: Fetches Order + OrderItems
SELECT o.*, i.* 
FROM orders o 
LEFT JOIN order_items i ON i.order_id = o.id
WHERE o.id = ?
```

**✅ Advantage:**
- Single SQL query
- Data available immediately

**❌ Disadvantages:**
- Loads data even if unused
- Heavier queries
- Can cause performance issues

#### **Recommended Configurations by Type:**

```yaml
# OneToMany: ALWAYS LAZY
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY  # ← Avoids loading all items always

# ManyToOne: LAZY by default, EAGER only if always needed
relationships:
  - type: ManyToOne
    target: Customer
    joinColumn: customer_id
    fetch: LAZY  # ← LAZY by default

# OneToOne: LAZY if optional, EAGER if always exists
relationships:
  - type: OneToOne
    target: OrderSummary
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY  # ← LAZY if not always used
```

#### **N+1 Problem and how to solve it:**

**Problem:**
```java
// With LAZY fetch
List<Order> orders = orderRepository.findAll();  // 1 query
orders.forEach(order -> {
    order.getOrderItems().forEach(item -> {      // N queries (one per Order)
        System.out.println(item.getProductName());
    });
});
// Total: 1 + N queries = N+1 problem
```

**Solution - Use JOIN FETCH in queries:**
```java
@Query("SELECT o FROM OrderJpa o LEFT JOIN FETCH o.orderItems WHERE o.id = :id")
OrderJpa findByIdWithItems(@Param("id") String id);
```

---

### When to manually define inverse relationships?

#### ❌ You DON'T need to define ManyToOne if:

You already defined `OneToMany` with `mappedBy` on the "parent" side. eva4j automatically generates the inverse relationship.

**Example - Only define OneToMany:**

```yaml
# ✅ SUFFICIENT: Only define this in Order
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order          # ← eva4j generates ManyToOne automatically
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY

# ❌ DON'T NEED this in OrderItem (generated automatically)
#   - name: orderItem
#     relationships:
#       - type: ManyToOne
#         target: Order
#         joinColumn: order_id
#         fetch: LAZY
```

**Result:** Complete bidirectional relationship with FK `order_id` generated automatically.

**✅ Advantages:**
- Less YAML code (only define one side)
- No duplication or inconsistencies
- Works the same as defining both sides
- FK inferred automatically: `{mappedBy}_id`

---

#### ✅ You SHOULD define ManyToOne manually if:

##### 1. **You need a specific FK column name**

```yaml
# Define both sides to control FK name
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order
        cascade: [PERSIST, MERGE]
        fetch: LAZY
  
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Order
        joinColumn: fk_pedido_uuid    # ← Custom name
        fetch: LAZY
```

**When to use:**
- Your DB has specific conventions (`fk_*`, prefixes, etc.)
- Need to maintain compatibility with existing schema
- Migration from another tool/framework

---

##### 2. **Multiple FKs to the same entity**

```yaml
# Transaction has 'from' and 'to' Account
entities:
  - name: transaction
    tableName: transactions
    
    fields:
      - name: id
        type: String
      - name: amount
        type: BigDecimal
    
    relationships:
      # First relationship
      - type: ManyToOne
        target: Account
        joinColumn: from_account_id    # ← Explicit name required
        fetch: LAZY
      
      # Second relationship to same entity
      - type: ManyToOne
        target: Account
        joinColumn: to_account_id      # ← Different FK name
        fetch: LAZY
```

**When to use:**
- Self-relationships (category tree, org chart)
- Multiple relationships to same type (from/to, parent/child)
- Can't use `mappedBy` (which one would it be?)

---

##### 3. **Unidirectional relationship (no inverse side)**

```yaml
# OrderItem needs Product, but Product DOESN'T need OrderItems
entities:
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Product         # Product has NO List<OrderItem>
        joinColumn: product_id
        fetch: LAZY
  
  # In Product DON'T define OneToMany
  - name: product
    isRoot: true
    fields:
      - name: id
        type: String
      - name: name
        type: String
    # No relationships to OrderItem
```

**When to use:**
- Performance: avoid loading unnecessary collections
- Product is not part of Order aggregate
- Only need navigation in one direction

---

#### 📊 Quick Comparison

| Scenario | Define ManyToOne? | Why? |
|----------|-------------------|------|
| Standard relationship with `mappedBy` | ❌ No | eva4j generates it automatically |
| FK with custom name | ✅ Yes | To control `joinColumn` |
| Multiple FKs to same entity | ✅ Yes | Need explicit names |
| Unidirectional relationship | ✅ Yes | No inverse side (`mappedBy`) |
| Specific DB conventions | ✅ Yes | To comply with standards |
| Simple standard case | ❌ No | Let eva4j generate it |

---

#### ⚠️ Error Común

**NO hagas esto:**

```yaml
# ❌ INCORRECTO: Inconsistencia entre ambos lados
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order         # ← Espera campo "order" en OrderItem
        fetch: LAZY
  
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Order
        joinColumn: pedido_id  # ← Pero la FK se llama diferente
        fetch: LAZY
```

**Problema:** `mappedBy: order` busca un campo llamado `order`, pero `pedido_id` no coincide con la convención de nombres.

**✅ Soluciones:**

**Opción A - Deja que eva4j genere automáticamente:**
```yaml
# Solo define OneToMany, eva4j genera ManyToOne correctamente
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order
        fetch: LAZY
```

**Opción B - Define ambos lados consistentemente:**
```yaml
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: pedido        # ← Coincide con el nombre del campo
        fetch: LAZY
  
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Order
        joinColumn: pedido_id
        fetch: LAZY
```

---

#### 💡 Recomendación General

**Para el 90% de los casos:**

```yaml
# ✅ MEJOR PRÁCTICA: Solo define OneToMany
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY

# NO definas ManyToOne en OrderItem
# eva4j lo genera automáticamente con:
# - @JoinColumn(name = "order_id")
# - @ManyToOne(fetch = FetchType.LAZY)
```

**Solo define ambos lados cuando necesites control específico.**

---

## Tipos de Datos

### Tipos primitivos Java

| YAML | Java | JPA | Observaciones |
|------|------|-----|---------------|
| `String` | String | VARCHAR | En ID genera UUID |
| `Integer` | Integer | INTEGER | En ID genera IDENTITY |
| `Long` | Long | BIGINT | En ID genera IDENTITY |
| `Double` | Double | DOUBLE | - |
| `Float` | Float | FLOAT | - |
| `Boolean` | Boolean | BOOLEAN | - |
| `BigDecimal` | BigDecimal | DECIMAL | Importa automáticamente |

### Tipos de fecha/hora

| YAML | Java | Importa automáticamente |
|------|------|------------------------|
| `LocalDate` | LocalDate | java.time.LocalDate |
| `LocalDateTime` | LocalDateTime | java.time.LocalDateTime |
| `LocalTime` | LocalTime | java.time.LocalTime |

### Tipos especiales

| YAML | Java | Uso |
|------|------|-----|
| `UUID` | UUID | IDs únicos |
| Cualquier Enum | Enum personalizado | Estados, tipos |
| Cualquier VO | Value Object | Conceptos de dominio |

### Colecciones

#### Lista de primitivos

```yaml
fields:
  - name: tags
    type: List<String>
```

Genera:
```java
@ElementCollection
@CollectionTable(name = "order_tags", joinColumns = @JoinColumn(name = "order_id"))
@Column(name = "tags")
@Builder.Default
private List<String> tags = new ArrayList<>();
```

#### Lista de Value Objects

```yaml
fields:
  - name: addresses
    type: List<Address>  # Address es un VO definido
```

Genera:
```java
@ElementCollection
@CollectionTable(name = "customer_addresses", joinColumns = @JoinColumn(name = "customer_id"))
@Builder.Default
private List<AddressJpa> addresses = new ArrayList<>();
```

---

## Ejemplos Completos

### Ejemplo 1: E-Commerce (Order)

```yaml
aggregates:
  - name: Order
    entities:
      - name: order
        isRoot: true
        tableName: orders
        
        fields:
          - name: id
            type: String
          
          - name: orderNumber
            type: String
          
          - name: customerId
            type: String
          
          - name: status
            type: OrderStatus
          
          - name: totalAmount
            type: Money
          
          - name: shippingAddress
            type: Address
          
          - name: createdAt
            type: LocalDateTime
          
          - name: updatedAt
            type: LocalDateTime
        
        relationships:
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY
      
      - name: orderItem
        tableName: order_items
        
        fields:
          - name: id
            type: Long
          
          - name: productId
            type: String
          
          - name: productName
            type: String
          
          - name: quantity
            type: Integer
          
          - name: unitPrice
            type: Money
          
          - name: subtotal
            type: Money
        
        relationships:
          - type: ManyToOne
            target: Order
            joinColumn: order_id
            fetch: LAZY
    
    valueObjects:
      - name: Money
        fields:
          - name: amount
            type: BigDecimal
          - name: currency
            type: String
      
      - name: Address
        fields:
          - name: street
            type: String
          - name: city
            type: String
          - name: state
            type: String
          - name: zipCode
            type: String
          - name: country
            type: String
    
    enums:
      - name: OrderStatus
        values:
          - PENDING
          - CONFIRMED
          - PROCESSING
          - SHIPPED
          - DELIVERED
          - CANCELLED
          - REFUNDED
```

### Ejemplo 2: Blog (Post)

```yaml
aggregates:
  - name: Post
    entities:
      - name: post
        isRoot: true
        tableName: posts
        
        fields:
          - name: id
            type: Long
          
          - name: title
            type: String
          
          - name: slug
            type: String
          
          - name: content
            type: String
          
          - name: authorId
            type: String
          
          - name: status
            type: PostStatus
          
          - name: publishedAt
            type: LocalDateTime
          
          - name: tags
            type: List<String>
          
          - name: metadata
            type: PostMetadata
        
        relationships:
          - type: OneToMany
            target: Comment
            mappedBy: post
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY
      
      - name: comment
        tableName: comments
        
        fields:
          - name: id
            type: Long
          
          - name: authorId
            type: String
          
          - name: authorName
            type: String
          
          - name: content
            type: String
          
          - name: createdAt
            type: LocalDateTime
          
          - name: approved
            type: Boolean
        
        relationships:
          - type: ManyToOne
            target: Post
            joinColumn: post_id
            fetch: LAZY
    
    valueObjects:
      - name: PostMetadata
        fields:
          - name: viewCount
            type: Integer
          - name: likeCount
            type: Integer
          - name: shareCount
            type: Integer
    
    enums:
      - name: PostStatus
        values: [DRAFT, PUBLISHED, ARCHIVED, DELETED]
```

### Ejemplo 3: Banking (Account)

```yaml
aggregates:
  - name: Account
    entities:
      - name: account
        isRoot: true
        tableName: accounts
        
        fields:
          - name: id
            type: String
          
          - name: accountNumber
            type: String
          
          - name: customerId
            type: String
          
          - name: accountType
            type: AccountType
          
          - name: balance
            type: Money
          
          - name: status
            type: AccountStatus
          
          - name: openedAt
            type: LocalDate
        
        relationships:
          - type: OneToMany
            target: Transaction
            mappedBy: account
            cascade: [PERSIST, MERGE]
            fetch: LAZY
      
      - name: transaction
        tableName: transactions
        
        fields:
          - name: id
            type: String
          
          - name: transactionNumber
            type: String
          
          - name: type
            type: TransactionType
          
          - name: amount
            type: Money
          
          - name: description
            type: String
          
          - name: timestamp
            type: LocalDateTime
          
          - name: balanceAfter
            type: Money
        
        relationships:
          - type: ManyToOne
            target: Account
            joinColumn: account_id
            fetch: LAZY
    
    valueObjects:
      - name: Money
        fields:
          - name: amount
            type: BigDecimal
          - name: currency
            type: String
    
    enums:
      - name: AccountType
        values: [CHECKING, SAVINGS, INVESTMENT, CREDIT]
      
      - name: AccountStatus
        values: [ACTIVE, INACTIVE, SUSPENDED, CLOSED]
      
      - name: TransactionType
        values: [DEPOSIT, WITHDRAWAL, TRANSFER, FEE, INTEREST]
```

### Ejemplo 4: Múltiples Agregados en un módulo

```yaml
aggregates:
  - name: Customer
    entities:
      - name: customer
        isRoot: true
        fields:
          - name: id
            type: String
          - name: name
            type: String
          - name: email
            type: String
          - name: phone
            type: String
          - name: registeredAt
            type: LocalDateTime
    
    valueObjects:
      - name: ContactInfo
        fields:
          - name: email
            type: String
          - name: phone
            type: String
  
  - name: Product
    entities:
      - name: product
        isRoot: true
        fields:
          - name: id
            type: String
          - name: name
            type: String
          - name: description
            type: String
          - name: price
            type: Money
          - name: stock
            type: Integer
          - name: category
            type: ProductCategory
    
    valueObjects:
      - name: Money
        fields:
          - name: amount
            type: BigDecimal
          - name: currency
            type: String
    
    enums:
      - name: ProductCategory
        values: [ELECTRONICS, CLOTHING, FOOD, BOOKS, TOYS]
```

---

## Comando de Generación

```bash
# Generar todas las entidades del módulo
eva4j generate entities <module-name>
```

### Salida generada

```
✓ Found 1 aggregate(s) and 1 enum(s)

📦 Aggregates to generate:
  ├── Order (Root: Order)
  │   ├── OrderItem
  │   └── Money (VO)

⠋ Generating files...

✅ Successfully generated 13 files for module 'order'

📁 Generated Files:
  ✓ Enum: OrderStatus
  ✓ Domain Entity: Order
  ✓ JPA Entity: OrderJpa
  ✓ Domain Entity: OrderItem
  ✓ JPA Entity: OrderItemJpa
  ✓ Domain VO: Money
  ✓ JPA VO: MoneyJpa
  ✓ Mapper: OrderMapper
  ✓ Repository: OrderRepository
  ✓ JPA Repository: OrderJpaRepository
  ✓ Repository Impl: OrderRepositoryImpl
```

---

## Tips y Mejores Prácticas

### ✅ Hacer

1. **Usa nombres descriptivos**: `orderNumber` en lugar de `number`
2. **PascalCase para tipos**: `OrderStatus`, `Money`, `Address`
3. **camelCase para campos**: `totalAmount`, `createdAt`
4. **snake_case para tablas**: `order_items`, `customer_addresses`
5. **Define IDs apropiados**: String para UUIDs, Long para secuencias
6. **Usa Value Objects**: Para conceptos cohesivos (Money, Address)
7. **Cascade apropiado**: PERSIST, MERGE para agregados; evita ALL

### ❌ Evitar

1. **Don't use Long for UUIDs**: Use String
2. **Don't create bidirectional relationships without mappedBy**: Define the owner
3. **Don't use EAGER without reason**: LAZY is better for performance
4. **Don't mix concepts**: One aggregate = one transaction
5. **Don't use @Column in domain.yaml**: It's for JPA, generated automatically

---

## Current Support and Limitations

### ✅ Supported

- Aggregates with root and secondary entities
- Embedded Value Objects
- Enums with values
- OneToMany, ManyToOne, OneToOne relationships
- Java primitive and date types
- Collections of primitives and VOs
- IDs: String (UUID), Long/Integer (IDENTITY)
- Custom Cascade and Fetch

### 🚧 Coming Soon

- JSR-303 validations
- Automatic auditing
- Soft delete
- Custom query methods
- Indexes and constraints
- Entity inheritance

---

## Frequently Asked Questions

**Q: Can I have multiple aggregates in one domain.yaml?**  
A: Yes, define multiple entries in the `aggregates` array.

**Q: How do I reference an enum from another aggregate?**  
A: Enums are global to the module, just use the name: `type: OrderStatus`

**Q: Can I use a VO in multiple aggregates?**  
A: Yes, but you must define it in each aggregate (for now).

**Q: What happens if I regenerate the code?**  
A: Files are overwritten. Modify only in templates, not in generated code.

**Q: Can I customize generated entities?**  
A: Yes, modify the templates in `templates/aggregate/`.

---

## Additional Resources

- [Implementation Guide](IMPLEMENTATION_SUMMARY.md)
- [Testing Guide](TESTING_GUIDE.md)
- [Quick Reference](QUICK_REFERENCE.md)
- [DDD Documentation](https://martinfowler.com/bliki/DomainDrivenDesign.html)

---

**Ready to start?** Create your `domain.yaml` and run:

```bash
eva4j generate entities <your-module>
```
