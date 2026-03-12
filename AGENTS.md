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
    events:
      - name: OrderConfirmed
        fields:
          - name: orderId
            type: String
          - name: confirmedAt
            type: LocalDateTime
```

Genera `OrderConfirmed.java` (en `domain/models/events/`) que extiende `DomainEvent`, y `OrderDomainEventHandler.java` (en `application/usecases/`) con `@TransactionalEventListener(AFTER_COMMIT)`.

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

### Consumo de Eventos Externos (`listeners[]`)

```yaml
# Nivel raíz, sibling de aggregates:
listeners:
  - event: PaymentApprovedEvent    # PascalCase + sufijo Event
    producer: payments             # Módulo que lo produce (referencia documental)
    topic: PAYMENT_APPROVED        # Topic Kafka — obligatorio en módulos standalone
    useCase: ConfirmOrder          # Caso de uso que maneja el evento (PascalCase)
    fields:                        # Payload del Integration Event recibido
      - name: orderId
        type: String
      - name: approvedAt
        type: LocalDateTime
```

Genera por cada entrada:

| Archivo generado | Descripción |
|---|---|
| `application/events/PaymentApprovedIntegrationEvent.java` | Record tipado con los `fields` declarados |
| `infrastructure/kafkaListener/PaymentApprovedKafkaListener.java` | `@KafkaListener` que despacha al `useCase` vía `UseCaseMediator` |

**Regla de `topic:`:**
- Módulo standalone (sin `system.yaml`) → `topic:` **obligatorio**
- Proyecto con `system.yaml` → puede omitirse; el generador lo infiere de `integrations.async[].topic`
- Declarado explícitamente → tiene **precedencia** sobre la inferencia

**Contraste eventos producidos vs. consumidos:**
```
aggregates:
  └── events:     → Domain Events que PRODUCE (domain/models/events/)

listeners:          → Integration Events que CONSUME (infrastructure/kafkaListener/)
```

---

## 🗑️ Soft Delete

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
4. **CONOCER** cuáles son los 5 use cases estándar por aggregate: `Create{E}`, `Update{E}`, `Delete{E}`, `Get{E}`, `FindAll{E}s` — estos generan implementación completa
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
- [ ] Evento con broker → **no** usar `kafka: true`; si `eva add kafka-client` está instalado, `eva g entities` auto-cablea todos los eventos
- [ ] Distinguir entre Domain Event (`domain/models/events/X.java`) e Integration Event (`application/events/XIntegrationEvent.java`) — cambios de broker solo afectan al adaptador `MessageBroker`
- [ ] Consumo de eventos externos → declarar en `listeners[]` (nivel raíz); `topic:` obligatorio en módulos standalone
- [ ] Cada `listener` genera: `XIntegrationEvent.java` (record) + `XKafkaListener.java` (@KafkaListener con dispatch al `useCase`)
- [ ] Endpoints REST específicos → declarar `endpoints:` con versiones y operaciones; usar nombres estándar para implementación completa

---

**Última actualización:** 2026-03-11  
**Versión de eva4j:** 1.0.13  
**Estado:** Documento de referencia para agentes IA
