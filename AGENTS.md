# Guía para Agentes de IA - eva4j

## 📋 Propósito del Documento

Este documento proporciona información clara sobre la arquitectura, patrones y mejores prácticas de **eva4j** para que agentes de IA puedan:
- ✅ Comprender la arquitectura hexagonal y DDD implementada
- ✅ Generar código consistente con los patrones establecidos
- ✅ Realizar modificaciones que respeten las convenciones
- ✅ Utilizar correctamente las características de auditoría y domain modeling

---

## 🏗️ Arquitectura General

### Estructura de Capas

eva4j genera proyectos Spring Boot siguiendo **arquitectura hexagonal (puertos y adaptadores)** con **DDD**:

```
src/main/java/{package}/{module}/
├── domain/                          # Capa de dominio (Pure Java)
│   ├── models/
│   │   ├── entities/               # Entidades de dominio
│   │   ├── valueObjects/           # Value Objects
│   │   └── enums/                  # Enumeraciones
│   └── repositories/               # Interfaces de repositorio (Puerto)
├── application/                     # Capa de aplicación (Casos de uso)
│   ├── commands/                   # Comandos CQRS
│   ├── queries/                    # Queries CQRS
│   ├── usecases/                   # Handlers (Command/Query)
│   ├── mappers/                    # Mappers Application ↔ Domain
│   └── dtos/                       # DTOs de entrada/salida
└── infrastructure/                  # Capa de infraestructura (Adaptadores)
    ├── database/
    │   ├── entities/               # Entidades JPA (con Lombok)
    │   └── repositories/           # Repositorios JPA
    ├── adapters/                   # Adaptadores externos (HTTP, Kafka)
    └── controllers/                # REST Controllers
```

### Principios Clave

1. **Independencia del dominio** - El core nunca depende de infraestructura
2. **CQRS** - Separación de comandos (escritura) y queries (lectura)
3. **Sin setters en dominio** - Estado modificable solo por métodos de negocio
4. **Constructores inmutables** - Entidades creadas en estado válido
5. **Mappers explícitos** - Conversión clara entre capas

---

## 🎯 Principios DDD Implementados

### Entidades de Dominio

Las entidades de dominio generadas por eva4j siguen estos principios estrictos:

#### ✅ Constructores Obligatorios (SIN Constructor Vacío)

```java
public class User {
    private String id;
    private String username;
    private String email;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    
    // ✅ Constructor completo (para reconstrucción desde persistencia)
    public User(String id, String username, String email, 
                LocalDateTime createdAt, LocalDateTime updatedAt) {
        this.id = id;
        this.username = username;
        this.email = email;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }
    
    // ✅ Constructor de creación (sin id, sin audit fields)
    public User(String username, String email) {
        this.username = username;
        this.email = email;
    }
    
    // ❌ NO HAY constructor vacío - Evita estados inválidos
}
```

**Razón:** El constructor vacío permite crear entidades en estado inválido, violando invariantes de dominio.

#### ❌ Sin Setters Públicos

```java
// ❌ NO HACER - Setters públicos
public void setEmail(String email) {
    this.email = email;
}

// ✅ SÍ HACER - Métodos de negocio
public void updateEmail(String newEmail) {
    if (newEmail == null || !newEmail.contains("@")) {
        throw new IllegalArgumentException("Invalid email format");
    }
    this.email = newEmail;
}
```

#### ✅ Getters Públicos

```java
// ✅ Getters siempre públicos
public String getUsername() {
    return username;
}

public String getEmail() {
    return email;
}
```

#### ✅ Métodos de Negocio para Modificar Estado

```java
public class Order {
    private OrderStatus status;
    
    // ✅ Métodos de negocio con validaciones
    public void confirm() {
        if (this.status == OrderStatus.CANCELLED) {
            throw new IllegalStateException("Cannot confirm cancelled order");
        }
        this.status = OrderStatus.CONFIRMED;
    }
    
    public void cancel() {
        if (this.status == OrderStatus.DELIVERED) {
            throw new IllegalStateException("Cannot cancel delivered order");
        }
        this.status = OrderStatus.CANCELLED;
    }
}
```

### Entidades JPA (Infraestructura)

Las entidades JPA **SÍ usan Lombok** y tienen características diferentes:

```java
@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserJpa extends FullAuditableEntity {
    
    @Id
    private String id;
    
    @Column(name = "username")
    private String username;
    
    @Column(name = "email")
    private String email;
    
    // Hereda campos de auditoría:
    // - createdAt, updatedAt, createdBy, updatedBy
}
```

**Características JPA:**
- ✅ Usa `@Getter`, `@Setter`, `@Builder` de Lombok
- ✅ SÍ tiene constructor vacío (requerido por JPA)
- ✅ Extiende clases base de auditoría
- ✅ Solo vive en capa de infraestructura

---

## 🔍 Auditoría de Entidades

### Sintaxis en domain.yaml

```yaml
entities:
  - name: user
    isRoot: true
    tableName: users
    audit:
      enabled: true      # ✅ Agrega createdAt, updatedAt
      trackUser: true    # ✅ Agrega createdBy, updatedBy
    fields:
      - name: id
        type: String
      - name: username
        type: String
```

### Campos Generados Automáticamente

#### Solo con `audit.enabled: true`

```java
// En entidad de dominio y JPA
private LocalDateTime createdAt;
private LocalDateTime updatedAt;
```

#### Con `audit.trackUser: true`

```java
// En entidad de dominio y JPA
private LocalDateTime createdAt;
private LocalDateTime updatedAt;
private String createdBy;    // ← Usuario que creó
private String updatedBy;    // ← Usuario que modificó
```

### Herencia JPA Según Auditoría

```java
// SIN auditoría
public class UserJpa {
    @Id
    private String id;
    // ... campos
}

// CON audit.enabled: true
public class UserJpa extends AuditableEntity {
    @Id
    private String id;
    // Hereda: createdAt, updatedAt
}

// CON audit.trackUser: true
public class UserJpa extends FullAuditableEntity {
    @Id
    private String id;
    // Hereda: createdAt, updatedAt, createdBy, updatedBy
}
```

### Infraestructura de Auditoría de Usuario

Cuando `trackUser: true`, eva4j genera automáticamente:

1. **UserContextFilter** - Captura header `X-User`
```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class UserContextFilter extends OncePerRequestFilter {
    private static final String USER_HEADER = "X-User";
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) {
        String username = request.getHeader(USER_HEADER);
        if (username != null && !username.isEmpty()) {
            UserContextHolder.setCurrentUser(username);
        }
        try {
            filterChain.doFilter(request, response);
        } finally {
            UserContextHolder.clear();
        }
    }
}
```

2. **UserContextHolder** - ThreadLocal para username
```java
public class UserContextHolder {
    private static final ThreadLocal<String> currentUser = new ThreadLocal<>();
    
    public static void setCurrentUser(String username) {
        currentUser.set(username);
    }
    
    public static String getCurrentUser() {
        return currentUser.get();
    }
    
    public static void clear() {
        currentUser.remove();
    }
}
```

3. **AuditorAwareImpl** - Proveedor para JPA Auditing
```java
@Component("auditorProvider")
public class AuditorAwareImpl implements AuditorAware<String> {
    
    @Override
    public Optional<String> getCurrentAuditor() {
        String username = UserContextHolder.getCurrentUser();
        return Optional.ofNullable(username != null ? username : "system");
    }
}
```

4. **Configuración en Application.java**
```java
@EnableJpaAuditing(auditorAwareRef = "auditorProvider")
public class Application {
    // ...
}
```

### DTOs de Respuesta - Exclusión de Campos de Usuario

Los campos `createdBy` y `updatedBy` **NO se exponen en DTOs de respuesta**:

```java
// ResponseDto generado
public record UserResponseDto(
    String id,
    String username,
    String email,
    LocalDateTime createdAt,    // ✅ SÍ se expone
    LocalDateTime updatedAt     // ✅ SÍ se expone
    // createdBy y updatedBy NO se exponen (información administrativa)
) {}
```

**Razón:** `createdBy` y `updatedBy` son metadatos administrativos que no deben exponerse en APIs públicas.

---

## 📝 Patrones de Código

### Mappers - Exclusión de Campos de Auditoría

Los mappers **NO deben mapear campos de auditoría** en el builder:

```java
// ✅ CORRECTO - Excluye todos los campos de auditoría
public OrderJpa toJpa(Order domain) {
    return OrderJpa.builder()
        .id(domain.getId())
        .orderNumber(domain.getOrderNumber())
        // NO mapear: createdAt, updatedAt, createdBy, updatedBy
        .build();
}
```

**Razón:** Los campos de auditoría son heredados de clases base y JPA Auditing los popula automáticamente.

### Filtro de Campos en Templates

```ejs
<%# En AggregateMapper.java.ejs %>
<% rootEntity.fields.filter(f => 
    !(f.name === 'createdAt' || 
      f.name === 'updatedAt' || 
      f.name === 'createdBy' || 
      f.name === 'updatedBy')
).forEach(field => { %>
    .<%= field.name %>(domain.get<%= field.name.charAt(0).toUpperCase() + field.name.slice(1) %>())
<% }); %>
```

### Relaciones Bidireccionales

```java
// Entidad raíz (User)
public void assignUserProfile(UserProfile profile) {
    this.userProfile = profile;
    if (profile != null) {
        profile.assignUser(this);  // Mantiene bidireccionalidad
    }
}

// Entidad secundaria (UserProfile)
void assignUser(User user) {  // package-private
    this.user = user;
}
```

**Patrón:** El método público está en la raíz del agregado, el método privado en la entidad secundaria.

---

## 🔧 Generación de Código

### Comandos Principales

```bash
# Crear proyecto
eva create my-app

# Agregar módulo
eva add module users

# Generar entidades desde YAML
eva g entities users

# Generar use case
eva g usecase users ActivateUser

# Generar resource (REST)
eva g resource users

# Agregar cliente Temporal
eva add temporal-client

# Generar workflow Temporal
eva g temporal-flow users

# Generar actividad Temporal
eva g temporal-activity users
```

### Estructura de domain.yaml

```yaml
aggregates:
  - name: User                        # Nombre del agregado (PascalCase)
    entities:
      - name: user                    # Nombre de entidad (camelCase)
        isRoot: true                  # Es raíz del agregado
        tableName: users              # Nombre de tabla SQL
        audit:
          enabled: true               # Auditoría de tiempo
          trackUser: true             # Auditoría de usuario (opcional)
        fields:
          - name: id
            type: String
          - name: username
            type: String
          - name: email
            type: String
        relationships:
          - type: OneToOne
            target: UserProfile
            mappedBy: user
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY
    
    valueObjects:
      - name: Address
        fields:
          - name: street
            type: String
          - name: city
            type: String
    
    enums:
      - name: UserStatus
        values:
          - ACTIVE
          - INACTIVE
          - SUSPENDED
    
    events:
      - name: UserRegisteredEvent
        fields:
          - name: userId
            type: String
        # Nota: el flag kafka: true ya no es necesario.
        # Si el proyecto tiene un broker instalado (eva add kafka-client),
        # eva g entities cablea automáticamente todos los eventos declarados.
```

El `domain.yaml` también soporta una sección `endpoints:` opcional (sibling de `aggregates:`) para declarar los endpoints REST. Ver sección [⚡ Características Avanzadas](#-características-avanzadas-del-domainyaml) para detalles.

El `domain.yaml` también soporta una sección `listeners:` opcional (sibling de `aggregates:`) para declarar los eventos externos que **consume** este módulo. Ver sección [⚡ Características Avanzadas](#-características-avanzadas-del-domainyaml) para detalles.

El `domain.yaml` también soporta una sección `ports:` opcional (sibling de `aggregates:`) para declarar los servicios HTTP síncronos que **llama** este módulo. Ver sección [⚡ Características Avanzadas](#-características-avanzadas-del-domainyaml) para detalles.

---

## ⚡ Características Avanzadas del domain.yaml

### Value Objects con Métodos

Los Value Objects pueden declarar métodos de negocio directamente en `domain.yaml`:

```yaml
valueObjects:
  - name: Money
    fields:
      - name: amount
        type: BigDecimal
      - name: currency
        type: String
    methods:
      - name: add
        returnType: Money
        parameters:
          - name: other
            type: Money
        body: "return new Money(this.amount.add(other.getAmount()), this.currency);"
      - name: isPositive
        returnType: boolean
        parameters: []
        body: "return this.amount.compareTo(BigDecimal.ZERO) > 0;"
```

### Enums con Ciclo de Vida (Transitions)

Cuando un enum representa estados de negocio, declara `transitions` e `initialValue`:

```yaml
enums:
  - name: OrderStatus
    initialValue: PENDING        # Auto-inicializa en constructor; excluido del CreateDto
    transitions:
      - from: PENDING
        to: CONFIRMED
        method: confirm
      - from: CONFIRMED
        to: SHIPPED
        method: ship
      - from: [PENDING, CONFIRMED]   # múltiples orígenes
        to: CANCELLED
        method: cancel
        guard: "this.status == OrderStatus.DELIVERED"  # lanza BusinessException si se cumple
    values: [PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED]
```

Genera automáticamente **en la entidad raíz**: `confirm()`, `ship()`, `cancel()`, helpers `isPending()`, `isConfirmed()`, `canConfirm()`, `canCancel()`.  
Genera automáticamente **en el enum**: `VALID_TRANSITIONS`, `canTransitionTo()`, `transitionTo()` (lanza `InvalidStateTransitionException` si la transición no es válida).

**Nota:** El campo con `initialValue` se trata como `readOnly: true` — no aparece en el constructor de negocio ni en el `CreateDto`.

### Eventos de Dominio (`events[]`)

```yaml
aggregates:
  - name: Order
    entities: [...]
    enums:
      - name: OrderStatus
        transitions:
          - from: DRAFT
            to: PLACED
            method: place
          - from: PLACED
            to: CANCELLED
            method: cancel
    events:
      - name: OrderPlaced
        topic: ORDER_PLACED       # opcional: sobreescribe el topic auto-derivado
        triggers:
          - place         # ← conecta la transición con este evento
        fields:
          - name: orderId
            type: String
          - name: confirmedAt
            type: LocalDateTime

      - name: OrderCancelled
        triggers:
          - cancel
        fields:
          - name: reason   # campo no resuelto → null /* TODO: provide reason */
            type: String
```

#### Propiedad `topic` (opcional)

Sobreescribe el nombre del topic Kafka auto-derivado para este evento.

**Regla de derivación por defecto:** el generador quita el sufijo `Event` del nombre de la clase antes de convertir a SCREAMING_SNAKE_CASE:
- `ProductPublishedEvent` → `PRODUCT_PUBLISHED` ✓ (no `PRODUCT_PUBLISHED_EVENT`)
- `OrderCancelled` → `ORDER_CANCELLED` (sin sufijo, sin cambios)

**Cuándo usar `topic:` explícito:**
- El producer y el consumer de otro módulo deben usar exactamente el mismo nombre.
- Si el consumer en `listeners[]` declara `topic: MY_CUSTOM_TOPIC`, declara el mismo valor aquí para que el match sea garantizado.

```yaml
events:
  - name: ProductPublishedEvent
    # topic auto-derivado: PRODUCT_PUBLISHED (sufijo 'Event' eliminado)
    triggers: [publish]
    fields: [...]

  - name: OrderReadyEvent
    topic: ORDER_READY_FOR_PICKUP   # override explícito
    triggers: [markReady]
    fields: [...]
```

> **Nota:** el flag `kafka: true` ya no es necesario — si el proyecto tiene `kafka-client` instalado, todos los eventos se cablearán automáticamente al ejecutar `eva g entities`.

#### Propiedad `triggers`

Lista de nombres de métodos de transición que publican este evento. El generador emite automáticamente `raise(new XEvent(...))` dentro de cada método listado.

**Reglas de resolución de argumentos (en orden):**

| Condición del campo del evento | Argumento generado |
|---|---|
| Siempre (primer arg, aggregateId del DomainEvent base) | `this.getId()` |
| Nombre = `{entityName}Id` (ej: `orderId` en `Order`) | **Ignorado** en el Domain Event class — mapeado a `event.getAggregateId()` en el Integration Event |
| Nombre coincide con un campo de la entidad | `this.get{Field}()` |
| Nombre termina en `At` + tipo `LocalDateTime` | `LocalDateTime.now()` |
| No resuelto | `null /* TODO: provide {fieldName} */` |

> **Convención:** Sí declarar `{entityName}Id` en `events[].fields` cuando el evento **cruza módulos via Kafka** — es necesario para que el id viaje en el payload del Integration Event. El generador lo mapea automáticamente a `event.getAggregateId()` en el handler, evitando la duplicación en el Domain Event class interno.

**Resultado generado:**

```java
public void place() {
    this.status = this.status.transitionTo(OrderStatus.PLACED);
    raise(new OrderPlaced(this.getId(), this.getId(), LocalDateTime.now()));
    //                    ^—aggregateId  ^—orderId     ^—confirmedAt
}

public void cancel() {
    this.status = this.status.transitionTo(OrderStatus.CANCELLED);
    raise(new OrderCancelled(this.getId(), null /* TODO: provide reason */));
}
```

Si un evento **no declara `triggers`** ni `lifecycle`, el desarrollador debe llamar a `raise()` manualmente dentro del método de negocio.

**Validaciones generadas:**
- **C2-004** (error): trigger referencia un método que no existe en ninguna transición del módulo (se omite para eventos con `lifecycle`)
- **C2-005** (info): transición sin ningún evento asociado — considera declarar `triggers`
- **C2-001** se silencia automáticamente para transiciones que ya tienen `triggers`
- **C2-008** (error): valor de `lifecycle` inválido (no es `create`, `update`, `delete` ni `softDelete`)
- **C2-009** (warning): `lifecycle: softDelete` sin `hasSoftDelete: true` en la entidad raíz, o `lifecycle: delete` con `hasSoftDelete: true`
- **C2-010** (error): campo de lifecycle event no existe en la entidad raíz del agregado (excluyendo `{entityName}Id` y campos `*At` + `LocalDateTime`)

**Auto-wiring de broker:** Si el proyecto tiene un broker de mensajería instalado (`eva add kafka-client`), `eva g entities` genera automáticamente la capa de Integration Events para **todos** los eventos declarados — sin necesidad de ejecutar `eva g kafka-event` por separado:

| Archivo generado | Descripción |
|---|---|
| `application/events/OrderConfirmedIntegrationEvent.java` | Record broker-facing (Integration Event) |
| `application/ports/MessageBroker.java` | Puerto broker-agnóstico (creado/actualizado) |
| `infrastructure/adapters/kafkaMessageBroker/…` | Adaptador Kafka (creado/actualizado) |
| `shared/…/kafkaConfig/KafkaConfig.java` | Bean `NewTopic` (actualizado) |
| `parameters/*/kafka.yaml` | Configuración de topic (actualizada) |

**Domain Event vs Integration Event:**
- **Domain Event** (`domain/models/events/OrderConfirmed.java`) — señal interna del bounded context. Nunca depende de infraestructura.
- **Integration Event** (`application/events/OrderConfirmedIntegrationEvent.java`) — proyección para el broker. Cambiar de Kafka a RabbitMQ solo requiere cambiar el adaptador `MessageBroker`; los Domain Events no se modifican nunca.

El `DomainEventHandler` mapea un Domain Event a un Integration Event:
```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onOrderConfirmed(OrderConfirmed event) {
    messageBroker.publishOrderConfirmedIntegrationEvent(
        new OrderConfirmedIntegrationEvent(event.getOrderId(), event.getConfirmedAt())
    );
}
```

Publicar desde la entidad raíz usando `raise()` heredado:

```java
public void confirm() {
    this.status = this.status.transitionTo(OrderStatus.CONFIRMED);
    raise(new OrderConfirmed(this.id, LocalDateTime.now()));
}
```

**Nota:** el flag `kafka: true` por evento ya no es necesario — todos los eventos se cablearán automáticamente cuando haya un broker instalado.

#### Propiedad `lifecycle`

Conecta un evento a una operación CRUD del ciclo de vida del agregado. A diferencia de `triggers` (que se conecta a métodos de transición de estado), `lifecycle` emite `raise()` automáticamente en el punto CRUD correspondiente.

**Valores válidos:**

| Valor | Punto de emisión | Descripción |
|---|---|---|
| `create` | Constructor de creación de la entidad | UUID auto-generado como id antes de raise() |
| `update` | Método `update()` de la entidad raíz | Handler llama `existing.update(...)`; `raise()` interno |
| `delete` | DeleteCommandHandler, antes de `repository.delete()` | Requiere `hasSoftDelete: false`; genera `repository.delete(entity)` |
| `softDelete` | Método `softDelete()` de la entidad | Requiere `hasSoftDelete: true`; raise() después de `this.deletedAt = ...` |

**Ejemplo en domain.yaml:**

```yaml
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

  - name: ProductUpdatedEvent
    lifecycle: update
    fields:
      - name: productId
        type: String
      - name: name
        type: String

  - name: ProductDeletedEvent
    lifecycle: delete
    fields:
      - name: productId
        type: String
      - name: deletedAt
        type: LocalDateTime
```

**Resultado generado para `lifecycle: create`:**

```java
// En Product.java — constructor de creación
public Product(String name, String description, BigDecimal price) {
    this.id = java.util.UUID.randomUUID().toString();
    this.name = name;
    this.description = description;
    this.price = price;
    raise(new ProductCreatedEvent(this.getId(), this.getName(), this.getPrice()));
}
```

**Resultado generado para `lifecycle: update`:**

```java
// En Product.java — método update()
public void update(String name, String description, BigDecimal price) {
    this.name = name;
    this.description = description;
    this.price = price;
    raise(new ProductUpdatedEvent(this.getId(), this.getName(), this.getPrice()));
}
```

```java
// En UpdateProductCommandHandler.java
Product existing = repository.findById(command.id())...;
existing.update(
    command.name() != null ? command.name() : existing.getName(),
    command.description() != null ? command.description() : existing.getDescription(),
    command.price() != null ? command.price() : existing.getPrice()
);
repository.save(existing);
```

**Resultado generado para `lifecycle: delete`:**

```java
// En DeleteProductCommandHandler.java
Product entity = repository.findById(command.id())...;
entity.raise(new ProductDeletedEvent(entity.getId(), LocalDateTime.now()));
repository.delete(entity);
```

**Resultado generado para `lifecycle: softDelete`:**

```java
// En Product.java — método softDelete()
public void softDelete() {
    if (this.deletedAt != null) { throw new IllegalStateException("..."); }
    this.deletedAt = java.time.LocalDateTime.now();
    raise(new ProductDeactivatedEvent(this.getId(), LocalDateTime.now()));
}
```

**Resolución de argumentos:** usa las mismas reglas que `triggers` (match por nombre de campo, VO unwrapping, `LocalDateTime.now()` para campos *At, `null /* TODO */` para no resueltos).

**Visibilidad de `raise()`:** cuando un evento usa `lifecycle: delete`, el método `raise()` en la entidad se genera como `public` (en vez de `protected`) para permitir que los handlers de aplicación lo invoquen. Con `lifecycle: update`, `raise()` permanece `protected` porque se invoca internamente desde el método `update()` de la entidad.

**Infraestructura de repositorio:** cuando un evento usa `lifecycle: delete`, el generador agrega automáticamente `void delete(Entity entity)` al repositorio (interface + implementación). La implementación publica los eventos pendientes antes de la eliminación física.

**Restricción:** un evento puede declarar `triggers` O `lifecycle`, no ambos. `lifecycle` aplica solo a eventos de la entidad raíz del agregado.

### Consumo de Eventos Externos (`listeners[]`)

```yaml
# Nivel raíz, sibling de aggregates:
listeners:
  - event: PaymentApprovedEvent    # PascalCase + sufijo Event
    producer: payments             # Módulo que lo produce (referencia documental)
    topic: PAYMENT_APPROVED        # Topic Kafka — obligatorio en módulos standalone
    useCase: ConfirmOrder          # Caso de uso que maneja el evento (PascalCase)
    fields:                        # Campos del payload recibido
      - name: orderId
        type: String
      - name: approvedAt
        type: LocalDateTime
      - name: details              # Tipo complejo → declarar en nestedTypes
        type: PaymentDetails
    nestedTypes:                   # Records auxiliares para campos de tipo objeto
      - name: paymentDetails       # camelCase → normalizado a PaymentDetails
        fields:
          - name: paymentId
            type: String
          - name: method
            type: String
          - name: amount
            type: BigDecimal
```

Genera por cada entrada (hasta **6 artefactos**):

| Archivo generado | Descripción |
|---|---|
| `application/events/PaymentDetails.java` | Record auxiliar (uno por `nestedTypes` entry) |
| `application/events/PaymentApprovedIntegrationEvent.java` | Record tipado con los `fields` declarados |
| `infrastructure/kafkaListener/PaymentApprovedKafkaListener.java` | `@KafkaListener` → deserializa y despacha al `useCase` |
| `parameters/*/kafka.yaml` | Registro del topic en `topics:` |
| `application/commands/ConfirmOrderCommand.java` | Command tipado para el `useCase` |
| `application/usecases/ConfirmOrderCommandHandler.java` | Handler stub — implementar la lógica de negocio aquí |

**Deserialización:** el listener usa `EventEnvelope<Map<String,Object>>` + `objectMapper.convertValue()` para deserializar cada campo del payload de forma robusta y tipada.

**Regla de `topic:`:**
- Módulo standalone (sin `system.yaml`) → `topic:` **obligatorio**
- Proyecto con `system.yaml` → puede omitirse; el generador lo infiere de `integrations.async[].topic`
- Declarado explícitamente → tiene **precedencia** sobre la inferencia

**`nestedTypes:` — cuándo usarlo:**  
Declara un `nestedType` cuando un campo del payload es un **objeto anidado** (no un escalar). El generador produce un record en el mismo paquete `application/events/`, que tanto la `IntegrationEvent` como el `Command` y el `KafkaListener` usan directamente.

**Colisión de nombres entre módulos:** cuando varios módulos consumen el mismo evento Kafka, el generador produce clases listener con el mismo nombre (ej: `PaymentApprovedKafkaListener` en `orders` y en `notifications`). Esto es seguro porque el generador usa `@Component("<moduleName>.<listenerClassName>")` para calificar el bean y evitar `ConflictingBeanDefinitionException`. **No se requiere acción del agente** — a diferencia de `ports[]`, donde el nombre de `service:` debe ser único por módulo.

**Contraste eventos producidos vs. consumidos:**
```
aggregates:
  └── events:     → Domain Events que PRODUCE (domain/models/events/)

listeners:          → Integration Events que CONSUME (infrastructure/kafkaListener/)
```

---

### Clientes HTTP Síncronos (`ports[]`)

```yaml
# Nivel raíz, sibling de aggregates: y listeners:
# Un método = una entrada; entries del mismo service: forman un solo FeignClient.

ports:
  - name: findScreeningById            # nombre del método (camelCase)
    service: ScreeningService          # agrupa en una interfaz/FeignClient (PascalCase)
    target: screenings                 # módulo destino (referencia documental)
    baseUrl: http://localhost:8081     # → parameters/*/urls.yaml (primera entrada del service)
    http: GET /screenings/{id}         # verbo + path (igual que en system.yaml exposes:)
    fields:                            # campos de respuesta → {MethodPascal}ResponseDto.java
      - name: id
        type: String
      - name: startTime
        type: LocalDateTime

  - name: findAvailableSeats
    service: ScreeningService          # mismo service → mismo FeignClient
    target: screenings
    http: GET /screenings/{id}/seats
    returnList: true                   # → List<FindAvailableSeatResponseDto>
    fields:
      - name: seatId
        type: String
      - name: seatType
        type: String

  - name: processPayment
    service: PaymentGateway
    target: payment-gateway-external
    baseUrl: https://api.payments.example.com
    http: POST /payments
    body:                              # @RequestBody → ProcessPaymentRequestDto.java
      - name: amount
        type: BigDecimal
      - name: paymentMethod
        type: PaymentMethodInput       # tipo objeto → declarar en nestedTypes:
    nestedTypes:
      - name: paymentMethodInput
        fields:
          - name: type
            type: String
          - name: cardToken
            type: String
    fields:                            # respuesta → ProcessPaymentResponseDto.java
      - name: paymentId
        type: String
      - name: status
        type: String

  - name: cancelPayment
    service: PaymentGateway
    target: payment-gateway-external
    http: DELETE /payments/{id}
    # fields: omitido → retorno void
```

### Artefactos generados por `ports[]`

Por cada `service:` único:

| Archivo generado | Descripción |
|---|---|
| `domain/repositories/{ServiceName}.java` | Interfaz del puerto secundario (devuelve modelos de dominio) |
| `infrastructure/adapters/{service}/{ServiceName}FeignClient.java` | Cliente Feign tipado (devuelve DTOs infra) |
| `infrastructure/adapters/{service}/{ServiceName}FeignAdapter.java` | `@Component implements {ServiceName}` — actúa como ACL |
| `infrastructure/adapters/{service}/{ServiceName}FeignConfig.java` | Timeouts Feign |
| `parameters/*/urls.yaml` | Base URL parametrizada |

Por cada modelo de dominio único derivado de los métodos con `fields:`:

| Archivo generado | Descripción |
|---|---|
| `domain/models/{service}/{DomainType}.java` | Modelo de dominio (ACL) — abstracción interna |

Por cada método:

| Archivo generado | Condición |
|---|---|
| `infrastructure/adapters/{service}/{MethodPascal}Dto.java` | Cuando `fields:` presente — DTO infra (forma externa) |
| `application/dtos/{MethodPascal}RequestDto.java` | Cuando `body:` presente (POST/PUT/PATCH) |
| `application/dtos/{NestedTypePascal}.java` | Cuando `nestedTypes:` declarado |

**Patrón ACL:** Los DTOs de infraestructura (forma de la API externa) viven en `infrastructure/adapters/{service}/`. Los modelos de dominio (abstracción interna) viven en `domain/models/{service}/`. El `FeignAdapter` mapea `InfraDto → DomainModel` inline con métodos privados `to{DomainType}()`. Si la API externa cambia, solo hay que actualizar el adaptador.

### Reglas de `ports[]`

- **`service:`** — PascalCase, agrupa métodos en un mismo FeignClient. **Si varios módulos llaman al mismo servicio externo, cada módulo debe usar un nombre de `service:` propio que refleje su bounded context** (ej: `OrderCustomerService` en `orders`, `DeliveryCustomerService` en `deliveries`). Reutilizar el mismo nombre (`CustomerService`) en módulos distintos causa colisión de beans Spring (`ConflictingBeanDefinitionException`) porque el generador produce un `FeignAdapter` con el mismo nombre de clase en cada módulo
- **`baseUrl:`** — declarar solo en la primera entrada de cada `service:`; si se omite en todas → warning + `http://localhost:8080`
- **`body:`** — solo en POST/PUT/PATCH; en GET/DELETE emite warning y se ignora
- **`domainType:`** — sobrescribe el tipo de dominio auto-derivado del nombre del método (ej: `domainType: Seat` en `findAvailableSeats`)
- **`returnList: true`** — el tipo de retorno es `List<{DomainType}>` en la interfaz y `List<{InfraDto}>` en el FeignClient (default: `false`)
- **`nestedTypes:`** — records auxiliares en `application/dtos/`; mismo patrón que `listeners:`
- **`fields:` omitido** → retorno `void` en interfaz y FeignClient

**Contraste async vs sync:**
```
aggregates:
  └── events:     → Domain Events que PRODUCE  (async, broker)
listeners:          → Integration Events que CONSUME (async, broker)
ports:              → Servicios HTTP que LLAMA    (sync, Feign)
readModels:         → Proyecciones locales mantenidas por eventos (async, broker)
```

### Proyecciones Locales (`readModels[]`)

Un Read Model es una **proyección local de datos de otro bounded context**, mantenida mediante eventos de dominio. Elimina dependencias síncronas (HTTP) entre módulos, mejorando autonomía, resiliencia y rendimiento.

```yaml
# Nivel raíz, sibling de aggregates:, listeners:, ports:
readModels:
  - name: ProductReadModel               # PascalCase + sufijo "ReadModel" (OBLIGATORIO)
    source:                              # Trazabilidad al módulo fuente (OBLIGATORIO)
      module: products                   # Módulo fuente (kebab-case)
      aggregate: Product                 # Agregado fuente (PascalCase)
    tableName: rm_products               # Tabla en BD (OBLIGATORIO, prefijo rm_)
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

### Artefactos generados por `readModels[]`

Por cada read model:

| Archivo generado | Descripción |
|---|---|
| `domain/models/readmodels/{Name}.java` | Clase de dominio (inmutable, sin setters, sin auditoría) |
| `infrastructure/database/entities/{Name}Jpa.java` | Entidad JPA (Lombok, `@Id` NO auto-generado) |
| `infrastructure/database/repositories/{Name}JpaRepository.java` | Spring Data JPA interface |
| `domain/repositories/{Name}Repository.java` | Interfaz de repositorio (puerto) |
| `infrastructure/database/repositories/{Name}RepositoryImpl.java` | Implementación del repositorio |
| `application/usecases/Sync{Source}ReadModelHandler.java` | Handler de sincronización (un método por evento) |

Por cada entrada en `syncedBy`:

| Archivo generado | Descripción |
|---|---|
| `application/events/{EventBase}IntegrationEvent.java` | Integration Event (reutilizado si ya existe) |
| `infrastructure/kafkaListener/{EventBase}ReadModelListener.java` | Kafka listener que delega al sync handler |
| `parameters/*/kafka.yaml` | Registro del topic (actualizado) |

### Acciones de sincronización

| Acción | Significado | Uso |
|---|---|---|
| `UPSERT` | Insertar si es nuevo, actualizar si existe | Creaciones, actualizaciones, cambios de estado |
| `DELETE` | Eliminar el registro permanentemente | Hard deletes en el módulo fuente |
| `SOFT_DELETE` | Marcar como inactivo con timestamp | Cuando el fuente usa soft delete |

### Reglas de `readModels[]`

- **`name:`** — PascalCase, **DEBE** terminar con `ReadModel`
- **`tableName:`** — **DEBE** empezar con `rm_` (identificación visual en BD)
- **`fields:`** — **DEBE** incluir un campo `id`
- **`syncedBy:`** — **DEBE** tener al menos una entrada
- **`source.module:`** — **NO PUEDE** ser el mismo módulo actual (readModels son para proyecciones cross-module)
- **Topic derivado automáticamente** — Se deriva del nombre del evento: strip sufijo `Event` → SCREAMING_SNAKE_CASE. Override opcional con `topic:` explícito
- **Sin auditoría** — Los readModels **nunca** tienen campos de auditoría
- **Sin endpoints REST** — Los readModels **nunca** exponen endpoints REST
- **Sin lógica de negocio** — La clase de dominio es inmutable (solo getters)

### Validaciones

| Código | Severidad | Regla |
|---|---|---|
| RM-001 | ERROR | `name` debe terminar con `ReadModel` |
| RM-002 | ERROR | `tableName` debe empezar con `rm_` |
| RM-004 | ERROR | `fields` debe incluir un campo `id` |
| RM-005 | ERROR | `syncedBy` debe tener al menos una entrada |
| RM-006 | ERROR | `syncedBy[].action` debe ser `UPSERT`, `DELETE` o `SOFT_DELETE` |
| RM-009 | WARNING | `ports:` todavía tiene llamadas sync al mismo `source.module` — considerar removerlas |
| RM-010 | ERROR | `source.module` es el mismo módulo actual |

Cuando una entidad tiene `hasSoftDelete: true`, eva4j genera eliminación lógica en lugar de física.

### Configuración en domain.yaml

```yaml
entities:
  - name: product
    isRoot: true
    tableName: products
    hasSoftDelete: true          # ✅ Activa soft delete
    audit:
      enabled: true
    fields:
      - name: id
        type: String
      - name: name
        type: String
```

### Comportamiento generado

```java
// Entidad JPA — filtrado automático con @SQLRestriction
@Entity
@SQLRestriction("deleted_at IS NULL")
public class ProductJpa extends AuditableEntity {
    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;
}
```

```java
// Entidad de dominio — método de negocio
public class Product {
    private LocalDateTime deletedAt;

    public void softDelete() {
        if (this.deletedAt != null) {
            throw new IllegalStateException("Product is already deleted");
        }
        this.deletedAt = LocalDateTime.now();
    }

    public boolean isDeleted() {
        return this.deletedAt != null;
    }
}
```

### Reglas para Agentes

- **SOLO** aplicar `hasSoftDelete: true` en la **entidad raíz** del agregado (`isRoot: true`)
- **NUNCA** poner `hasSoftDelete: true` en entidades secundarias — el ciclo de vida de estas lo controla la raíz mediante `cascade`; si se ignora, el generador emite un warning y descarta el flag
- **NUNCA** usar `repository.deleteById()` cuando hay soft delete
- **SIEMPRE** usar `entity.softDelete()` + `repository.save(entity)`
- **NUNCA** exponer `deletedAt` en ResponseDtos
- **SIEMPRE** usar `@SQLRestriction("deleted_at IS NULL")` en la entidad JPA

---

## ⏱️ Temporal Workflows

Cuando se agrega soporte de Temporal con `eva add temporal-client`, se genera infraestructura para workflows duraderos.

### Archivos generados por `eva g temporal-flow <module>`

```
[module]/
├── application/workflows/
│   ├── OrderWorkflow.java          # Interface (@WorkflowInterface)
│   └── OrderWorkflowImpl.java      # Implementación (determinista)
└── infrastructure/temporal/
    ├── activities/
    │   ├── OrderActivity.java          # Interface (@ActivityInterface)
    │   └── OrderActivityImpl.java      # Implementación (con I/O)
    └── workers/
        └── OrderWorker.java            # Registro del worker
```

### Principios clave

- Los **Workflows deben ser deterministas** — sin `Math.random()`, `new Date()`, ni I/O
- Toda operación con efectos secundarios (DB, HTTP, emails) va en **Activities**
- Los **Use Cases** orquestan los workflows; las **Activities** ejecutan infraestructura
- Configuración de conexión en `resources/parameters/{env}/temporal.yaml`

### Templates relacionados en eva4j

- `templates/temporal-flow/` — workflow interface e implementación
- `templates/temporal-activity/` — activity interface, implementación y worker

---

## �🚨 Errores Comunes a Evitar

### ❌ NO Crear Constructor Vacío en Dominio

```java
// ❌ INCORRECTO
public class User {
    public User() {  // NO HACER
    }
}

// ✅ CORRECTO
public class User {
    public User(String username, String email) {
        this.username = username;
        this.email = email;
    }
}
```

### ❌ NO Agregar Setters en Dominio

```java
// ❌ INCORRECTO
public void setUsername(String username) {
    this.username = username;
}

// ✅ CORRECTO
public void changeUsername(String newUsername) {
    if (newUsername == null || newUsername.isEmpty()) {
        throw new IllegalArgumentException("Username cannot be empty");
    }
    this.username = newUsername;
}
```

### ❌ NO Mapear Campos de Auditoría

```java
// ❌ INCORRECTO
public UserJpa toJpa(User domain) {
    return UserJpa.builder()
        .id(domain.getId())
        .createdBy(domain.getCreatedBy())  // NO HACER
        .updatedBy(domain.getUpdatedBy())  // NO HACER
        .build();
}

// ✅ CORRECTO
public UserJpa toJpa(User domain) {
    return UserJpa.builder()
        .id(domain.getId())
        // NO mapear campos de auditoría
        .build();
}
```

### ❌ NO Exponer createdBy/updatedBy en DTOs

```java
// ❌ INCORRECTO
public record UserResponseDto(
    String id,
    String username,
    String createdBy,   // NO exponer
    String updatedBy    // NO exponer
) {}

// ✅ CORRECTO
public record UserResponseDto(
    String id,
    String username,
    LocalDateTime createdAt,   // SÍ exponer
    LocalDateTime updatedAt    // SÍ exponer
) {}
```

---

## 📚 Referencia de Tipos

### Tipos de Datos Soportados

| Tipo YAML | Tipo Java | Observaciones |
|-----------|-----------|---------------|
| String | String | Texto |
| Integer | Integer | Números enteros |
| Long | Long | Números enteros largos |
| BigDecimal | BigDecimal | Precisión decimal |
| Boolean | Boolean | true/false |
| LocalDate | LocalDate | Fecha sin hora |
| LocalDateTime | LocalDateTime | Fecha y hora |
| LocalTime | LocalTime | Solo hora |
| Instant | Instant | Timestamp UTC |
| UUID | UUID | Identificador único |

### Propiedades de Campo

Los campos en domain.yaml soportan las siguientes propiedades:

| Propiedad | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `name` | String | - | Nombre del campo (obligatorio) |
| `type` | String | - | Tipo de dato Java (obligatorio) |
| `annotations` | Array | `[]` | Anotaciones JPA personalizadas |
| `isValueObject` | Boolean | `false` | Marca explícita de Value Object |
| `isEmbedded` | Boolean | `false` | Marca explícita de @Embedded |
| `enumValues` | Array | `[]` | Valores inline de enum |
| **`readOnly`** | Boolean | `false` | **Excluye del constructor de negocio y CreateDto** |
| **`hidden`** | Boolean | `false` | **Excluye del ResponseDto** |
| **`defaultValue`** | String/Number/Boolean | `null` | **Valor inicial en el constructor de creación (solo para `readOnly`)** |
| **`validations`** | Array | `[]` | **Anotaciones JSR-303 en el Command y CreateDto** |
| **`reference`** | Object | `null` | **Declara referencia semántica a otro agregado (genera comentario Javadoc)** |

#### Flags de Visibilidad: `readOnly` y `hidden`

**`readOnly: true`** - Campos calculados/derivados
- ❌ Excluido de: Constructor de negocio, CreateDto
- ✅ Incluido en: Constructor completo, ResponseDto
- **Uso:** Totales calculados, contadores, campos derivados

```yaml
fields:
  - name: totalAmount
    type: BigDecimal
    readOnly: true        # Calculado de la suma de items
```

**`hidden: true`** - Campos sensibles/internos
- ❌ Excluido de: ResponseDto
- ✅ Incluido en: Constructor de negocio, CreateDto
- **Uso:** Passwords, tokens, secrets, información sensible

```yaml
fields:
  - name: passwordHash
    type: String
    hidden: true          # No exponer en API
```

**Matriz de comportamiento:**

| Campo | Constructor Negocio | CreateDto | ResponseDto |
|-------|---------------------|-----------|-------------|
| Normal | ✅ | ✅ | ✅ |
| `readOnly: true` | ❌ | ❌ | ✅ |
| `readOnly` + `defaultValue` | ⚡ Asignado con default | ❌ | ✅ |
| `hidden: true` | ✅ | ✅ | ❌ |
| Ambos flags | ❌ | ❌ | ❌ |

#### 🎯 `defaultValue` - Valor Inicial para campos `readOnly`

Cuando un campo `readOnly` tiene un valor inicial predecible (ej: contadores, estados iniciales), se puede declarar en `domain.yaml` con `defaultValue`. El generador emite la asignación en el **constructor de creación** del dominio y `@Builder.Default` en la entidad JPA.

```yaml
fields:
  - name: totalAmount
    type: BigDecimal
    readOnly: true
    defaultValue: "0.00"        # ✅ Acumulador inicializado

  - name: status
    type: OrderStatus
    readOnly: true
    defaultValue: PENDING        # ✅ Estado inicial del enum

  - name: itemCount
    type: Integer
    readOnly: true
    defaultValue: 0              # ✅ Contador inicializado
```

```java
// Constructor de creación — defaultValues aplicados
public Order(String orderNumber, String customerId) {
    this.orderNumber = orderNumber;
    this.customerId = customerId;
    this.totalAmount = new BigDecimal("0.00");  // ← defaultValue
    this.status = OrderStatus.PENDING;           // ← defaultValue
    this.itemCount = 0;                          // ← defaultValue
}
```

```java
// JPA — @Builder.Default para respetar el valor en el builder
@Builder.Default
private BigDecimal totalAmount = new BigDecimal("0.00");

@Enumerated(EnumType.STRING)
@Builder.Default
private OrderStatus status = OrderStatus.PENDING;
```

**Restricción:** `defaultValue` **solo aplica** a campos con `readOnly: true`. Usarlo en un campo no-readOnly genera un warning y es ignorado.

---

**Ejemplo práctico:**
```yaml
entities:
  - name: order
    fields:
      - name: orderNumber
        type: String                # ✅ Normal - en todos lados
      
      - name: totalAmount
        type: BigDecimal
        readOnly: true              # ⚙️ Calculado - no en constructor
      
      - name: processingToken
        type: String
        hidden: true                # 🔒 Sensible - no en respuesta
      
      - name: internalFlag
        type: Boolean
        readOnly: true              # 🔐 Calculado Y sensible
        hidden: true
```

### Validaciones JSR-303 (`validations`)

Se declaran en el campo y se aplican **únicamente** en el `Command` y `CreateDto` de la capa de aplicación. **Nunca** en las entidades de dominio.

```yaml
fields:
  - name: email
    type: String
    validations:
      - type: NotBlank
        message: "Email es requerido"
      - type: Email
        message: "Email inválido"

  - name: username
    type: String
    validations:
      - type: Size
        min: 3
        max: 50
        message: "Username entre 3 y 50 caracteres"

  - name: age
    type: Integer
    validations:
      - type: Min
        value: 18
      - type: Max
        value: 120

  - name: price
    type: BigDecimal
    validations:
      - type: Positive
```

**Anotaciones disponibles:** `NotNull`, `NotBlank`, `NotEmpty`, `Email`, `Size` (min/max), `Min` (value), `Max` (value), `Pattern` (regexp), `Digits` (integer/fraction), `Positive`, `PositiveOrZero`, `Negative`, `Past`, `Future`, `AssertTrue`, `AssertFalse`.

**Código generado en `CreateUserCommand.java`:**
```java
public record CreateUserCommand(
    @NotBlank(message = "Email es requerido")
    @Email(message = "Email inválido")
    String email,

    @Size(min = 3, max = 50, message = "Username entre 3 y 50 caracteres")
    String username
) implements Command {}
```

### Referencias entre Agregados (`reference`)

Declara explícitamente que un campo es un ID de otro agregado. El tipo Java **no cambia** — sigue siendo `String`, `Long`, etc. — pero se genera un comentario Javadoc que documenta la dependencia. **No genera `@ManyToOne`** (correcto en DDD: cada agregado es una unidad transaccional independiente).

```yaml
fields:
  - name: customerId
    type: String
    reference:
      aggregate: Customer    # Nombre del agregado referenciado (PascalCase)
      module: customers      # Módulo donde vive (opcional si es el mismo módulo)

  - name: productId
    type: String
    reference:
      aggregate: Product
      module: catalog
```

**Código generado:**
```java
// En Order.java (domain entity)
/** Cross-aggregate reference → Customer (module: customers) */
private String customerId;

// En OrderJpa.java
@Column(name = "customer_id")
/** Cross-aggregate reference → Customer (module: customers) */
private String customerId;
```

### Tipos de Relaciones

- `OneToOne` - Relación uno a uno
- `OneToMany` - Relación uno a muchos
- `ManyToOne` - Relación muchos a uno
- `ManyToMany` - Relación muchos a muchos (evitar si es posible)

---

## 🎯 Mejores Prácticas para Agentes

### Al Generar domain.yaml (Flujo SDD)

1. **SIEMPRE** incluir campo `id` en todas las entidades
2. **SI** el módulo requiere ciclo de vida → usar `transitions` + `initialValue` en el enum
3. **SI** un valor tiene lógica de negocio → declararlo como `valueObject` con `methods`
4. **SI** ocurren hechos relevantes de negocio → declarar `events[]` en el agregado
5. **SI** el módulo expone endpoints REST específicos → declarar `endpoints:` con versiones y operaciones
6. **DESPUÉS** de generar el `domain.yaml` → ejecutar `eva g entities <module>`

### Al Usar `endpoints:` en domain.yaml

1. **SIEMPRE** declarar `endpoints:` cuando el API REST tiene comportamientos custom (confirmar, cancelar, activar, etc.)
2. **NUNCA** usar `endpoints:` si solo necesitas CRUD estándar — el flujo interactivo es más simple
3. **SIEMPRE** usar PascalCase para los nombres de `useCase` (ej: `ConfirmOrder`, no `confirmOrder`)
4. **CONOCER** cuáles son los 5 use cases estándar por aggregate: `Create{E}`, `Update{E}`, `Delete{E}`, `Get{E}`, `FindAll{Plural(E)}` — estos generan implementación completa (e.g. `FindAllOrders`, `FindAllDeliveries`, `FindAllCategories`)
5. **SABER** que cualquier otro nombre genera un **scaffold** con `UnsupportedOperationException` — el desarrollador debe implementar el handler
6. **APLICAR** la regla anti-duplicado: si el mismo useCase aparece en v1 y v2, se genera solo una vez
7. **NOMBRAR** los controladores según la convención: `{Aggregate}{VersionCapitalized}Controller` (ej: `OrderV1Controller`)

### Al Generar Código de Dominio

1. **NUNCA** crear constructor vacío en entidades de dominio
2. **NUNCA** agregar setters públicos
3. **SIEMPRE** crear métodos de negocio para modificar estado
4. **SIEMPRE** validar en métodos de negocio, no en constructores
5. **SIEMPRE** mantener inmutabilidad en Value Objects

### Al Generar Código JPA

1. **SIEMPRE** usar Lombok (`@Getter`, `@Setter`, `@Builder`)
2. **SIEMPRE** extender clase base correcta según auditoría
3. **NUNCA** incluir campos de auditoría heredados en `@Builder`
4. **SIEMPRE** usar `@NoArgsConstructor` para JPA

### Al Generar Mappers

1. **NUNCA** mapear campos de auditoría (createdAt, updatedAt, createdBy, updatedBy)
2. **NUNCA** mapear campos readOnly en métodos de creación (fromCommand, fromDto)
3. **NUNCA** mapear campos hidden en métodos de respuesta (toDto, toResponseDto)
4. **SIEMPRE** filtrar campos antes de usar `.builder()`
5. **SIEMPRE** mapear bidireccionalidad en relaciones

### Al Generar DTOs

1. **NUNCA** exponer `createdBy` y `updatedBy` en respuestas
2. **NUNCA** incluir campos `readOnly` en CreateDto
3. **NUNCA** incluir campos `hidden` en ResponseDto
4. **SIEMPRE** usar Java Records para DTOs
5. **SIEMPRE** filtrar campos según flags de visibilidad

---

## 🔄 Flujo de Datos

### Escritura (Command)

```
HTTP Request
    ↓
Controller (REST)
    ↓
CommandHandler (Application)
    ↓
ApplicationMapper (DTO → Domain)
    ↓
Domain Entity (Business Logic)
    ↓
Repository Interface (Domain)
    ↓
RepositoryImpl (Infrastructure)
    ↓
AggregateMapper (Domain → JPA)
    ↓
JPA Repository
    ↓
Database
```

### Lectura (Query)

```
HTTP Request
    ↓
Controller (REST)
    ↓
QueryHandler (Application)
    ↓
Repository Interface (Domain)
    ↓
RepositoryImpl (Infrastructure)
    ↓
JPA Repository
    ↓
AggregateMapper (JPA → Domain)
    ↓
ApplicationMapper (Domain → DTO)
    ↓
HTTP Response (sin createdBy/updatedBy)
```

---

## 🧪 Testing

### Tests de Dominio (Unidad Pura)

```java
@Test
void shouldCreateUserWithValidData() {
    User user = new User("john", "john@example.com");

    assertEquals("john", user.getUsername());
    assertEquals("john@example.com", user.getEmail());
}

@Test
void shouldValidateBusinessRules() {
    User user = new User("john", "john@example.com");

    assertThrows(IllegalArgumentException.class, () -> {
        user.changeEmail("invalid-email");
    });
}
```

### Object Mother Pattern

```java
// src/test/java/[package]/user/domain/UserMother.java
public class UserMother {

    public static User valid() {
        return new User("john_doe", "john@example.com");
    }

    public static User withEmail(String email) {
        return new User("john_doe", email);
    }
}
```

### Repositorio Fake (In-Memory)

Para testear Use Cases sin base de datos:

```java
public class UserRepositoryFake implements UserRepository {
    private final Map<String, User> store = new HashMap<>();

    @Override
    public User save(User user) {
        store.put(user.getId(), user);
        return user;
    }

    @Override
    public Optional<User> findById(String id) {
        return Optional.ofNullable(store.get(id));
    }

    public int count() { return store.size(); }
}
```

### Tests de Use Cases

```java
class CreateUserCommandHandlerTest {
    private final UserRepositoryFake userRepository = new UserRepositoryFake();
    private final CreateUserCommandHandler handler =
        new CreateUserCommandHandler(userRepository);

    @Test
    void shouldCreateUser() {
        CreateUserCommand command = new CreateUserCommand("john", "john@example.com");

        String userId = handler.handle(command);

        assertNotNull(userId);
        assertEquals(1, userRepository.count());
    }
}
```

### Estrategia por Capa

| Capa | Tipo de Test | Framework |
|------|--------------|-----------|
| Domain entities | Unidad pura | JUnit 5 |
| Use cases | Unidad con Fakes | JUnit 5 + Fake repos |
| Application mappers | Unidad | JUnit 5 |
| Repository implementations | Integración | Testcontainers |
| REST controllers | Integración | MockMvc |

---

## 📖 Documentos Relacionados

- **[DOMAIN_YAML_GUIDE.md](DOMAIN_YAML_GUIDE.md)** - Guía completa de sintaxis YAML
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Referencia rápida de comandos
- **[FUTURE_FEATURES.md](FUTURE_FEATURES.md)** - Características planeadas
- **[README.md](README.md)** - Documentación general

---

## ✅ Checklist para Agentes

Al generar o modificar código, verificar:

**Entidades de Dominio:**
- [ ] Entidades de dominio **sin constructor vacío**
- [ ] Entidades de dominio **sin setters públicos**
- [ ] Métodos de negocio con **validaciones explícitas**
- [ ] Value Objects **inmutables**
- [ ] Sin anotaciones JSR-303 en entidades de dominio

**Entidades JPA:**
- [ ] Entidades JPA con **Lombok y herencia correcta**
- [ ] `@SQLRestriction("deleted_at IS NULL")` cuando `hasSoftDelete: true`
- [ ] No incluye campos de auditoría heredados en `@Builder`

**Mappers:**
- [ ] Mappers **excluyen campos de auditoría**
- [ ] Mappers **excluyen campos readOnly en creación**
- [ ] Mappers **excluyen campos hidden en respuestas**
- [ ] Relaciones bidireccionales con métodos `assign*()`

**DTOs:**
- [ ] DTOs de respuesta **sin createdBy/updatedBy**
- [ ] DTOs de respuesta **sin campos hidden**
- [ ] DTOs de creación **sin campos readOnly**
- [ ] Usando Java Records

**Validaciones:**
- [ ] Validaciones JSR-303 **solo en Command y CreateDto, nunca en dominio**
- [ ] `@Valid` en parámetros de endpoints REST

**Auditoría:**
- [ ] Configuración de auditoría cuando `trackUser: true`
- [ ] `@EnableJpaAuditing` con `auditorAwareRef = "auditorProvider"` en Application

**Soft Delete (cuando aplica):**
- [ ] Usar `entity.softDelete()` + `repository.save()` — nunca `deleteById()`
- [ ] `deletedAt` no expuesto en ResponseDto

**Características Avanzadas (cuando aplica):**
- [ ] Enum con ciclo de vida → usar `transitions` + `initialValue`, no setters manuales
- [ ] Value Object con comportamiento → declarar `methods` en lugar de lógica en entidad
- [ ] Evento de dominio → declarar en `events[]`, publicar con `raise()` en método de negocio
- [ ] Evento con `triggers: [methodName]` → el generador emite `raise()` automáticamente; args no resolubles quedan como `null /* TODO */`
- [ ] Evento con `lifecycle: create` → el generador emite UUID auto-generado + `raise()` en el constructor de creación
- [ ] Evento con `lifecycle: update` → el generador emite método `update()` en la entidad raíz con `raise()` interno; handler llama `existing.update(...)`; `raise()` permanece `protected`
- [ ] Evento con `lifecycle: delete` → el generador emite `raise()` en DeleteCommandHandler + genera `repository.delete(entity)` con publicación de eventos; `raise()` se genera como `public`
- [ ] Evento con `lifecycle: softDelete` → el generador emite `raise()` dentro del método `softDelete()` de la entidad; requiere `hasSoftDelete: true`
- [ ] Un evento puede declarar `triggers` O `lifecycle`, no ambos
- [ ] Campos de lifecycle events son campos de la entidad raíz (excluyendo `{entityName}Id` y `*At` temporal) — `C2-010`
- [ ] Sin `triggers` ni `lifecycle` en el evento → el dev llama a `raise()` manualmente
- [ ] Evento con broker → **no** usar `kafka: true`; si `eva add kafka-client` está instalado, `eva g entities` auto-cablea todos los eventos
- [ ] Distinguir entre Domain Event (`domain/models/events/X.java`) e Integration Event (`application/events/XIntegrationEvent.java`) — cambios de broker solo afectan al adaptador `MessageBroker`
- [ ] Consumo de eventos externos → declarar en `listeners[]` (nivel raíz); `topic:` obligatorio en módulos standalone
- [ ] Cada `listener` genera hasta 6 artefactos: NestedType(s) → IntegrationEvent → KafkaListener → kafka.yaml → Command → CommandHandler
- [ ] Varios módulos pueden consumir el mismo evento Kafka sin colisión — el generador califica el bean automáticamente con `@Component("moduleName.listenerClassName")`
- [ ] Campos de tipo objeto en listeners → declarar `nestedTypes:` para generar records auxiliares en `application/events/`
- [ ] Endpoints REST específicos → declarar `endpoints:` con versiones y operaciones; usar nombres estándar para implementación completa
- [ ] Clientes HTTP síncronos → declarar en `ports[]` (nivel raíz); `baseUrl:` en la primera entrada de cada `service:`
- [ ] Si varios módulos llaman al mismo servicio → cada uno usa un `service:` con nombre propio del bounded context (ej: `OrderCustomerService`, `DeliveryCustomerService`) — nunca el mismo nombre genérico en módulos distintos
- [ ] Métodos con respuesta → incluir `fields:` en la entrada del puerto; sin `fields:` = retorno `void`
- [ ] Respuestas en lista → agregar `returnList: true` en el método correspondiente
- [ ] Métodos con cuerpo (POST/PUT/PATCH) → incluir `body:`; campos de tipo objeto en `nestedTypes:`
- [ ] Tipo de dominio auto-derivado del nombre del método — usar `domainType:` para sobrescribir si es necesario
- [ ] Cada `service:` en `ports[]` genera: interfaz (devuelve modelos de dominio), FeignClient (devuelve DTOs infra), FeignAdapter (mapea ACL), FeignConfig + `urls.yaml`
- [ ] Read models → declarar en `readModels[]` (nivel raíz); `name` debe terminar con `ReadModel`, `tableName` debe empezar con `rm_`
- [ ] Read models nunca tienen auditoría, endpoints REST, ni lógica de negocio
- [ ] Cada read model genera: clase de dominio inmutable, JPA entity (sin audit), repositorio (interface + impl), sync handler
- [ ] Cada `syncedBy` entry genera: IntegrationEvent (reutilizado si ya existe), KafkaListener, registro de topic
- [ ] `source.module` nunca puede ser el mismo módulo (RM-010) — readModels son exclusivamente cross-module
- [ ] ReadModel fields cubiertos por eventos UPSERT del productor — `C1-007`
- [ ] ReadModel fields son subconjunto de los campos de la entidad raíz fuente (por C2-010, los lifecycle events no pueden emitir campos ajenos)
- [ ] Topics de readModels se derivan automáticamente del nombre del evento (strip `Event` → SCREAMING_SNAKE_CASE)

---

**Última actualización:** 2026-03-24  
**Versión de eva4j:** 1.0.15  
**Estado:** Documento de referencia para agentes IA
