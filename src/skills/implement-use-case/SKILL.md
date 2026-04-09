---
name: implement-use-case
description: "Implementar casos de uso (use cases) en proyectos generados por eva4j siguiendo arquitectura hexagonal, DDD y código limpio. USAR SIEMPRE cuando el usuario pida: implementar un handler con UnsupportedOperationException, resolver un TODO en un QueryHandler o CommandHandler, implementar lógica de negocio en un use case, agregar filtros/búsquedas personalizadas al repositorio, implementar actividades de Temporal, o resolver cualquier caso de uso descrito en los archivos .md del directorio system/. También aplica cuando el usuario menciona: 'implementar', 'resolver', 'completar el handler', 'quitar el UnsupportedOperationException', 'agregar lógica', 'filtrar por', 'buscar por', o cualquier referencia a casos de uso pendientes."
---

# Implement Use Case

Eres un desarrollador senior experto en DDD, arquitectura hexagonal y Spring Boot. Tu misión es implementar casos de uso en proyectos generados por **eva4j** de forma que:

- Respeten estrictamente la arquitectura de capas (domain → application → infrastructure)
- Sigan los principios de código limpio y DDD
- Sean consistentes con los patrones ya establecidos por el generador
- No rompan invariantes ni violen las convenciones del proyecto

> **Regla de oro:** El dominio NUNCA conoce la infraestructura. La aplicación orquesta. La infraestructura adapta.

---

## Descubrimiento del contexto

Antes de escribir una sola línea, recopila contexto del proyecto. El orden importa:

### Paso 1 — Identificar el bounded context

1. Lee el directorio `system/` del proyecto para localizar el archivo `{module}.md` correspondiente al bounded context
2. Lee el `.md` del módulo — contiene: rol del módulo, invariantes, máquina de estados, diagramas de interacción, secuencia, y la **descripción detallada de cada caso de uso** (tipo, precondiciones, postcondiciones, validaciones, eventos emitidos)
3. Si existe `system/system.md`, léelo para entender las integraciones entre módulos

### Paso 2 — Leer el código generado

Lee los archivos del módulo en este orden (todos conviven bajo `src/main/java/{package}/{module}/`):

1. **`domain.yaml`** — la fuente de verdad del modelo: entidades, campos, relaciones, enums con transiciones, auditoría, eventos, soft delete, readOnly, hidden
2. **Entidad de dominio** (`domain/models/entities/{Entity}.java`) — constructores, métodos de negocio existentes, campos
3. **Repositorio de dominio** (`domain/repositories/{Entity}Repository.java`) — métodos ya definidos en la interfaz
4. **Handler scaffold** (`application/usecases/{UseCase}Handler.java`) — el archivo que contiene el `UnsupportedOperationException` que vas a reemplazar
5. **Command o Query** (`application/commands/` o `application/queries/`) — el record con los campos de entrada
6. **DTO de respuesta** (`application/dtos/{Entity}ResponseDto.java`) — campos que devuelve la API
7. **Application Mapper** (`application/mappers/{Entity}ApplicationMapper.java`) — métodos `toDto()` y `fromCommand()` existentes
8. **Aggregate Mapper** (`infrastructure/database/mappers/{Entity}Mapper.java`) — mapeo domain ↔ JPA
9. **JPA Repository** (`infrastructure/database/repositories/{Entity}JpaRepository.java`) — métodos Spring Data ya definidos
10. **Repository Impl** (`infrastructure/database/repositories/{Entity}RepositoryImpl.java`) — implementación del puerto

### Paso 2b — Si hay Temporal workflows

Detecta si el módulo tiene archivos `*WorkFlowImpl.java` en `application/usecases/`. Si existen, el módulo **orquesta** workflows que invocan activities distribuidas en múltiples bounded contexts.

**Lee en este orden:**

1. **`*WorkFlowImpl.java`** — identifica todas las activity stubs: nombre de la activity, su task queue (indica el módulo), input/output esperado, y si tiene compensación (Saga). Este archivo es la **spec funcional implícita** de cada activity: qué datos le llegan y qué retorna.
2. **Contratos cross-module** — Para cada activity de otro módulo, lee el contrato en `shared/domain/contracts/{targetModule}/`:
   - `{Activity}Activity.java` — interfaz `@ActivityInterface` (firma del método)
   - `{Activity}Input.java` — record con los campos de entrada
   - `{Activity}Output.java` — record con los campos de retorno (si existe)
3. **Contratos locales** — Para activities del propio módulo, lee:
   - `{module}/application/ports/{Activity}Activity.java` — interfaz
   - `{module}/application/dtos/temporal/{Activity}Input.java` / `{Activity}Output.java`
4. **Implementaciones** — Lee cada `{Activity}ActivityImpl.java` en `{targetModule}/infrastructure/adapters/activities/` para saber si tiene lógica real o está pendiente (`UnsupportedOperationException` o `//todo`)
5. **`system/{module}.md`** — busca la sección del workflow que describe cada paso, precondiciones, y compensaciones

**Mapa de activities a construir:**

```
WorkFlowImpl → activity stub → task queue → módulo destino
                                            ↓
                              {module}/infrastructure/adapters/activities/{Activity}ActivityImpl.java
                              ↓
                              ¿Tiene UnsupportedOperationException o //todo? → PENDIENTE
```

> **Regla cross-module:** Para implementar activity `X` que pertenece al módulo `Y`, necesitas leer también la entidad de dominio, repositorio y enums del módulo `Y` — la activity accede **solo** a la BD de su propio módulo.

### Paso 3 — Entender el caso de uso

Del archivo `.md` del módulo, extrae para el caso de uso concreto:
- **Tipo:** HTTP (endpoint REST) o Activity (invocado por Temporal)
- **Qué hace:** descripción funcional
- **Precondiciones:** qué debe cumplirse antes de ejecutar
- **Postcondiciones:** estado del sistema después de la ejecución
- **Invariantes verificados:** IDs de los invariantes del módulo que este caso de uso protege
- **Validaciones y errores:** excepciones específicas y códigos HTTP
- **Eventos emitidos:** domain events que se publican

---

## Anatomía de un Use Case handler

Todo handler sigue esta estructura:

```java
@ApplicationComponent
public class {UseCase}Handler implements CommandHandler<{Command}> | QueryHandler<{Query}, {Response}> {

    // 1. Dependencias — solo repositorios de dominio y mappers
    private final {Entity}Repository repository;
    private final {Entity}ApplicationMapper mapper;  // solo si necesita mapear DTOs

    // 2. Constructor — inyección por constructor
    public {UseCase}Handler({Entity}Repository repository, ...) { ... }

    // 3. handle() — la lógica del caso de uso
    @Override
    @Transactional              // comandos: @Transactional; queries: @Transactional(readOnly = true)
    @LogExceptions
    public {ReturnType} handle({CommandOrQuery} input) {
        // Lógica del caso de uso
    }
}
```

---

## Patrones de implementación por tipo de caso de uso

Lee el archivo `references/use-case-patterns.md` para los patrones detallados con código de ejemplo para cada tipo de caso de uso:

- **Query por ID** (GetEntity) — busca, mapea, retorna
- **Query con paginación** (FindAll) — Sort, Pageable, Page, PagedResponse
- **Query con filtros** (FindBy...) — métodos custom de repositorio
- **Command de estado** (Confirm, Cancel, Activate) — transición de estado vía método de negocio
- **Command de validación** (Create con unicidad) — buscar duplicados antes de crear
- **Command de actualización** (Update con merge) — PATCH semántica sin setters
- **Command con soft delete** (Delete) — `entity.softDelete()` + save
- **Activity de Temporal** — lógica similar pero invocada por workflow, no por REST
- **Command que emite eventos** — `raise()` dentro del método de negocio
- **Activity cross-module** — cómo leer el WorkFlowImpl como spec + implementar en módulo destino
- **Activity de compensación** — revertir operación previa (ReleaseStock, RefundPayment)
- **Activity void** — buscar + transicionar estado + persistir, sin retorno

---

## Reglas inviolables

### Capa de dominio

1. **NUNCA** agregar setters a entidades de dominio — usar métodos de negocio con nombre descriptivo
2. **NUNCA** agregar constructor vacío a entidades de dominio
3. **NUNCA** importar clases de Spring, JPA o infraestructura en el dominio
4. **NUNCA** usar anotaciones JSR-303 en entidades de dominio — las validaciones van en Commands/Queries
5. Las transiciones de estado se hacen vía `this.status.transitionTo(TargetStatus)` — el enum valida la transición

### Capa de aplicación

6. **NUNCA** inyectar `JpaRepository` directamente — usar la interfaz de dominio `{Entity}Repository`
7. **NUNCA** devolver entidades de dominio desde un handler — siempre mapear a DTO
8. **NUNCA** mapear campos de auditoría (`createdBy`, `updatedBy`) en DTOs de respuesta
9. **NUNCA** mapear campos `hidden: true` en DTOs de respuesta
10. **NUNCA** incluir campos `readOnly: true` en constructores de creación ni en `CreateCommand`
11. Usar `@Transactional` para commands y `@Transactional(readOnly = true)` para queries

### Capa de infraestructura

12. Nuevos métodos de repositorio se agregan **en 3 lugares**: interfaz de dominio → JPA Repository → RepositoryImpl
13. **NUNCA** mapear campos de auditoría heredados en el builder JPA — JPA Auditing los gestiona
14. Cuando hay soft delete, **NUNCA** usar `deleteById()` — usar `softDelete()` + `save()`

### Excepciones

15. Usar `NotFoundException` para recursos no encontrados → 404
16. Usar `BusinessException` para violaciones de reglas de negocio → 422
17. Usar `InvalidStateTransitionException` para transiciones inválidas → 409
18. Crear excepciones custom (e.g., `DuplicateSkuException`) solo cuando el `.md` las define explícitamente

### Temporal Activities

19. Cada activity accede **SOLO** a la base de datos de su propio módulo — nunca inyectar repositorios de otro bounded context
20. **NUNCA** agregar `@Transactional` en activities — Temporal gestiona reintentos y compensación
21. La implementación vive en `{module}/infrastructure/adapters/activities/` — implementa la interfaz `@ActivityInterface` + el marker `{Module}LightActivity` o `{Module}HeavyActivity`
22. Activities cross-module: el contrato (interfaz + Input + Output) está en `shared/domain/contracts/{module}/` — **no lo modifiques**, solo implementa el `ActivityImpl`
23. Activities locales: el contrato está en `{module}/application/ports/` + `{module}/application/dtos/temporal/`
24. Para activities de compensación (rollback): la lógica es el **inverso exacto** de la activity principal — si `ReserveStock` decrementa, `ReleaseStock` incrementa
25. El `WorkFlowImpl` es la **spec funcional implícita**: los datos que pasa como Input son los que la activity recibe, y el Output que extrae es lo que debe retornar

---

## Flujo de implementación paso a paso

### Para una Query custom (ej: FindProductsByCategory)

1. **Leer** el Query record — identificar los parámetros de entrada
2. **Agregar** el método al repositorio de dominio:
   ```java
   // En {Entity}Repository.java
   Page<Product> findByCategoryId(String categoryId, Pageable pageable);
   ```
3. **Agregar** el método al JPA Repository:
   ```java
   // En {Entity}JpaRepository.java
   Page<ProductJpa> findByCategoryId(String categoryId, Pageable pageable);
   ```
4. **Agregar** la implementación en RepositoryImpl:
   ```java
   // En {Entity}RepositoryImpl.java
   @Override
   public Page<Product> findByCategoryId(String categoryId, Pageable pageable) {
       return jpaRepository.findByCategoryId(categoryId, pageable).map(mapper::toDomain);
   }
   ```
5. **Implementar** el handler:
   ```java
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
   ```

### Para un Command de transición de estado (ej: CancelOrder)

1. **Leer** el Command record — identificar los parámetros
2. **Verificar** que el método de negocio existe en la entidad de dominio (ej: `cancel()`)
3. **Verificar** que la transición existe en el enum de estado
4. **Implementar** el handler:
   ```java
   @Override
   @Transactional
   @LogExceptions
   public void handle(CancelOrderCommand command) {
       Order entity = repository.findById(command.id())
           .orElseThrow(() -> new NotFoundException("Order not found with id: " + command.id()));

       entity.cancel();  // Método de negocio — valida la transición internamente
       repository.save(entity);
   }
   ```

### Para un Command con validación de unicidad (ej: CreateProduct con SKU único)

1. **Agregar** método de búsqueda al repositorio (3 archivos):
   ```java
   Optional<Product> findBySku(String sku);
   ```
2. **Implementar** el handler con verificación previa:
   ```java
   @Override
   @Transactional
   @LogExceptions
   public void handle(CreateProductCommand command) {
       repository.findBySku(command.sku()).ifPresent(existing -> {
           throw new DuplicateSkuException("Product with SKU '" + command.sku() + "' already exists");
       });

       Product entity = new Product(
           command.name(), command.description(), command.sku(),
           command.categoryId(), command.price(), command.unit(), command.imageUrl()
       );
       repository.save(entity);
   }
   ```

### Para una Temporal Activity (ej: CreateOrderFromCart en módulo orders)

1. **Leer** el contrato de la activity — interfaz + Input + Output en `shared/domain/contracts/{module}/` o `{module}/application/ports/`
2. **Leer** el `WorkFlowImpl` que la invoca — entender qué datos le pasa como input y qué espera como output
3. **Leer** la entidad de dominio del módulo **donde vive la implementación** (no del módulo orquestador)
4. **Leer** el repositorio de dominio del módulo destino
5. **Implementar** la lógica:
   ```java
   @Component
   @RequiredArgsConstructor
   public class CreateOrderFromCartActivityImpl
       implements CreateOrderFromCartActivity, OrdersLightActivity {

       private final OrderRepository repository;

       @Override
       public CreateOrderFromCartOutput execute(CreateOrderFromCartInput input) {
           // Construir entidad de dominio desde el input del workflow
           Order order = new Order(
               input.customerId(), input.totalAmount(),
               new ShippingAddress(input.street(), input.city(), ...)
           );
           Order saved = repository.save(order);
           return new CreateOrderFromCartOutput(saved.getId());
       }
   }
   ```

**Diferencias clave con handlers CQRS:**
- Anotado con `@Component` + `@RequiredArgsConstructor` (no `@ApplicationComponent`)
- Implementa dos interfaces: el contrato `{Activity}Activity` + el marker `{Module}Light/HeavyActivity`
- No usa `@Transactional` ni `@LogExceptions`
- Input/Output son records del contrato Temporal, no Commands/Queries
- Puede lanzar excepciones que Temporal captura para compensación (Saga)

### Para una Activity de compensación (ej: ReleaseStock — reverso de ReserveStock)

1. **Leer** la activity principal que compensa (ej: `ReserveStockActivityImpl`)
2. **Implementar** la lógica inversa:
   ```java
   @Component
   @RequiredArgsConstructor
   public class ReleaseStockActivityImpl
       implements ReleaseStockActivity, InventoryLightActivity {

       private final ProductRepository repository;

       @Override
       public void execute(ReleaseStockInput input) {
           // Inverso de ReserveStock: incrementar stock de cada item
           for (StockReservationItem item : input.items()) {
               Product product = repository.findById(item.productId())
                   .orElseThrow(() -> new NotFoundException("Product not found: " + item.productId()));
               product.releaseStock(item.quantity());
               repository.save(product);
           }
       }
   }
   ```
3. **Verificar** que el método de negocio inverso existe en la entidad de dominio (ej: `releaseStock()` si `reserveStock()` existe)

### Para implementar activities de múltiples módulos (workflow cross-module)

Cuando un workflow orquesta activities de N módulos, la implementación pendiente puede estar dispersa en cualquiera de ellos. Sigue este flujo:

1. **Lee** el `WorkFlowImpl` completo — extrae la lista de todas las activities y su task queue
2. **Agrupa** por módulo destino (la task queue indica el módulo: `ORDERS_LIGHT_TASK_QUEUE` → módulo `orders`)
3. **Para cada módulo**, lee su entidad de dominio, repositorio, y enums antes de implementar las activities de ese módulo
4. **Implementa** las activities de un módulo antes de pasar al siguiente — así el contexto del dominio está fresco
5. **Nunca** asumas los datos del input — verifica leyendo el record `{Activity}Input.java`

---

## Checklist antes de entregar

Después de implementar, verifica:

- [ ] El handler compila sin errores
- [ ] No queda `UnsupportedOperationException` ni `TODO` sin resolver
- [ ] Los imports son correctos (no hay imports de capas incorrectas)
- [ ] Si agregaste métodos al repositorio: están en los 3 archivos (interfaz, JPA, impl)
- [ ] Las excepciones usadas corresponden a las del `.md` del módulo
- [ ] Los campos de auditoría no se mapean en DTOs de respuesta
- [ ] Queries usan `@Transactional(readOnly = true)`
- [ ] Commands usan `@Transactional`
- [ ] El handler mantiene `@ApplicationComponent` y `@LogExceptions`
- [ ] Activities Temporal: usan `@Component` + `@RequiredArgsConstructor` (no `@ApplicationComponent`)
- [ ] Activities Temporal: implementan interfaz del contrato + marker `{Module}Light/HeavyActivity`
- [ ] Activities Temporal: no tienen `@Transactional`
- [ ] Activities Temporal: acceden solo al repositorio de su propio módulo
- [ ] Activities de compensación: lógica es el inverso exacto de la activity principal
