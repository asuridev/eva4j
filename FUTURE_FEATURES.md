# Características Futuras - eva4j

Este documento describe las mejoras planificadas para futuras versiones de eva4j, organizadas por prioridad. Cada sección incluye el contexto DDD correspondiente, la sintaxis YAML propuesta y ejemplos del código que se generaría.

---

## � Tabla de Contenidos

### � Alta Prioridad
- [Domain Events](#1-domain-events)
- [Aggregate Boundaries por ID](#2-aggregate-boundaries-por-id)
- [Soft Delete Completo](#3-soft-delete-completo)

### � Media Prioridad
- [Paginación en Queries](#4-paginación-en-queries)
- [Optimistic Locking](#5-optimistic-locking)
- [Read Models Separados](#6-read-models-separados-proyecciones)
- [Enums con Comportamiento y Transiciones](#7-enums-con-comportamiento-y-transiciones)
- [Políticas y Especificaciones](#8-políticas-y-especificaciones)

### � Tooling y Calidad
- [Validación de domain.yaml con JSON Schema](#9-validación-de-domainyaml-con-json-schema)
- [Generación Incremental / Diff](#10-generación-incremental--diff)
- [Comando eva4j doctor](#11-comando-eva4j-doctor)
- [Tests Generados Completos](#12-tests-generados-completos)

### ✅ Implementado
- [Auditoría de Tiempo y Usuario](#13-auditoría-implementada)
- [Validaciones JSR-303](#14-validaciones-jsr-303-implementado)

---

## � ALTA PRIORIDAD

---

## 1. Domain Events

### Descripción

Los **Domain Events** son el patrón más fundamental de DDD que actualmente falta en eva4j. Un evento de dominio representa algo significativo que ocurrió en el negocio — un hecho pasado, no una intención futura. Son esenciales para:

- Comunicar cambios entre agregados sin acoplamiento directo
- Disparar side effects (emails, notificaciones, actualizaciones de proyecciones)
- Construir sistemas eventualmente consistentes

Sin eventos de dominio, la comunicación entre agregados obliga a dependencias directas que violan los límites de los bounded contexts.

### Sintaxis Propuesta en domain.yaml

```yaml
aggregates:
  - name: Order
    entities:
      - name: order
        isRoot: true
        events:
          - name: OrderPlaced
            fields:
              - name: orderId
                type: String
              - name: customerId
                type: String
              - name: totalAmount
                type: BigDecimal
          - name: OrderCancelled
            fields:
              - name: orderId
                type: String
              - name: reason
                type: String
```

### Código Generado

#### Clase base DomainEvent

```java
// shared/domain/DomainEvent.java
public abstract class DomainEvent {
    private final String eventId;
    private final LocalDateTime occurredOn;
    private final String aggregateId;

    protected DomainEvent(String aggregateId) {
        this.eventId = UUID.randomUUID().toString();
        this.occurredOn = LocalDateTime.now();
        this.aggregateId = aggregateId;
    }

    public String getEventId() { return eventId; }
    public LocalDateTime getOccurredOn() { return occurredOn; }
    public String getAggregateId() { return aggregateId; }
}
```

#### Evento específico generado

```java
// domain/models/events/OrderPlacedEvent.java
public class OrderPlacedEvent extends DomainEvent {
    private final String customerId;
    private final BigDecimal totalAmount;

    public OrderPlacedEvent(String orderId, String customerId, BigDecimal totalAmount) {
        super(orderId);
        this.customerId = customerId;
        this.totalAmount = totalAmount;
    }

    public String getCustomerId() { return customerId; }
    public BigDecimal getTotalAmount() { return totalAmount; }
}
```

#### Raíz del agregado con eventos

```java
// domain/models/entities/Order.java
public class Order {
    private List<DomainEvent> domainEvents = new ArrayList<>();

    public List<DomainEvent> getDomainEvents() {
        return Collections.unmodifiableList(domainEvents);
    }

    public void clearDomainEvents() {
        domainEvents.clear();
    }

    public void place(String customerId, BigDecimal total) {
        this.status = OrderStatus.PLACED;
        domainEvents.add(new OrderPlacedEvent(this.id, customerId, total));
    }

    public void cancel(String reason) {
        if (this.status == OrderStatus.DELIVERED) {
            throw new IllegalStateException("Cannot cancel a delivered order");
        }
        this.status = OrderStatus.CANCELLED;
        domainEvents.add(new OrderCancelledEvent(this.id, reason));
    }
}
```

#### Publicación automática desde el repositorio

```java
@Override
public Order save(Order order) {
    OrderJpa jpa = mapper.toJpa(order);
    repository.save(jpa);
    order.getDomainEvents().forEach(eventPublisher::publishEvent);
    order.clearDomainEvents();
    return mapper.toDomain(jpa);
}
```

#### Listener en otro módulo (sin acoplamiento)

```java
@Component
public class OrderEventListener {
    @EventListener
    public void onOrderPlaced(OrderPlacedEvent event) {
        // enviar email de confirmación, actualizar inventario, etc.
    }

    @TransactionalEventListener(phase = AFTER_COMMIT)
    public void onOrderCancelled(OrderCancelledEvent event) {
        // proceso de reembolso, notificación al cliente
    }
}
```

---

## 2. Aggregate Boundaries por ID

### Descripción

En DDD, las referencias entre agregados distintos deben realizarse **por ID**, nunca con `@ManyToOne` cruzado. Hoy eva4j genera referencias JPA directas entre todos los agregados del mismo módulo, creando un único grafo de entidades JPA en vez de agregados independientes.

Esto impide escalar los agregados de forma independiente y crea dependencias de carga que violan los límites transaccionales.

### Sintaxis Propuesta

```yaml
aggregates:
  - name: Order
    entities:
      - name: order
        isRoot: true
        fields:
          - name: id
            type: String
          - name: customerId
            type: String
            reference:
              aggregate: Customer
              module: customers
          - name: productId
            type: String
            reference:
              aggregate: Product
              module: catalog
```

### Código Generado

```java
// domain/models/entities/Order.java
public class Order {
    private String id;
    private String customerId;  // Solo el ID, nunca Customer customer
    private String productId;
}
```

```java
public class GetOrderWithCustomerQueryHandler {
    private final OrderRepository orderRepository;
    private final CustomerServiceClient customerClient;

    public OrderWithCustomerDto handle(GetOrderWithCustomerQuery query) {
        Order order = orderRepository.findById(query.orderId()).orElseThrow();
        CustomerSummary customer = customerClient.findById(order.getCustomerId());
        return new OrderWithCustomerDto(order, customer);
    }
}
```

### Advertencia generada cuando se detecta cross-aggregate

```
⚠️  WARNING: Order.customer uses a direct JPA reference to Customer aggregate.
   Consider using customerId (reference by ID) instead.
```

---

## 3. Soft Delete Completo

### Descripción

El archivo de ejemplo `domain-soft-delete.yaml` existe pero la generación real del patrón no está completamente implementada. Soft delete es crítico en sistemas donde la normativa exige conservar registros históricos o donde el negocio necesita restaurar datos eliminados accidentalmente.

### Sintaxis en domain.yaml

```yaml
entities:
  - name: product
    isRoot: true
    tableName: products
    softDelete: true
    fields:
      - name: id
        type: String
      - name: name
        type: String
      - name: price
        type: BigDecimal
```

### Código Generado

```java
@MappedSuperclass
public abstract class SoftDeletableEntity {
    @Column(name = "deleted", nullable = false)
    private Boolean deleted = false;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    public void softDelete() {
        this.deleted = true;
        this.deletedAt = LocalDateTime.now();
    }

    public void restore() {
        this.deleted = false;
        this.deletedAt = null;
    }
}
```

```java
@Entity
@Table(name = "products")
@Where(clause = "deleted = false")
@SQLDelete(sql = "UPDATE products SET deleted = true, deleted_at = NOW() WHERE id = ?")
public class ProductJpa extends SoftDeletableEntity {
    @Id
    private String id;
}
```

```java
// DeleteCommandHandler actualizado
public void handle(DeleteProductCommand command) {
    Product product = productRepository.findById(command.id()).orElseThrow();
    product.softDelete();
    productRepository.save(product);
}
```

```java
// Endpoint de restauración generado automáticamente
@PatchMapping("/{id}/restore")
public ResponseEntity<Void> restore(@PathVariable String id) {
    restoreProductUseCase.handle(new RestoreProductCommand(id));
    return ResponseEntity.noContent().build();
}
```

---

## � MEDIA PRIORIDAD

---

## 4. Paginación en Queries

### Descripción

Actualmente `ListQueryHandler` devuelve `List<T>` completo sin límite. En producción, cualquier colección que pueda crecer sin límite debe estar paginada. Esto también implica soporte para filtros dinámicos y ordenamiento.

### Sintaxis Propuesta

```yaml
aggregates:
  - name: Order
    queries:
      - name: FindAllOrders
        paginated: true
        filters:
          - field: status
            type: OrderStatus
          - field: customerId
            type: String
        sort:
          defaultField: createdAt
          defaultDirection: DESC
```

### Código Generado

```java
public record FindAllOrdersQuery(
    OrderStatus status,
    String customerId,
    int page,
    int size,
    String sortBy,
    String sortDirection
) {}
```

```java
public Page<OrderResponseDto> handle(FindAllOrdersQuery query) {
    Pageable pageable = PageRequest.of(
        query.page(), query.size(),
        Sort.by(Sort.Direction.fromString(query.sortDirection()), query.sortBy())
    );
    Page<Order> orders = orderRepository.findAll(
        OrderSpecifications.build(query.status(), query.customerId()), pageable
    );
    return orders.map(mapper::toDto);
}
```

```java
public class OrderSpecifications {
    public static Specification<OrderJpa> build(OrderStatus status, String customerId) {
        return Specification
            .where(hasStatus(status))
            .and(hasCustomerId(customerId));
    }
    private static Specification<OrderJpa> hasStatus(OrderStatus status) {
        return (root, query, cb) ->
            status == null ? null : cb.equal(root.get("status"), status);
    }
    private static Specification<OrderJpa> hasCustomerId(String customerId) {
        return (root, query, cb) ->
            customerId == null ? null : cb.equal(root.get("customerId"), customerId);
    }
}
```

---

## 5. Optimistic Locking

### Descripción

El **Optimistic Locking** previene la pérdida de actualizaciones cuando dos usuarios modifican el mismo registro simultáneamente. Sin él, la última escritura gana sin advertencia, causando pérdida de datos silenciosa.

### Sintaxis Propuesta

```yaml
entities:
  - name: account
    isRoot: true
    audit:
      enabled: true
      optimisticLocking: true
    fields:
      - name: id
        type: String
      - name: balance
        type: BigDecimal
```

### Código Generado

```java
@Entity
public class AccountJpa extends AuditableEntity {
    @Id
    private String id;

    @Column(name = "balance")
    private BigDecimal balance;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;
}
```

```java
// El UpdateCommand incluye la versión esperada
public record UpdateAccountCommand(
    String id,
    BigDecimal newBalance,
    Long version    // Si no coincide con la BD: HTTP 409 Conflict
) {}
```

```java
// ControllerAdvice generado
@ExceptionHandler(ObjectOptimisticLockingFailureException.class)
public ResponseEntity<ErrorDto> handleOptimisticLock(ObjectOptimisticLockingFailureException ex) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(new ErrorDto("CONFLICT", "The record was modified by another user. Please reload and retry."));
}
```

---

## 6. Read Models Separados (Proyecciones)

### Descripción

En CQRS puro, el lado de lectura puede tener su propio modelo optimizado para consultas, independiente del modelo de escritura. Los `*ResponseDto` actuales son transformaciones directas del dominio, suficiente para casos simples pero insuficientes para reportes o vistas que joinean múltiples agregados.

### Sintaxis Propuesta

```yaml
aggregates:
  - name: Order
    readModels:
      - name: OrderSummary
        description: "Vista desnormalizada para listados"
        fields:
          - name: id
            type: String
          - name: orderNumber
            type: String
          - name: customerName
            type: String
          - name: totalAmount
            type: BigDecimal
          - name: itemCount
            type: Integer
          - name: status
            type: OrderStatus
        source: native_query
```

### Código Generado

```java
public interface OrderSummaryProjection {
    String getId();
    String getOrderNumber();
    String getCustomerName();
    BigDecimal getTotalAmount();
    Integer getItemCount();
    OrderStatus getStatus();
}
```

```java
@Query(value = """
    SELECT
        o.id,
        o.order_number     AS orderNumber,
        c.name             AS customerName,
        o.total_amount     AS totalAmount,
        COUNT(i.id)        AS itemCount,
        o.status
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN order_items i ON i.order_id = o.id
    WHERE o.deleted = false
    GROUP BY o.id, c.name
    """, nativeQuery = true)
Page<OrderSummaryProjection> findOrderSummaries(Pageable pageable);
```

---

## 7. Enums con Comportamiento y Transiciones

### Descripción

Los enums generados actualmente son solo listas de valores. En DDD, los enums frecuentemente encapsulan lógica de transición de estado — qué valores son válidos como siguiente estado, qué acciones se permiten. Esto elimina `if/switch` dispersos en el dominio.

### Sintaxis Propuesta

```yaml
enums:
  - name: OrderStatus
    withTransitions: true
    values:
      - DRAFT
      - PLACED
      - CONFIRMED
      - SHIPPED
      - DELIVERED
      - CANCELLED
    transitions:
      DRAFT:      [PLACED, CANCELLED]
      PLACED:     [CONFIRMED, CANCELLED]
      CONFIRMED:  [SHIPPED, CANCELLED]
      SHIPPED:    [DELIVERED]
      DELIVERED:  []
      CANCELLED:  []
```

### Código Generado

```java
public enum OrderStatus {
    DRAFT(Set.of("PLACED", "CANCELLED")),
    PLACED(Set.of("CONFIRMED", "CANCELLED")),
    CONFIRMED(Set.of("SHIPPED", "CANCELLED")),
    SHIPPED(Set.of("DELIVERED")),
    DELIVERED(Set.of()),
    CANCELLED(Set.of());

    private final Set<String> allowedTransitions;

    OrderStatus(Set<String> allowedTransitions) {
        this.allowedTransitions = allowedTransitions;
    }

    public boolean canTransitionTo(OrderStatus next) {
        return allowedTransitions.contains(next.name());
    }

    public void validateTransitionTo(OrderStatus next) {
        if (!canTransitionTo(next)) {
            throw new IllegalStateException(
                String.format("Cannot transition from %s to %s", this.name(), next.name())
            );
        }
    }
}
```

```java
// Uso en entidad de dominio — declarativo, sin if/switch
public void confirm() {
    this.status.validateTransitionTo(OrderStatus.CONFIRMED);
    this.status = OrderStatus.CONFIRMED;
}

public void ship() {
    this.status.validateTransitionTo(OrderStatus.SHIPPED);
    this.status = OrderStatus.SHIPPED;
}
```

---

## 8. Políticas y Especificaciones

### Descripción

El **Specification Pattern** encapsula reglas de negocio complejas como objetos combinables. Es especialmente útil cuando las mismas reglas se aplican en múltiples lugares: validación al crear, filtrado en queries, reportes. Actualmente eva4j no genera ninguna infraestructura para este patrón.

### Sintaxis Propuesta

```yaml
aggregates:
  - name: Order
    specifications:
      - name: OrderCanBeShipped
        description: "Una orden puede enviarse si está confirmada y tiene dirección de envío"
      - name: OrderIsOverdue
        description: "Una orden está vencida si lleva más de 30 días en estado PLACED"
```

### Código Generado

```java
public interface Specification<T> {
    boolean isSatisfiedBy(T candidate);

    default Specification<T> and(Specification<T> other) {
        return candidate -> this.isSatisfiedBy(candidate) && other.isSatisfiedBy(candidate);
    }

    default Specification<T> or(Specification<T> other) {
        return candidate -> this.isSatisfiedBy(candidate) || other.isSatisfiedBy(candidate);
    }

    default Specification<T> not() {
        return candidate -> !this.isSatisfiedBy(candidate);
    }
}
```

```java
@Component
public class OrderCanBeShippedSpecification implements Specification<Order> {
    @Override
    public boolean isSatisfiedBy(Order order) {
        return order.getStatus() == OrderStatus.CONFIRMED
            && order.getShippingAddress() != null;
    }
}
```

```java
@Component
public class ShipOrderCommandHandler {
    private final OrderCanBeShippedSpecification canBeShipped;

    public void handle(ShipOrderCommand command) {
        Order order = orderRepository.findById(command.orderId()).orElseThrow();
        if (!canBeShipped.isSatisfiedBy(order)) {
            throw new OrderCannotBeShippedException(command.orderId());
        }
        order.ship();
        orderRepository.save(order);
    }
}
```

---

## � TOOLING Y CALIDAD

---

## 9. Validación de domain.yaml con JSON Schema

### Descripción

Actualmente los errores en `domain.yaml` producen mensajes crípticos de Node.js en tiempo de ejecución. Un JSON Schema publicado permitiría validación inmediata en el editor (VS Code, IntelliJ) antes de ejecutar `eva4j g entities`, con autocompletado y documentación inline.

### Comportamiento Esperado

Con el schema configurado, el editor mostraría errores como:

```
domain.yaml:14:5  error  Property "tipe" is not allowed. Did you mean "type"?
domain.yaml:28:9  error  "audit.trackUser" requires "audit.enabled: true"
domain.yaml:41:7  error  Relationship type "OneToFew" is not valid.
                         Expected one of: OneToOne, OneToMany, ManyToOne, ManyToMany
```

### Implementación

```json
{
  "": "http://json-schema.org/draft-07/schema#",
  "title": "eva4j domain.yaml",
  "type": "object",
  "required": ["aggregates"],
  "properties": {
    "aggregates": {
      "type": "array",
      "items": {
        "required": ["name", "entities"],
        "properties": {
          "name": { "type": "string", "pattern": "^[A-Z][a-zA-Z0-9]*$" },
          "entities": { "type": "array" }
        },
        "additionalProperties": false
      }
    }
  }
}
```

```json
// .vscode/settings.json (generado por eva4j create)
{
  "yaml.schemas": {
    "https://eva4j.dev/schemas/domain-yaml.json": "domain.yaml"
  }
}
```

---

## 10. Generación Incremental / Diff

### Descripción

Actualmente `eva4j g entities` regenera **todos** los archivos, sobreescribiendo cualquier modificación manual. Este es el mayor bloqueador para adopción en proyectos reales donde el desarrollador personaliza la lógica generada.

### Estrategias Propuestas

#### Opción A: Archivos base + archivos de extensión

```
order/application/mappers/
├── OrderApplicationMapperBase.java    <- regenerado siempre
└── OrderApplicationMapper.java        <- creado una vez, el dev lo personaliza
```

```java
// OrderApplicationMapperBase.java — regenerado en cada g entities
public abstract class OrderApplicationMapperBase {
    public Order fromCommand(CreateOrderCommand command) { /* generado */ }
    public OrderResponseDto toDto(Order entity) { /* generado */ }
}

// OrderApplicationMapper.java — creado una sola vez
@Component
public class OrderApplicationMapper extends OrderApplicationMapperBase {
    // Override opcional de métodos base
    // Métodos adicionales del proyecto aquí
}
```

#### Opción B: Flag --safe en el CLI

```bash
# Regenera solo archivos que NO fueron modificados manualmente
eva4j g entities order --safe

# Output:
# OK  Order.java                       -- regenerado (sin cambios previos)
# OK  OrderJpa.java                    -- regenerado (sin cambios previos)
# SKIP OrderApplicationMapper.java     -- omitido (modificado manualmente)
# SKIP CreateOrderCommandHandler.java  -- omitido (modificado manualmente)
```

---

## 11. Comando `eva4j doctor`

### Descripción

Un comando de análisis estático que examina el código del proyecto y detecta violaciones de los patrones DDD que eva4j promueve. Útil para onboarding de equipos y revisiones de arquitectura.

### Uso

```bash
eva4j doctor
eva4j doctor --module orders
eva4j doctor --verbose
```

### Salida Esperada

```
� eva4j doctor — Analizando proyecto...

� Módulo: orders

  ❌ Order.java:45
     Setter público detectado: setStatus(OrderStatus status)
     Recomendación: Reemplazar con método de negocio: confirm(), cancel(), etc.

  ❌ OrderItemJpa.java:12
     Falta @JoinColumn en relación inverse @ManyToOne
     Recomendación: Agregar @JoinColumn(name = "order_id", nullable = false)

  ⚠️  CreateOrderCommandHandler.java:67
     Lógica de negocio detectada fuera del dominio: totalAmount > 0
     Recomendación: Mover validación a Order.place() como invariante de dominio

  ✅ OrderRepository.java — OK
  ✅ OrderMapper.java — OK

� Resultado: 2 errores, 1 advertencia, 2 archivos OK
```

### Reglas Implementadas

| Regla | Severidad | Descripción |
|---|---|---|
| No setters en dominio | ❌ Error | Detecta `set*` públicos en entidades de dominio |
| No constructor vacío en dominio | ❌ Error | Detecta `public Entity()` sin parámetros |
| Repositorio solo para raíz | ❌ Error | Detecta `Repository<SecondaryEntity>` |
| FK cross-aggregate | ⚠️ Warn | `@ManyToOne` a entidad de otro agregado |
| Lógica de negocio en handler | ⚠️ Warn | Condicionales complejos en CommandHandlers |
| Value Object mutable | ⚠️ Warn | Value Objects con setters o campos non-final |

---

## 12. Tests Generados Completos

### Descripción

Actualmente eva4j genera estructura de test básica. Para proyectos en producción, los tests deben cubrir invariantes de dominio, contrato de mappers y tests de integración de módulo con Spring Modulith.

### Tests de Dominio Generados

```java
class OrderTest {

    @Test
    @DisplayName("Should create order with valid data")
    void shouldCreateOrder() {
        Order order = new Order("ORD-001", "CUST-123");
        assertThat(order.getOrderNumber()).isEqualTo("ORD-001");
        assertThat(order.getStatus()).isEqualTo(OrderStatus.DRAFT);
    }

    @Test
    @DisplayName("Should not allow adding item to cancelled order")
    void shouldRejectItemOnCancelledOrder() {
        Order order = new Order("ORD-001", "CUST-123");
        order.cancel("Test");
        assertThatThrownBy(() -> order.addItem("PROD-1", 2, BigDecimal.TEN))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("cancelled");
    }
}
```

### Tests de Mapper (roundtrip)

```java
class OrderMapperTest {
    private final OrderMapper mapper = new OrderMapper();

    @Test
    @DisplayName("Domain -> JPA -> Domain roundtrip preserves all fields")
    void domainToJpaRoundtrip() {
        Order original = new Order("id-1", "ORD-001", "CUST-123",
            OrderStatus.DRAFT, LocalDateTime.now(), LocalDateTime.now());
        OrderJpa jpa = mapper.toJpa(original);
        Order restored = mapper.toDomain(jpa);
        assertThat(restored.getId()).isEqualTo(original.getId());
        assertThat(restored.getStatus()).isEqualTo(original.getStatus());
    }
}
```

### Tests de Módulo con Spring Modulith

```java
@ApplicationModuleTest
class OrderModuleTest {

    @Test
    @DisplayName("Module is self-contained -- no illegal cross-module dependencies")
    void moduleShouldBeValid(ApplicationModules modules) {
        modules.verify();
    }

    @Test
    @DisplayName("Create order publishes OrderPlacedEvent")
    @Transactional
    void shouldPublishOrderPlacedEvent(
        @Autowired CreateOrderCommandHandler handler,
        AssertablePublishedEvents events
    ) {
        handler.handle(new CreateOrderCommand("ORD-001", "CUST-123"));
        events.assertThat()
            .contains(OrderPlacedEvent.class)
            .matching(e -> e.getAggregateId().equals("ORD-001"));
    }
}
```

---

## ✅ IMPLEMENTADO

---

## 13. Auditoría (Implementada)

| Característica | Sintaxis | Estado |
|---|---|---|
| Auditoría de tiempo | `audit: { enabled: true }` | ✅ Implementado |
| Auditoría de usuario | `audit: { trackUser: true }` | ✅ Implementado |
| `@EnableJpaAuditing` condicional | `auditorAwareRef` solo si `trackUser: true` | ✅ Implementado |
| Regeneración de `Application.java` en `g entities` | Automático | ✅ Implementado |

Cuando `trackUser: true` se generan automáticamente: `UserContextFilter`, `UserContextHolder`, `AuditorAwareImpl` y la anotación `@EnableJpaAuditing(auditorAwareRef = "auditorProvider")` en `Application.java`.

Cuando solo `enabled: true` se genera `@EnableJpaAuditing` sin `auditorAwareRef`.

---

## 14. Validaciones JSR-303 (Implementado)

Generación automática de anotaciones Bean Validation en `Create*Command` y `Create*Dto`. Las validaciones **nunca** se generan en entidades de dominio ni en campos `readOnly: true`.

### Sintaxis

```yaml
fields:
  - name: email
    type: String
    validations:
      - type: Email
        message: "Email inválido"
      - type: NotBlank
  - name: age
    type: Integer
    validations:
      - type: Min
        value: 18
      - type: Max
        value: 120
```

### Código Generado

```java
@Email(message = "Email inválido")
@NotBlank
private String email;

@Min(value = 18)
@Max(value = 120)
private Integer age;
```

---

## Resumen de Prioridades

| # | Característica | Prioridad | Complejidad | Estado |
|---|---|---|---|---|
| 1 | Domain Events | � Alta | � Alta | � Pendiente |
| 2 | Aggregate Boundaries por ID | � Alta | � Media | � Pendiente |
| 3 | Soft Delete Completo | � Alta | � Baja | � Parcial |
| 4 | Paginación en Queries | � Media | � Media | � Pendiente |
| 5 | Optimistic Locking | � Media | � Baja | � Pendiente |
| 6 | Read Models / Proyecciones | � Media | � Alta | � Pendiente |
| 7 | Enums con Transiciones | � Media | � Baja | � Pendiente |
| 8 | Specifications Pattern | � Media | � Media | � Pendiente |
| 9 | JSON Schema para domain.yaml | � Tooling | � Media | � Pendiente |
| 10 | Generacion Incremental | � Tooling | � Alta | � Pendiente |
| 11 | eva4j doctor | � Tooling | � Media | � Pendiente |
| 12 | Tests Completos | � Tooling | � Media | � Pendiente |
| 13 | Auditoria completa | Impl. | -- | ✅ Implementado |
| 14 | Validaciones JSR-303 | Impl. | -- | ✅ Implementado |

---

**Ultima actualizacion:** 2026-02-21
**Version de eva4j:** 1.x
**Estado:** Documento de planificacion y referencia
