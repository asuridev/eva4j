# Use Case Implementation Patterns

Referencia completa de patrones de implementación para cada tipo de caso de uso en proyectos eva4j. Lee esta referencia cuando necesites ver código de ejemplo detallado para un patrón específico.

---

## Tabla de contenido

1. [Query por ID (GetEntity)](#1-query-por-id)
2. [Query paginada (FindAll)](#2-query-paginada)
3. [Query con filtros custom](#3-query-con-filtros-custom)
4. [Query con filtros múltiples opcionales](#4-query-con-filtros-múltiples-opcionales)
5. [Command de creación con unicidad](#5-command-de-creación-con-unicidad)
6. [Command de actualización (PATCH merge)](#6-command-de-actualización)
7. [Command de transición de estado](#7-command-de-transición-de-estado)
8. [Command con soft delete](#8-command-con-soft-delete)
9. [Command que emite eventos](#9-command-que-emite-eventos)
10. [Activity de Temporal (light)](#10-activity-de-temporal-light)
11. [Activity de Temporal (heavy)](#11-activity-de-temporal-heavy)
12. [Command sobre entidad secundaria del agregado](#12-command-sobre-entidad-secundaria)
13. [Query con proyección parcial](#13-query-con-proyección-parcial)
14. [Agregar métodos al repositorio](#14-agregar-métodos-al-repositorio)
15. [Crear excepciones custom](#15-crear-excepciones-custom)

---

## 1. Query por ID

**Caso:** `GetProduct`, `GetOrder`, `GetCustomer`

```java
@ApplicationComponent
public class GetProductQueryHandler
    implements QueryHandler<GetProductQuery, ProductResponseDto> {

    private final ProductRepository repository;
    private final ProductApplicationMapper mapper;

    public GetProductQueryHandler(ProductRepository repository,
                                  ProductApplicationMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public ProductResponseDto handle(GetProductQuery query) {
        Product entity = repository.findById(query.id())
            .orElseThrow(() -> new NotFoundException("Product not found with id: " + query.id()));

        return mapper.toDto(entity);
    }
}
```

**Puntos clave:**
- `@Transactional(readOnly = true)` — optimiza la conexión a BD
- `NotFoundException` → HTTP 404 (manejado por `HandlerExceptions`)
- Siempre devuelve DTO, nunca la entidad de dominio

---

## 2. Query paginada

**Caso:** `FindAllProducts`, `FindAllOrders`, `FindAllCustomers`

```java
@ApplicationComponent
public class FindAllProductsQueryHandler
    implements QueryHandler<FindAllProductsQuery, PagedResponse<ProductResponseDto>> {

    private final ProductRepository repository;
    private final ProductApplicationMapper mapper;

    public FindAllProductsQueryHandler(ProductRepository repository,
                                       ProductApplicationMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public PagedResponse<ProductResponseDto> handle(FindAllProductsQuery query) {
        Sort sort = Sort.by(Sort.Direction.fromString(query.sortDirection()), query.sortBy());
        Pageable pageable = PageRequest.of(query.page(), query.size(), sort);

        Page<Product> page = repository.findAll(pageable);
        List<ProductResponseDto> content = page.getContent().stream()
            .map(mapper::toDto)
            .toList();

        return PagedResponse.of(content, page.getNumber(), page.getSize(), page.getTotalElements());
    }
}
```

**Imports necesarios:**
```java
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
```

---

## 3. Query con filtros custom

**Caso:** `FindProductsByCategory`, `FindOrdersByCustomer`

Cuando la query filtra por un campo específico, necesitas agregar el método en 3 niveles del repositorio.

### Paso 1 — Repositorio de dominio

```java
// domain/repositories/ProductRepository.java
public interface ProductRepository {
    // ... métodos existentes ...
    Page<Product> findByCategoryId(String categoryId, Pageable pageable);
}
```

### Paso 2 — JPA Repository

```java
// infrastructure/database/repositories/ProductJpaRepository.java
public interface ProductJpaRepository extends JpaRepository<ProductJpa, String> {
    Page<ProductJpa> findByCategoryId(String categoryId, Pageable pageable);
}
```

Spring Data genera la query automáticamente por convención de nombres.

### Paso 3 — Repository Implementation

```java
// infrastructure/database/repositories/ProductRepositoryImpl.java
@Override
public Page<Product> findByCategoryId(String categoryId, Pageable pageable) {
    return jpaRepository.findByCategoryId(categoryId, pageable).map(mapper::toDomain);
}
```

### Paso 4 — Handler

```java
@ApplicationComponent
public class FindProductsByCategoryQueryHandler
    implements QueryHandler<FindProductsByCategoryQuery, PagedResponse<ProductResponseDto>> {

    private final ProductRepository repository;
    private final ProductApplicationMapper mapper;

    public FindProductsByCategoryQueryHandler(ProductRepository repository,
                                              ProductApplicationMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    @Override
    @Transactional(readOnly = true)
    @LogExceptions
    public PagedResponse<ProductResponseDto> handle(FindProductsByCategoryQuery query) {
        Pageable pageable = PageRequest.of(query.page(), query.size(),
            Sort.by(Sort.Direction.fromString(query.sortDirection()), query.sortBy()));

        Page<Product> page = repository.findByCategoryId(query.categoryId(), pageable);
        List<ProductResponseDto> content = page.getContent().stream()
            .map(mapper::toDto)
            .toList();

        return PagedResponse.of(content, page.getNumber(), page.getSize(), page.getTotalElements());
    }
}
```

---

## 4. Query con filtros múltiples opcionales

**Caso:** `FindAllOrders` con filtros por `customerId`, `status`, `fromDate`, `toDate`

Cuando hay múltiples filtros opcionales, usa `Specification` para construir queries dinámicas.

### Paso 1 — Specification en infraestructura

```java
// infrastructure/database/repositories/OrderJpaSpecification.java
public class OrderJpaSpecification {

    public static Specification<OrderJpa> withFilters(
            String customerId, OrderStatus status,
            LocalDateTime fromDate, LocalDateTime toDate) {

        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            if (customerId != null && !customerId.isBlank()) {
                predicates.add(cb.equal(root.get("customerId"), customerId));
            }
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            if (fromDate != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), fromDate));
            }
            if (toDate != null) {
                predicates.add(cb.lessThanOrEqualTo(root.get("createdAt"), toDate));
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }
}
```

### Paso 2 — JPA Repository extiende JpaSpecificationExecutor

```java
public interface OrderJpaRepository
    extends JpaRepository<OrderJpa, String>, JpaSpecificationExecutor<OrderJpa> {
}
```

### Paso 3 — Repositorio de dominio

```java
Page<Order> findAll(String customerId, OrderStatus status,
                    LocalDateTime fromDate, LocalDateTime toDate,
                    Pageable pageable);
```

### Paso 4 — Repository Implementation

```java
@Override
public Page<Order> findAll(String customerId, OrderStatus status,
                           LocalDateTime fromDate, LocalDateTime toDate,
                           Pageable pageable) {
    Specification<OrderJpa> spec = OrderJpaSpecification.withFilters(
        customerId, status, fromDate, toDate);
    return jpaRepository.findAll(spec, pageable).map(mapper::toDomain);
}
```

### Paso 5 — Handler

```java
@Override
@Transactional(readOnly = true)
@LogExceptions
public PagedResponse<OrderResponseDto> handle(FindAllOrdersQuery query) {
    Pageable pageable = PageRequest.of(query.page(), query.size(),
        Sort.by(Sort.Direction.fromString(query.sortDirection()), query.sortBy()));

    Page<Order> page = repository.findAll(
        query.customerId(), query.status(),
        query.fromDate(), query.toDate(), pageable);

    List<OrderResponseDto> content = page.getContent().stream()
        .map(mapper::toDto)
        .toList();

    return PagedResponse.of(content, page.getNumber(), page.getSize(), page.getTotalElements());
}
```

**Import para Specification:**
```java
import org.springframework.data.jpa.domain.Specification;
import jakarta.persistence.criteria.Predicate;
```

---

## 5. Command de creación con unicidad

**Caso:** `CreateProduct` (SKU único), `CreateCustomer` (email único)

```java
@ApplicationComponent
public class CreateProductCommandHandler
    implements CommandHandler<CreateProductCommand> {

    private final ProductRepository repository;

    public CreateProductCommandHandler(ProductRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    @LogExceptions
    public void handle(CreateProductCommand command) {
        // Verificar invariante de unicidad
        repository.findBySku(command.sku()).ifPresent(existing -> {
            throw new DuplicateSkuException(
                "Product with SKU '" + command.sku() + "' already exists");
        });

        // Crear entidad — constructor de creación (sin id, sin audit, sin readOnly)
        Product entity = new Product(
            command.name(),
            command.description(),
            command.sku(),
            command.categoryId(),
            command.price(),
            command.unit(),
            command.imageUrl()
        );

        repository.save(entity);
    }
}
```

**Requiere agregar al repositorio:**
```java
Optional<Product> findBySku(String sku);
```

---

## 6. Command de actualización

**Caso:** `UpdateProduct`, `UpdateCustomer`

El patrón de eva4j usa el constructor completo con merge de valores para lograr PATCH semántica **sin setters**.

### Si la entidad tiene método `update()` (generado por lifecycle event)

```java
@Override
@Transactional
@LogExceptions
public void handle(UpdateProductCommand command) {
    Product existing = repository.findById(command.id())
        .orElseThrow(() -> new NotFoundException("Product not found with id: " + command.id()));

    existing.update(
        command.name() != null ? command.name() : existing.getName(),
        command.description() != null ? command.description() : existing.getDescription(),
        command.price() != null ? command.price() : existing.getPrice()
    );

    repository.save(existing);
}
```

### Si NO hay método `update()` — usar constructor completo

```java
@Override
@Transactional
@LogExceptions
public void handle(UpdateProductCommand command) {
    Product existing = repository.findById(command.id())
        .orElseThrow(() -> new NotFoundException("Product not found with id: " + command.id()));

    // Reconstruir con merge — campos readOnly y audit preservados del existing
    Product updated = new Product(
        existing.getId(),
        command.name() != null ? command.name() : existing.getName(),
        command.description() != null ? command.description() : existing.getDescription(),
        command.sku() != null ? command.sku() : existing.getSku(),
        command.categoryId() != null ? command.categoryId() : existing.getCategoryId(),
        command.price() != null ? command.price() : existing.getPrice(),
        command.unit() != null ? command.unit() : existing.getUnit(),
        command.imageUrl() != null ? command.imageUrl() : existing.getImageUrl(),
        existing.getStatus(),       // readOnly — siempre preservar
        existing.getCreatedAt(),    // audit — siempre preservar
        existing.getUpdatedAt(),    // audit — siempre preservar
        existing.getCreatedBy(),    // audit — siempre preservar
        existing.getUpdatedBy(),    // audit — siempre preservar
        existing.getDeletedAt()     // soft delete — siempre preservar
    );

    repository.save(updated);
}
```

**Reglas del merge:**
- Campos normales: `command.x() != null ? command.x() : existing.getX()`
- Campos `readOnly`: siempre `existing.getX()`
- Campos de auditoría: siempre `existing.getX()`
- Campo `deletedAt`: siempre `existing.getDeletedAt()`
- Campo `id`: siempre `existing.getId()`

---

## 7. Command de transición de estado

**Caso:** `CancelOrder`, `ConfirmOrder`, `ActivateProduct`, `DeactivateProduct`

```java
@ApplicationComponent
public class CancelOrderCommandHandler
    implements CommandHandler<CancelOrderCommand> {

    private final OrderRepository repository;

    public CancelOrderCommandHandler(OrderRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    @LogExceptions
    public void handle(CancelOrderCommand command) {
        Order entity = repository.findById(command.id())
            .orElseThrow(() -> new NotFoundException("Order not found with id: " + command.id()));

        entity.cancel();  // Valida la transición internamente vía el enum
        repository.save(entity);
    }
}
```

**Cómo funciona internamente:**
```java
// En Order.java — generado por eva4j
public void cancel() {
    this.status = this.status.transitionTo(OrderStatus.CANCELLED);
    // Si hay triggers: raise(new OrderCancelledEvent(this.getId(), ...));
}
```

El enum `transitionTo()` lanza `InvalidStateTransitionException` si la transición no es válida → manejado como HTTP 409.

---

## 8. Command con soft delete

**Caso:** `DeleteProduct` (con `hasSoftDelete: true`)

```java
@Override
@Transactional
@LogExceptions
public void handle(DeleteProductCommand command) {
    Product entity = repository.findById(command.id())
        .orElseThrow(() -> new NotFoundException("Product not found with id: " + command.id()));

    entity.softDelete();       // Marca deletedAt = now, lanza si ya estaba eliminado
    repository.save(entity);   // Persiste el cambio — NUNCA usar deleteById()
}
```

**NUNCA:**
```java
repository.deleteById(command.id());  // ❌ Ignora soft delete
```

---

## 9. Command que emite eventos

**Caso:** Use cases que deben publicar domain events post-transacción.

Si el evento está declarado con `triggers` o `lifecycle` en `domain.yaml`, el `raise()` ya está generado dentro del método de negocio de la entidad. Solo necesitas llamar al método de negocio:

```java
entity.confirm();  // Internamente hace raise(new OrderConfirmedEvent(...))
repository.save(entity);  // RepositoryImpl publica los eventos pendientes
```

Si el evento NO tiene triggers, publícalo manualmente:

```java
entity.raise(new CustomEvent(entity.getId(), LocalDateTime.now()));
repository.save(entity);
```

---

## 10. Activity de Temporal (light)

**Caso:** `CreateOrderFromCart`, `ConfirmOrder`, `MarkOrderCancelled`, `ReserveStock`

Las actividades light (< 5s) acceden a BD local del módulo. Viven en `infrastructure/temporal/activities/`.

```java
@Component
@RequiredArgsConstructor
public class CreateOrderFromCartActivityImpl implements CreateOrderFromCartActivity {

    private final OrderRepository repository;

    @Override
    public String execute(CreateOrderFromCartInput input) {
        // Validar invariantes
        if (input.items() == null || input.items().isEmpty()) {
            throw new EmptyOrderException("Order must have at least one item");
        }

        // Crear entidad de dominio
        Order order = new Order(
            input.customerId(),
            input.items().stream()
                .map(item -> new OrderItem(
                    item.productId(), item.productName(),
                    item.price(), item.quantity()))
                .toList(),
            input.totalAmount(),
            new ShippingAddress(input.street(), input.city(),
                input.neighborhood(), input.zipCode())
        );

        // Persistir
        Order saved = repository.save(order);
        return saved.getId();
    }
}
```

**Diferencias con handlers HTTP:**
- Clase anotada con `@Component` (no `@ApplicationComponent`, depende del proyecto)
- No usa `@Transactional` explícito (Temporal gestiona reintentos)
- Puede lanzar excepciones que Temporal captura para compensation
- Input/Output son DTOs del workflow, no Commands/Queries

---

## 11. Activity de Temporal (heavy)

**Caso:** `ProcessPayment`, `RefundPayment`, `ScheduleDelivery`

Actividades heavy (hasta 30s) llaman a servicios externos vía puertos. Incluyen heartbeat.

```java
@Component
@RequiredArgsConstructor
public class ProcessPaymentActivityImpl implements ProcessPaymentActivity {

    private final PaymentRepository paymentRepository;
    private final PaymentGatewayService paymentGateway;  // Puerto de dominio

    @Override
    public ProcessPaymentOutput execute(ProcessPaymentInput input) {
        // Crear entidad en estado PENDING
        Payment payment = new Payment(input.orderId(), input.amount(), input.currency());
        paymentRepository.save(payment);

        // Transición a PROCESSING
        payment.startProcessing();
        paymentRepository.save(payment);

        try {
            // Llamar servicio externo (ACL via Feign)
            GatewayResponse response = paymentGateway.charge(input.amount(), input.currency());

            // Transición a COMPLETED
            payment.complete(response.getTransactionId());
            paymentRepository.save(payment);

            return new ProcessPaymentOutput(payment.getId(), "COMPLETED");
        } catch (Exception e) {
            // Transición a FAILED
            payment.fail(e.getMessage());
            paymentRepository.save(payment);

            throw new PaymentFailedException("Payment processing failed: " + e.getMessage());
        }
    }
}
```

---

## 12. Command sobre entidad secundaria

**Caso:** `AddCustomerAddress`, `RemoveCustomerAddress`

Cuando operas sobre una entidad secundaria del agregado, siempre accedes a través de la raíz.

> **Importante (proyectos existentes):** Verifica que `@OneToMany` en la entidad JPA padre incluya `orphanRemoval = true`. Sin esto, quitar un hijo de la colección con `remove*()` no ejecuta el DELETE en la BD — JPA solo desasocia la referencia en memoria. Proyectos generados con eva4j ≥ 1.0.16 ya lo incluyen automáticamente. En proyectos anteriores, agrégalo manualmente:
> ```java
> @OneToMany(mappedBy = "customer", cascade = {...}, orphanRemoval = true, fetch = FetchType.LAZY)
> ```

```java
@Override
@Transactional
@LogExceptions
public void handle(AddCustomerAddressCommand command) {
    Customer customer = repository.findById(command.customerId())
        .orElseThrow(() -> new NotFoundException("Customer not found"));

    Address address = new Address(
        command.label(), command.street(), command.city(),
        command.zipCode(), command.isDefault()
    );

    customer.addAddress(address);  // Método en la raíz del agregado
    repository.save(customer);
}
```

**En la entidad raíz:**
```java
public void addAddress(Address address) {
    if (address.isDefault()) {
        this.addresses.forEach(a -> a.unsetDefault());  // Solo uno default
    }
    this.addresses.add(address);
    address.assignCustomer(this);  // Bidireccionalidad
}
```

---

## 13. Query con proyección parcial

Cuando solo necesitas un subconjunto de campos (performance), crea un DTO específico y un método de repositorio que devuelva la proyección.

```java
// DTO de proyección
public record ProductSummaryDto(String id, String name, BigDecimal price) {}

// En el repositorio de dominio
List<ProductSummaryDto> findSummaryByCategoryId(String categoryId);

// En JPA Repository — proyección nativa
@Query("SELECT new com.example.app.productCatalog.application.dtos.ProductSummaryDto" +
       "(p.id, p.name, p.price) FROM ProductJpa p WHERE p.categoryId = :categoryId")
List<ProductSummaryDto> findSummaryByCategoryId(@Param("categoryId") String categoryId);
```

> **Nota:** Este patrón solo se justifica cuando hay métricas de rendimiento que lo requieran. Por defecto, usa el mapper estándar.

---

## 14. Agregar métodos al repositorio

Cuando el caso de uso necesita un método que no existe en el repositorio, **siempre modifica 3 archivos** en este orden:

### 1. Interfaz de dominio (`domain/repositories/{Entity}Repository.java`)
```java
Optional<Product> findBySku(String sku);
Page<Product> findByCategoryId(String categoryId, Pageable pageable);
List<Product> findByStatus(ProductStatus status);
boolean existsBySku(String sku);
```

### 2. JPA Repository (`infrastructure/database/repositories/{Entity}JpaRepository.java`)
```java
Optional<ProductJpa> findBySku(String sku);
Page<ProductJpa> findByCategoryId(String categoryId, Pageable pageable);
List<ProductJpa> findByStatus(ProductStatus status);
boolean existsBySku(String sku);
```

### 3. Repository Implementation (`infrastructure/database/repositories/{Entity}RepositoryImpl.java`)
```java
@Override
public Optional<Product> findBySku(String sku) {
    return jpaRepository.findBySku(sku).map(mapper::toDomain);
}

@Override
public Page<Product> findByCategoryId(String categoryId, Pageable pageable) {
    return jpaRepository.findByCategoryId(categoryId, pageable).map(mapper::toDomain);
}

@Override
public List<Product> findByStatus(ProductStatus status) {
    return jpaRepository.findByStatus(status).stream()
        .map(mapper::toDomain)
        .toList();
}

@Override
public boolean existsBySku(String sku) {
    return jpaRepository.existsBySku(sku);
}
```

**Convenciones de nombres Spring Data:**
- `findBy{Campo}` — busca por campo exacto
- `findBy{Campo}And{Campo2}` — busca por combinación
- `findBy{Campo}OrderBy{Campo2}Asc` — con ordenamiento
- `existsBy{Campo}` — retorna boolean
- `countBy{Campo}` — retorna long
- `deleteBy{Campo}` — elimina por campo (solo si NO hay soft delete)

---

## 15. Crear excepciones custom

Solo crea excepciones custom cuando el `.md` del módulo las define explícitamente (por ejemplo `DuplicateSkuException`, `InsufficientStockException`).

### Ubicación
```
{module}/domain/customExceptions/{ExceptionName}.java
```

O si es compartida entre módulos:
```
shared/domain/customExceptions/{ExceptionName}.java
```

### Patrón
```java
public class DuplicateSkuException extends BusinessException {
    public DuplicateSkuException(String message) {
        super(message);
    }
}
```

### Registrar en HandlerExceptions (si requiere HTTP status diferente)

Si la excepción necesita un código HTTP específico distinto al de `BusinessException` (422), agrega un handler:

```java
// En shared/infrastructure/handlerException/HandlerExceptions.java
@ResponseStatus(HttpStatus.CONFLICT)
@ExceptionHandler(DuplicateSkuException.class)
@ResponseBody
public ErrorResponse onDuplicateSkuException(DuplicateSkuException ex) {
    return new ErrorResponse(
        HttpStatus.CONFLICT.value(),
        "Conflict",
        ex.getMessage()
    );
}
```

Mapeo estándar: 409 Conflict para duplicados, 400 Bad Request para validaciones, 404 para no encontrado, 422 para reglas de negocio.
