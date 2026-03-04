# Guía Completa: domain.yaml

## 📋 Tabla de Contenidos

- [Introducción](#introducción)
  - [¿Qué genera automáticamente?](#qué-genera-automáticamente)
  - [Buenas Prácticas de DDD Implementadas](#buenas-prácticas-de-ddd-implementadas)
- [Estructura General](#estructura-general)
- [Definición de Agregados](#definición-de-agregados)
- [Entidades](#entidades)
- [Value Objects](#value-objects)
- [Enums](#enums)
- [Validaciones JSR-303](#validaciones-jsr-303)
- [Relaciones](#relaciones)
- [Tipos de Datos](#tipos-de-datos)
- [Ejemplos Completos](#ejemplos-completos)

---

## Introducción

El archivo `domain.yaml` es el centro de la generación automática de código en eva4j. Define la estructura completa de tu dominio siguiendo los principios de Domain-Driven Design (DDD).

### ¿Qué genera automáticamente?

Para cada agregado definido, eva4j genera:

**Capa de Dominio (Pure Java):**
- ✅ Entidad raíz del agregado (`Order.java`)
- ✅ Entidades secundarias (`OrderItem.java`)
- ✅ Value Objects (`Money.java`, `Address.java`)
- ✅ Enums (`OrderStatus.java`)
- ✅ Interfaz de repositorio (`OrderRepository.java`)

**Capa de Infraestructura (JPA + Lombok):**
- ✅ Entidades JPA (`OrderJpa.java`, `OrderItemJpa.java`)
- ✅ Value Objects JPA embebidos (`MoneyJpa.java`)
- ✅ Mapper bidireccional (`OrderMapper.java`)
- ✅ Repositorio JPA (`OrderJpaRepository.java`)
- ✅ Implementación de repositorio (`OrderRepositoryImpl.java`)

### Buenas Prácticas de DDD Implementadas

Las entidades de dominio generadas siguen estrictamente los principios de Domain-Driven Design:

**🔒 Encapsulación:**
- ❌ **No hay setters públicos** en entidades de dominio
- ✅ Estado modificable **solo mediante métodos de negocio**
- ✅ Protección de invariantes del dominio

**✅ Constructores sin Validaciones Automáticas:**
- Los constructores asignan valores directamente sin validaciones automáticas
- Las validaciones se implementarán en un release futuro mediante configuración en domain.yaml
- Por ahora, las validaciones deben implementarse manualmente en métodos de negocio según sea necesario

**📦 Inmutabilidad de Value Objects:**
- Campos declarados como `final`
- Sin setters, solo getters
- Correcta implementación de `equals()` y `hashCode()`

**🎯 Métodos de Negocio:**
- Para modificar estado, debes agregar métodos de negocio explícitos
- Relaciones `OneToMany` generan automáticamente métodos `add*()` y `remove*()`
- Relaciones `OneToOne` bidireccionales usan `assign*()` para mantener consistencia

**Ejemplo de entidad generada:**

```java
public class Order {
    private String orderNumber;
    private OrderStatus status;
    
    // Constructor sin validaciones automáticas
    public Order(String orderNumber, OrderStatus status) {
        this.orderNumber = orderNumber;
        this.status = status;
    }
    
    // Getters públicos
    public String getOrderNumber() { return orderNumber; }
    public OrderStatus getStatus() { return status; }
    
    // ❌ NO hay setters públicos
    
    // ✅ Métodos de negocio para modificar estado (agrega estos manualmente según tu lógica)
    public void confirm() {
        // Aquí puedes agregar validaciones según tus reglas de negocio
        if (this.orderNumber == null || this.orderNumber.isEmpty()) {
            throw new IllegalStateException("Cannot confirm order without order number");
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

**📝 Nota Importante:** Para modificar el estado de una entidad, debes agregar métodos de negocio personalizados que encapsulen la lógica y las reglas del dominio. Estos métodos pueden ser agregados manualmente después de la generación o definidos en tu archivo YAML si extends la funcionalidad.

---

## Estructura General

```yaml
aggregates:
  - name: NombreAgregado
    entities:
      # Array de entidades (una DEBE tener isRoot: true)
      - name: entityName
        isRoot: true          # Marca la entidad raíz del agregado
        tableName: table_name
        fields: []
        relationships: []
      
      - name: secondaryEntityName
        # Sin isRoot = entidad secundaria
        tableName: secondary_table
        fields: []
        relationships: []
    
    valueObjects:
      # Value Objects del agregado
      - name: ValueObjectName
        fields: []
    
    enums:
      # Enumeraciones del dominio
      - name: EnumName
        values: []
```

### Ubicación del archivo

```
tu-proyecto/
└── modules/
    └── tu-modulo/
        └── domain.yaml    ← Aquí
```

---

## Definición de Agregados

Un agregado es un conjunto de entidades y value objects que forman una unidad de consistencia.

### Sintaxis básica

```yaml
aggregates:
  - name: Order  # Nombre del agregado (PascalCase)
    entities:
      - name: order
        isRoot: true  # Marca la entidad raíz
        # ... configuración
```

### Nombre del agregado

- **`name`**: Nombre del agregado en PascalCase
- Se usa para:
  - Nombre del mapper: `OrderMapper.java`
  - Organización de archivos
  - Referencias en código generado

---

## Entidades

### Entidad Raíz (Aggregate Root)

La entidad raíz es el punto de entrada al agregado. Todas las operaciones deben pasar por ella.

**⚠️ Importante**: La entidad raíz se define dentro del array `entities` con `isRoot: true`.

```yaml
aggregates:
  - name: Order
    entities:
      - name: order              # Nombre de la entidad (camelCase o snake_case)
        isRoot: true             # ← OBLIGATORIO para marcar la raíz
        tableName: orders        # Nombre de la tabla en BD (opcional)
        
        fields:
          - name: id
            type: String         # String generará UUID, Long generará IDENTITY
            
          - name: orderNumber
            type: String
            
          - name: status
            type: OrderStatus    # Referencia a un enum
            
          - name: totalAmount
            type: Money          # Referencia a un value object
            
          - name: createdAt
            type: LocalDateTime
        
        relationships:
          - type: OneToMany
            target: OrderItem
            mappedBy: order
            cascade: [PERSIST, MERGE, REMOVE]
            fetch: LAZY
```

### Entidades Secundarias

Entidades que pertenecen al agregado pero no son la raíz. Se definen en el mismo array `entities` **sin** `isRoot` (o con `isRoot: false`).

```yaml
aggregates:
  - name: Order
    entities:
      # ... entidad raíz order con isRoot: true ...
      
      - name: orderItem          # ← Entidad secundaria
        tableName: order_items
        # Sin isRoot o isRoot: false = secundaria
        
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

### Campos (Fields)

#### Sintaxis

```yaml
fields:
  - name: fieldName          # Nombre del campo (camelCase) - OBLIGATORIO
    type: String             # Tipo de dato Java - OBLIGATORIO
```

**Propiedades soportadas:**
- `name`: Nombre del campo (obligatorio)
- `type`: Tipo de dato Java (obligatorio)
- `readOnly`: Excluye del constructor de negocio y CreateDto (ver [Control de Visibilidad](#control-de-visibilidad-de-campos))
- `hidden`: Excluye del ResponseDto
- `defaultValue`: Valor inicial para campos `readOnly` (ver [Ó `defaultValue`](#-defaultvalue-valor-inicial-para-campos-readonly))
- `validations`: Anotaciones JSR-303 en Command y CreateDto
- `reference`: Referencia semántica a otro agregado
- `annotations`: Anotaciones JPA personalizadas
- `isValueObject` / `isEmbedded`: Marcas explícitas de Value Object

#### Detección automática de tipos

eva4j detecta automáticamente el tipo de campo basándose **únicamente** en `type`:

**✅ Value Objects** - Detectados automáticamente
```yaml
fields:
  - name: totalAmount
    type: Money        # Si Money está en valueObjects → @Embedded automático
```

**✅ Enums** - Detectados automáticamente
```yaml
fields:
  - name: status
    type: OrderStatus  # Si OrderStatus está en enums → @Enumerated(STRING)
```

**✅ Tipos primitivos**
```yaml
fields:
  - name: name
    type: String       # → VARCHAR
  - name: age
    type: Integer      # → INTEGER
  - name: price
    type: BigDecimal   # → DECIMAL
```

**✅ Tipos de fecha** - Importados automáticamente
```yaml
fields:
  - name: createdAt
    type: LocalDateTime  # → timestamp + import java.time.LocalDateTime
```

**✅ Colecciones** - @ElementCollection automático
```yaml
fields:
  - name: tags
    type: List<String>   # → @ElementCollection con tabla secundaria
```

#### ❌ NO necesitas especificar

eva4j genera automáticamente las anotaciones JPA correctas:
- `@Embedded` para Value Objects
- `@Enumerated(EnumType.STRING)` para Enums
- `@ElementCollection` para listas
- Imports necesarios

#### ⚠️ REGLA OBLIGATORIA: Campo `id`

**Todas las entidades DEBEN tener un campo llamado exactamente `id`.**

```yaml
# ✅ CORRECTO - Todas las entidades tienen 'id'
entities:
  - name: order
    isRoot: true
    fields:
      - name: id          # ← OBLIGATORIO
        type: String      # String = UUID, Long = IDENTITY
      - name: orderNumber
        type: String
  
  - name: orderItem
    fields:
      - name: id          # ← OBLIGATORIO también en secundarias
        type: Long
      - name: productId
        type: String
```

**Razones:**
- ✅ JPA requiere `@Id` en todas las entidades
- ✅ Eva4j genera automáticamente `@Id` y `@GeneratedValue` para el campo `id`
- ✅ Convención clara y consistente en todo el dominio

**Tipos soportados para `id`:**
- `String` → Genera `@GeneratedValue(strategy = GenerationType.UUID)`
- `Long` → Genera `@GeneratedValue(strategy = GenerationType.IDENTITY)`

**❌ INCORRECTO:**
```yaml
# ❌ Sin campo 'id' - La aplicación fallará
fields:
  - name: orderNumber
    type: String
  # ← Falta el campo 'id'

# ❌ Nombre diferente - No funcionará
fields:
  - name: orderId     # ← Debe llamarse exactamente 'id'
    type: String
```

**💡 Identificadores de Negocio:**

Si necesitas un identificador de negocio además del ID técnico:

```yaml
fields:
  - name: id              # ← ID técnico (obligatorio)
    type: String
  - name: orderNumber     # ← ID de negocio (opcional)
    type: String
  - name: invoiceNumber   # ← Otro identificador de negocio
    type: String
```

---

#### Ejemplos correctos

```yaml
# Value Object
fields:
  - name: totalAmount
    type: Money              # ✅ Suficiente - eva4j detecta automáticamente

# Enum
fields:
  - name: status
    type: OrderStatus        # ✅ Suficiente - eva4j detecta automáticamente

# Tipo primitivo
fields:
  - name: description
    type: String             # ✅ Tipo básico

# Colección
fields:
  - name: tags
    type: List<String>       # ✅ @ElementCollection automático
```

---

### Control de Visibilidad de Campos

Eva4j permite controlar qué campos participan en constructores, DTOs de creación y DTOs de respuesta mediante dos flags opcionales: **`readOnly`** y **`hidden`**.

#### 📋 Matriz de Comportamiento

| Campo | Constructor Negocio | Constructor Completo | CreateDto | ResponseDto |
|-------|---------------------|----------------------|-----------|-------------|
| **Normal** | ✅ Incluido | ✅ Incluido | ✅ Incluido | ✅ Incluido |
| **`readOnly: true`** | ❌ Excluido | ✅ Incluido | ❌ Excluido | ✅ Incluido |
| **`readOnly` + `defaultValue`** | ⚡ Asignado con default | ✅ Incluido | ❌ Excluido | ✅ Incluido |
| **`hidden: true`** | ✅ Incluido | ✅ Incluido | ✅ Incluido | ❌ Excluido |
| **Ambos flags** | ❌ Excluido | ✅ Incluido | ❌ Excluido | ❌ Excluido |

#### 🔒 `readOnly: true` - Campos Calculados/Derivados

Marca campos que **se calculan internamente** y no deben pasarse como parámetros en constructores o DTOs de creación.

**Casos de uso típicos:**
- Totales calculados (suma de items)
- Contadores automáticos
- Campos derivados de otros datos
- Timestamps calculados

**Sintaxis:**
```yaml
fields:
  - name: totalAmount
    type: BigDecimal
    readOnly: true          # ✅ No en constructor ni CreateDto
```

**Ejemplo completo:**
```yaml
entities:
  - name: order
    isRoot: true
    tableName: orders
    audit:
      enabled: true
    fields:
      - name: id
        type: String
      - name: orderNumber
        type: String
      - name: customerId
        type: String
      # Campo readOnly - calculado de los items
      - name: totalAmount
        type: BigDecimal
        readOnly: true
      # Campo readOnly - contador de items
      - name: itemCount
        type: Integer
        readOnly: true
```

**Código generado:**
```java
// Constructor de negocio - SIN fields readOnly
public Order(String orderNumber, String customerId) {
    this.orderNumber = orderNumber;
    this.customerId = customerId;
    // totalAmount e itemCount NO están aquí
}

// Constructor completo - CON fields readOnly (reconstrucción desde DB)
public Order(String id, String orderNumber, String customerId,
             BigDecimal totalAmount, Integer itemCount, 
             LocalDateTime createdAt, LocalDateTime updatedAt) {
    // Todos los campos incluidos
}

// CreateDto - SIN fields readOnly
public record CreateOrderDto(
    String orderNumber,
    String customerId
    // totalAmount e itemCount NO están aquí
) {}

// ResponseDto - CON fields readOnly (mostrar valores calculados)
public record OrderResponseDto(
    String id,
    String orderNumber,
    String customerId,
    BigDecimal totalAmount,    // ✅ Incluido
    Integer itemCount,         // ✅ Incluido
    LocalDateTime createdAt,
    LocalDateTime updatedAt
) {}
```

#### 🎯 `defaultValue` - Valor Inicial para campos `readOnly`

Permite asignar un valor inicial predecible a un campo `readOnly` directamente en `domain.yaml`. El generador emite la asignación en el **constructor de creación** de la entidad de dominio y añade `@Builder.Default` en la entidad JPA.

**Restricción:** Solo aplica a campos `readOnly: true`. Si se usa sin `readOnly`, eva4j emite un warning y lo ignora.

**Casos de uso típicos:**
- Estado inicial de enums (`PENDING`, `ACTIVE`, `DRAFT`)
- Contadores que comienzan en cero
- Totales/acumuladores antes de cálculos
- Flags booleanos con estado conocido al crear

**Sintaxis:**
```yaml
fields:
  - name: totalAmount
    type: BigDecimal
    readOnly: true
    defaultValue: "0.00"        # ✅ BigDecimal literal

  - name: itemCount
    type: Integer
    readOnly: true
    defaultValue: 0              # ✅ Integer literal

  - name: status
    type: OrderStatus
    readOnly: true
    defaultValue: PENDING        # ✅ Enum value (sin comillas)

  - name: isActive
    type: Boolean
    readOnly: true
    defaultValue: true           # ✅ Boolean literal
```

**Código generado en la entidad de dominio:**
```java
// Constructor de creación — defaultValues asignados automáticamente
public Order(String orderNumber, String customerId) {
    this.orderNumber = orderNumber;
    this.customerId = customerId;
    this.totalAmount = new BigDecimal("0.00");  // ← defaultValue
    this.itemCount = 0;                          // ← defaultValue
    this.status = OrderStatus.PENDING;           // ← defaultValue
    this.isActive = true;                        // ← defaultValue
}

// Constructor completo (reconstrucción desde BD) — sin defaultValues
public Order(String id, String orderNumber, String customerId,
             BigDecimal totalAmount, Integer itemCount,
             OrderStatus status, Boolean isActive, ...) {
    // Todos los campos asignados desde parámetros
}
```

**Código generado en la entidad JPA:**
```java
@Builder.Default
private BigDecimal totalAmount = new BigDecimal("0.00");

@Builder.Default
private Integer itemCount = 0;

@Enumerated(EnumType.STRING)
@Builder.Default
private OrderStatus status = OrderStatus.PENDING;
```

**Tipos Java soportados y su forma de emisión:**

| Tipo | Ejemplo YAML | Literal Java emitido |
|------|-------------|----------------------|
| `String` | `defaultValue: hello` | `"hello"` |
| `Integer` | `defaultValue: 0` | `0` |
| `Long` | `defaultValue: 0` | `0L` |
| `Boolean` | `defaultValue: false` | `false` |
| `BigDecimal` | `defaultValue: "0.00"` | `new BigDecimal("0.00")` |
| `LocalDateTime` | `defaultValue: now` | `LocalDateTime.now()` |
| `LocalDate` | `defaultValue: now` | `LocalDate.now()` |
| `Instant` | `defaultValue: now` | `Instant.now()` |
| `UUID` | `defaultValue: random` | `UUID.randomUUID()` |
| Enum | `defaultValue: ACTIVE` | `EnumType.ACTIVE` |

**Compatibilidad con otros flags:**

| Combinación | Constructor Creación | JPA Builder | CreateDto | ResponseDto |
|------------|:-------------------:|:-----------:|:---------:|:-----------:|
| `readOnly` + `defaultValue` | ⚡ Asignado con default | `@Builder.Default` | ❌ | ✅ |
| `readOnly` + `hidden` + `defaultValue` | ⚡ Asignado con default | `@Builder.Default` | ❌ | ❌ |
| `defaultValue` sin `readOnly` | *Ignorado (warning)* | *Ignorado* | — | — |

#### 🙈 `hidden: true` - Campos Sensibles/Internos

Marca campos que **NO deben exponerse** en respuestas de API pero sí pueden recibirse en creación.

**Casos de uso típicos:**
- Passwords/hashes de seguridad
- Tokens internos
- Secrets y claves de API
- Información sensible (SSN, datos privados)
- Flags de control interno

**Sintaxis:**
```yaml
fields:
  - name: passwordHash
    type: String
    hidden: true           # ✅ No en ResponseDto
```

**Ejemplo completo:**
```yaml
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
      - name: email
        type: String
      # Campo hidden - NO en ResponseDto
      - name: passwordHash
        type: String
        hidden: true
      # Campo hidden - token interno
      - name: resetPasswordToken
        type: String
        hidden: true
```

**Código generado:**
```java
// Constructor de negocio - CON fields hidden
public User(String username, String email, 
            String passwordHash, String resetPasswordToken) {
    this.username = username;
    this.email = email;
    this.passwordHash = passwordHash;
    this.resetPasswordToken = resetPasswordToken;
}

// CreateDto - CON fields hidden (para recibirlos en creación)
public record CreateUserDto(
    String username,
    String email,
    String passwordHash,         // ✅ Se puede recibir
    String resetPasswordToken    // ✅ Se puede recibir
) {}

// ResponseDto - SIN fields hidden (proteger datos sensibles)
public record UserResponseDto(
    String id,
    String username,
    String email,
    LocalDateTime createdAt,
    LocalDateTime updatedAt
    // passwordHash y resetPasswordToken NO están aquí
) {}
```

#### 🔐 Combinando Ambos Flags

Puedes combinar `readOnly` y `hidden` para campos que son **calculados internamente Y sensibles**.

**Ejemplo:**
```yaml
fields:
  - name: isLocked
    type: Boolean
    readOnly: true     # Calculado internamente
    hidden: true       # NO exponer en API
```

**Resultado:**
- ❌ NO en constructor de negocio (es readOnly)
- ❌ NO en CreateDto (es readOnly)
- ❌ NO en ResponseDto (es hidden)
- ✅ SÍ en constructor completo (para reconstrucción desde DB)

#### 📘 Ejemplo Completo: Sistema de Órdenes

```yaml
aggregates:
  - name: Order
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
          
          # Campos normales
          - name: orderNumber
            type: String
          - name: customerId
            type: String
          - name: status
            type: String
          
          # Campos readOnly (calculados)
          - name: totalAmount
            type: BigDecimal
            readOnly: true               # Suma de items
          - name: itemCount
            type: Integer
            readOnly: true               # Cuenta de items
          
          # Campo hidden (interno)
          - name: processingToken
            type: String
            hidden: true                 # Token de procesamiento interno
          
          # Campo readOnly + hidden (calculado e interno)
          - name: riskScore
            type: Integer
            readOnly: true
            hidden: true                 # Puntaje de riesgo interno
```

**Constructor de negocio generado:**
```java
public Order(String orderNumber, String customerId, 
             String status, String processingToken) {
    // totalAmount, itemCount, riskScore NO están (readOnly)
    // processingToken SÍ está (solo hidden, no readOnly)
}
```

**CreateOrderDto generado:**
```java
public record CreateOrderDto(
    String orderNumber,
    String customerId,
    String status,
    String processingToken    // ✅ hidden pero SÍ en create
    // totalAmount, itemCount, riskScore NO están (readOnly)
) {}
```

**OrderResponseDto generado:**
```java
public record OrderResponseDto(
    String id,
    String orderNumber,
    String customerId,
    String status,
    BigDecimal totalAmount,   // ✅ readOnly pero SÍ en response
    Integer itemCount,        // ✅ readOnly pero SÍ en response
    LocalDateTime createdAt,
    LocalDateTime updatedAt
    // processingToken NO está (hidden)
    // riskScore NO está (hidden)
) {}
```

#### ⚡ Comportamiento por Defecto

Si no especificas `readOnly` ni `hidden`:
- ✅ El comportamiento actual se mantiene sin cambios
- ✅ Campos normales aparecen en todos lados
- ✅ Solo los campos de auditoría (`createdBy`, `updatedBy`) se excluyen automáticamente de ResponseDto

```yaml
# Sin flags - comportamiento estándar
fields:
  - name: productName
    type: String          # ✅ En constructor, CreateDto Y ResponseDto
```

#### 📚 Ver También

- **Ejemplo completo:** [examples/domain-field-visibility.yaml](../examples/domain-field-visibility.yaml)
- **Campos de auditoría:** Los campos `createdAt`, `updatedAt`, `createdBy`, `updatedBy` siguen su propio comportamiento especial definido en la sección de Auditoría

---

### Referencias entre Agregados (`reference:`)

La propiedad `reference:` declara explícitamente que un campo es un puntero intencional a la raíz de otro agregado. El campo sigue siendo un tipo primitivo (`String`, `Long`, etc.) — **no se genera ningún `@ManyToOne`**.

#### Sintaxis

```yaml
fields:
  - name: customerId
    type: String
    reference:
      aggregate: Customer   # Nombre del agregado referenciado (PascalCase) — obligatorio
      module: customers     # Módulo donde vive el agregado — opcional
  - name: productId
    type: String
    reference:
      aggregate: Product
      module: catalog
```

#### Comportamiento

- El tipo Java **no cambia** — sigue siendo `String`, `Long`, UUID, etc.
- JPA genera `@Column` normal — **sin** `@ManyToOne` ni `@JoinColumn`.
- En la entidad de dominio y en la entidad JPA se genera un **comentario Javadoc** que documenta la referencia.
- `module:` es opcional: puede omitirse si el agregado referenciado está en el mismo módulo.
- Si `reference:` está malformado (falta `aggregate`), eva4j lanza un error descriptivo.

#### Código Generado

```java
// domain/models/entities/Order.java
/** Cross-aggregate reference → Customer (module: customers) */
private String customerId;
```

```java
// infrastructure/database/entities/OrderJpa.java
@Column(name = "customer_id")
/** Cross-aggregate reference → Customer (module: customers) */
private String customerId;
```

#### Por qué no usar `@ManyToOne` entre agregados

En DDD cada agregado es una unidad transaccional independiente. Un `@ManyToOne` cruzando límites crea un único grafo JPA que viola los límites transaccionales y crea dependencias de carga invisibles. La referencia por ID es el patrón correcto: el handler que necesite los datos del otro agregado los obtiene explícitamente via su propio repositorio.

- **Ejemplo completo:** [examples/domain-multi-aggregate.yaml](../examples/domain-multi-aggregate.yaml)

---

### Validaciones JSR-303

Eva4j soporta anotaciones Bean Validation (JSR-303/Jakarta Validation) en campos del `domain.yaml`. Las validaciones se generan **únicamente en la capa de aplicación**: en el `Create<Aggregate>Command` y en los `Create<Entity>Dto` de entidades secundarias. **No se aplican a entidades de dominio** ni a campos con `readOnly: true`.

El import `jakarta.validation.constraints.*` se agrega automáticamente cuando se detecta al menos una validación en los campos del comando.

#### Sintaxis

```yaml
fields:
  - name: email
    type: String
    validations:
      - type: NotBlank
        message: "Email es requerido"
      - type: Email
        message: "Email inválido"

  - name: age
    type: Integer
    validations:
      - type: Min
        value: 18
        message: "Edad mínima 18 años"
      - type: Max
        value: 120

  - name: username
    type: String
    validations:
      - type: Size
        min: 3
        max: 50
        message: "Username entre 3 y 50 caracteres"

  - name: code
    type: String
    validations:
      - type: Pattern
        regexp: "^[A-Z]{3}-[0-9]{4}$"
        message: "Formato inválido"

  - name: price
    type: BigDecimal
    validations:
      - type: Digits
        integer: 10
        fraction: 2
```

#### Propiedades por Tipo

| Propiedad | Tipos que la usan | Descripción |
|-----------|-------------------|-------------|
| `type` | Todos | Nombre de la anotación (`NotNull`, `NotBlank`, `Email`, `Min`, `Max`, `Size`, `Pattern`, `Digits`, `Positive`, `Negative`, `Past`, `Future`, etc.) |
| `message` | Todos (opcional) | Mensaje de error personalizado |
| `value` | `Min`, `Max` | Valor límite numérico |
| `min` | `Size` | Tamaño mínimo |
| `max` | `Size` | Tamaño máximo |
| `regexp` | `Pattern` | Expresión regular |
| `integer` | `Digits` | Máximo de dígitos enteros |
| `fraction` | `Digits` | Máximo de dígitos decimales |
| `inclusive` | `DecimalMin`, `DecimalMax` | Si el límite es inclusivo |

#### Anotaciones sin parámetros (solo `type` requerido)

`NotNull`, `NotBlank`, `NotEmpty`, `Email`, `Positive`, `PositiveOrZero`, `Negative`, `NegativeOrZero`, `Past`, `PastOrPresent`, `Future`, `FutureOrPresent`, `AssertTrue`, `AssertFalse`

#### Código generado

Para un campo con validaciones:

```yaml
- name: email
  type: String
  validations:
    - type: Email
      message: "Email inválido"
    - type: NotBlank
      message: "Email es requerido"
```

Se genera en `CreateUserCommand.java`:

```java
import jakarta.validation.constraints.*;

public record CreateUserCommand(
    @Email(message = "Email inválido")
    @NotBlank(message = "Email es requerido")
    String email,
    ...
) implements Command {
}
```

#### Reglas de aplicación

- ✅ **Sí** se aplican en `Create<Aggregate>Command`
- ✅ **Sí** se aplican en `Create<Entity>Dto` (entidades secundarias)
- ❌ **No** se aplican a entidades de dominio (`Order.java`, etc.)
- ❌ **No** se aplican a campos con `readOnly: true` (ya están excluidos del command)
- ❌ **No** se aplican a campos con `hidden: true` si también son `readOnly: true`

---

### Auditoría Automática

eva4j soporta dos niveles de auditoría automática de entidades:

1. **Auditoría de timestamps** (solo `createdAt`, `updatedAt`)
2. **Auditoría completa** (timestamps + `createdBy`, `updatedBy`)

#### Sintaxis

**Opción 1: Solo timestamps (sintaxis legacy - deprecated)**
```yaml
entities:
  - name: order
    isRoot: true
    auditable: true  # ⚠️ Deprecated: usar audit: {} en su lugar
    fields:
      - name: orderNumber
        type: String
```

**Opción 2: Nueva sintaxis (recomendada)**
```yaml
entities:
  - name: order
    isRoot: true
    audit:
      enabled: true      # Agrega createdAt, updatedAt
      trackUser: false   # No agrega createdBy, updatedBy
    fields:
      - name: orderNumber
        type: String
```

**Opción 3: Auditoría completa con seguimiento de usuario**
```yaml
entities:
  - name: order
    isRoot: true
    audit:
      enabled: true      # Agrega createdAt, updatedAt
      trackUser: true    # ← Agrega createdBy, updatedBy
    fields:
      - name: orderNumber
        type: String
```

#### Qué genera cada configuración

##### Solo timestamps (`audit: { enabled: true }`)

**En la entidad de dominio (`Order.java`):**
```java
public class Order {
    private String orderNumber;
    private LocalDateTime createdAt;   // ← Agregado automáticamente
    private LocalDateTime updatedAt;   // ← Agregado automáticamente
    
    // getters generados automáticamente (sin setters por DDD)
}
```

**En la entidad JPA (`OrderJpa.java`):**
```java
@Entity
@Table(name = "orders")
public class OrderJpa extends AuditableEntity {  // ← Extiende clase base
    @Id
    private String orderNumber;
    
    // Los campos createdAt/updatedAt heredados de AuditableEntity
}
```

**Clase base generada (`AuditableEntity.java`):**
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
    
    // getters
}
```

##### Con seguimiento de usuario (`audit: { enabled: true, trackUser: true }`)

**En la entidad JPA (`OrderJpa.java`):**
```java
@Entity
@Table(name = "orders")
public class OrderJpa extends FullAuditableEntity {  // ← Extiende clase extendida
    @Id
    private String orderNumber;
    
    // Hereda: createdAt, updatedAt, createdBy, updatedBy
}
```

**Clase base extendida (`FullAuditableEntity.java`):**
```java
@MappedSuperclass
public abstract class FullAuditableEntity extends AuditableEntity {
    
    @CreatedBy
    @Column(name = "created_by", updatable = false, length = 100)
    private String createdBy;
    
    @LastModifiedBy
    @Column(name = "updated_by", length = 100)
    private String updatedBy;
    
    // getters
    // Hereda createdAt/updatedAt de AuditableEntity
}
```

##### Infraestructura generada para trackUser

Cuando `trackUser: true`, eva4j genera automáticamente:

**1. UserContextHolder** - Almacena el usuario en ThreadLocal
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

**2. UserContextFilter** - Extrae usuario del header HTTP
```java
@Component
public class UserContextFilter extends OncePerRequestFilter {
    private static final String USER_HEADER = "X-User";
    
    @Override
    protected void doFilterInternal(...) {
        try {
            String username = request.getHeader(USER_HEADER);
            if (username != null && !username.trim().isEmpty()) {
                UserContextHolder.setCurrentUser(username.trim());
            }
            filterChain.doFilter(request, response);
        } finally {
            UserContextHolder.clear();
        }
    }
}
```

**3. AuditorAwareImpl** - Provee el usuario a JPA Auditing
```java
@Component("auditorProvider")
public class AuditorAwareImpl implements AuditorAware<String> {
    @Override
    public Optional<String> getCurrentAuditor() {
        String username = UserContextHolder.getCurrentUser();
        if (username == null || username.trim().isEmpty()) {
            return Optional.of("system");
        }
        return Optional.of(username);
    }
}
```

**4. Configuración en Application.java**
```java
@SpringBootApplication
@EnableJpaAuditing(auditorAwareRef = "auditorProvider")  // ← Conecta con AuditorAware
public class Application {
    // ...
}
```

#### Uso en aplicación

##### Sin trackUser (solo timestamps)
```java
// Crear una orden
Order order = new Order("ORD-001", customerId, totalAmount);
orderRepository.save(order);

// Resultado en BD:
// created_at: 2026-02-11 10:30:00
// updated_at: 2026-02-11 10:30:00
```

##### Con trackUser (timestamps + usuario)
```bash
# Request HTTP con header X-User
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -H "X-User: john.doe" \
  -d '{"orderNumber": "ORD-001", "totalAmount": 150.00}'
```

```java
// El filtro captura automáticamente el usuario del header X-User
// No se requiere código adicional en el controlador o servicio

Order order = new Order("ORD-001", customerId, totalAmount);
orderRepository.save(order);

// Resultado en BD:
// created_at: 2026-02-11 10:30:00
// updated_at: 2026-02-11 10:30:00
// created_by: john.doe  ← Capturado automáticamente
// updated_by: john.doe  ← Capturado automáticamente
```

##### Sin header X-User
```java
// Si no se envía header X-User, se usa "system" como default
Order order = new Order("ORD-002", customerId, totalAmount);
orderRepository.save(order);

// Resultado en BD:
// created_by: system  ← Valor por defecto
// updated_by: system
```

#### Características

✅ **Totalmente automático**: Los timestamps se actualizan sin código adicional  
✅ **Nivel de entidad**: Se puede habilitar para entidades específicas  
✅ **Spring Data JPA**: Usa `@CreatedDate`, `@LastModifiedDate`, `@CreatedBy`, `@LastModifiedBy`  
✅ **Mapper incluido**: Los campos de auditoría se mapean automáticamente entre domain y JPA  
✅ **Header HTTP flexible**: Usa `X-User` para pasar el username (ej: "john.doe")  
✅ **ThreadLocal seguro**: Limpieza automática en finally para evitar memory leaks  

#### Ejemplo completo

```yaml
aggregates:
  - name: Product
    entities:
      - name: product
        isRoot: true
        audit:
          enabled: true
          trackUser: true  # ← Habilita auditoría completa
        fields:
          - name: productId
            type: String
          - name: name
            type: String
          - name: price
            type: BigDecimal
          # Los 4 campos de auditoría se agregan automáticamente:
          # createdAt, updatedAt, createdBy, updatedBy
      
      - name: review
        audit:
          enabled: true
          trackUser: false  # ← Solo timestamps, sin usuario
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
    created_at TIMESTAMP NOT NULL,   -- ← Automático
    updated_at TIMESTAMP NOT NULL,   -- ← Automático
    created_by VARCHAR(100),          -- ← Automático (trackUser: true)
    updated_by VARCHAR(100)           -- ← Automático (trackUser: true)
);

CREATE TABLE reviews (
    review_id BIGINT PRIMARY KEY AUTO_INCREMENT,
    comment TEXT,
    product_id VARCHAR(36),
    created_at TIMESTAMP NOT NULL,   -- ← Automático
    updated_at TIMESTAMP NOT NULL,   -- ← Automático
    -- NO tiene created_by/updated_by (trackUser: false)
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);
```

#### Comparación de sintaxis

| Sintaxis | Campos generados | Infraestructura | Estado |
|----------|------------------|-----------------|--------|
| `auditable: true` | `createdAt`, `updatedAt` | `AuditableEntity` | ⚠️ Deprecated |
| `audit: { enabled: true }` | `createdAt`, `updatedAt` | `AuditableEntity` | ✅ Recomendado |
| `audit: { enabled: true, trackUser: true }` | `createdAt`, `updatedAt`, `createdBy`, `updatedBy` | `FullAuditableEntity`, `UserContextFilter`, `AuditorAwareImpl` | ✅ Recomendado |

#### Notas importantes

- ✅ `audit.enabled` es **opcional** - por defecto es `false`
- ✅ `audit.trackUser` requiere que `audit.enabled` sea `true`
- ✅ Puede usarse en **entidad raíz** o **entidades secundarias**
- ✅ Los campos de auditoría **no deben** definirse manualmente en `fields`
- ✅ El filtro `UserContextFilter` se genera automáticamente cuando `trackUser: true`
- ✅ Header `X-User` debe contener el username (formato: "john.doe", "jane@example.com", etc.)
- ✅ Valor por defecto sin header: "system"
- ⚠️ Sintaxis `auditable: true` está deprecated - usar `audit: {}` en su lugar

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

### Value Object generado (Dominio)

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
    
    // equals() y hashCode() basados en todos los campos
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

### Uso en entidades

```yaml
fields:
  - name: totalAmount
    type: Money        # Se detecta automáticamente como VO
```

Genera en JPA:
```java
@Embedded
private MoneyJpa totalAmount;
```

### Ejemplo: Value Object complejo

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

### Definición

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

### Enum generado

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
// OrderItemJpa.java (generado automáticamente)
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

// InvoiceItemJpa.java (generado automáticamente)
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

### Opciones de relaciones

| Opción | Valores | Descripción |
|--------|---------|-------------|
| `type` | OneToMany, ManyToOne, OneToOne, ManyToMany | Tipo de relación |
| `target` | NombreEntidad | Entidad relacionada |
| `mappedBy` | nombreCampo | Para el lado inverso de la relación |
| `joinColumn` | nombre_columna | Nombre de la columna FK |
| `cascade` | [PERSIST, MERGE, REMOVE, REFRESH, DETACH, ALL] | Operaciones en cascada |
| `fetch` | LAZY, EAGER | Estrategia de carga |

---

### 🔥 Opciones Cascade (Operaciones en Cascada)

Las opciones de `cascade` determinan qué operaciones del padre se propagan automáticamente a las entidades relacionadas.

#### **⚠️ IMPORTANTE: Cascade y Persistencia**

Si NO defines `cascade`, las entidades relacionadas **NO se persistirán automáticamente**. Esto es el error más común:

```yaml
# ❌ MAL - Los OrderItem NO se guardarán en la BD
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: []        # ← Array vacío = sin cascada
    fetch: LAZY

# ✅ BIEN - Los OrderItem se guardan automáticamente con Order
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE, REMOVE]  # ← Necesario para persistir
    fetch: LAZY
```

#### **Opciones de Cascade:**

| Opción | Descripción | ¿Cuándo usar? |
|--------|-------------|---------------|
| `PERSIST` | Al guardar el padre, guarda los hijos nuevos | ✅ **Siempre en OneToMany** para crear items |
| `MERGE` | Al actualizar el padre, actualiza los hijos | ✅ **Siempre en OneToMany** para editar items |
| `REMOVE` | Al eliminar el padre, elimina los hijos | ✅ Si los hijos no tienen sentido sin el padre |
| `REFRESH` | Al refrescar el padre, refresca los hijos | ⚠️ Rara vez necesario |
| `DETACH` | Al separar el padre, separa los hijos | ⚠️ Rara vez necesario |
| `ALL` | Todas las operaciones anteriores | ⚠️ Solo si estás seguro |

#### **Configuraciones Recomendadas:**

```yaml
# 🎯 RECOMENDADO para OneToMany (Order → OrderItem)
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE, REMOVE]  # ← Crea, actualiza y elimina items
    fetch: LAZY

# 🎯 RECOMENDADO para entidades con ciclo de vida independiente
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]  # ← Sin REMOVE, items persisten
    fetch: LAZY

# ⚠️ CUIDADO con ALL - incluye REMOVE
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [ALL]  # ← Eliminar Order borra todos los OrderItem
    fetch: LAZY

# ❌ EVITAR array vacío si quieres persistir hijos
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: []  # ← Requiere guardar OrderItem manualmente
    fetch: LAZY
```

#### **¿Qué pasa sin Cascade?**

```yaml
# Sin cascade: [PERSIST]
cascade: []

# Comportamiento:
order.addOrderItem(item);
repository.save(order);  // ❌ Order se guarda, OrderItem NO
```

```yaml
# Con cascade: [PERSIST, MERGE]
cascade: [PERSIST, MERGE]

# Comportamiento:
order.addOrderItem(item);
repository.save(order);  // ✅ Order y OrderItem se guardan automáticamente
```

---

### 🚀 Opciones Fetch (Estrategia de Carga)

Las opciones de `fetch` determinan CUÁNDO se cargan las entidades relacionadas desde la base de datos.

#### **Opciones de Fetch:**

| Opción | Descripción | Comportamiento | ¿Cuándo usar? |
|--------|-------------|----------------|---------------|
| `LAZY` | Carga bajo demanda (cuando accedes) | Solo trae el padre inicialmente | ✅ **Recomendado por defecto** |
| `EAGER` | Carga inmediata (siempre) | Trae padre + hijos en el mismo query | ⚠️ Solo si SIEMPRE necesitas los hijos |

#### **Ejemplo LAZY (Recomendado):**

```yaml
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY  # ← Carga items solo cuando los accedes
```

**SQL generado:**
```sql
-- Primera consulta: Solo trae Order
SELECT * FROM orders WHERE id = ?

-- Segunda consulta: Solo si accedes a order.getOrderItems()
SELECT * FROM order_items WHERE order_id = ?
```

**✅ Ventajas:**
- Mejor rendimiento inicial
- Solo carga lo que necesitas
- Evita cargar datos innecesarios

**⚠️ Desventaja:**
- Puede causar N+1 queries si no usas `JOIN FETCH`

#### **Ejemplo EAGER (Usar con cuidado):**

```yaml
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: EAGER  # ← Siempre carga items con Order
```

**SQL generado:**
```sql
-- Una sola consulta: Trae Order + OrderItems
SELECT o.*, i.* 
FROM orders o 
LEFT JOIN order_items i ON i.order_id = o.id
WHERE o.id = ?
```

**✅ Ventaja:**
- Una sola consulta SQL
- Datos disponibles inmediatamente

**❌ Desventajas:**
- Carga datos aunque no los uses
- Queries más pesados
- Puede causar problemas de rendimiento

#### **Configuraciones Recomendadas por Tipo:**

```yaml
# OneToMany: SIEMPRE LAZY
relationships:
  - type: OneToMany
    target: OrderItem
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY  # ← Evita cargar todos los items siempre

# ManyToOne: LAZY por defecto, EAGER solo si siempre lo necesitas
relationships:
  - type: ManyToOne
    target: Customer
    joinColumn: customer_id
    fetch: LAZY  # ← LAZY por defecto

# OneToOne: LAZY si es opcional, EAGER si siempre existe
relationships:
  - type: OneToOne
    target: OrderSummary
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY  # ← LAZY si no siempre lo usas
```

#### **Problema N+1 y cómo resolverlo:**

**Problema:**
```java
// Con LAZY fetch
List<Order> orders = orderRepository.findAll();  // 1 query
orders.forEach(order -> {
    order.getOrderItems().forEach(item -> {      // N queries (uno por Order)
        System.out.println(item.getProductName());
    });
});
// Total: 1 + N queries = N+1 problema
```

**Solución - Usar JOIN FETCH en queries:**
```java
@Query("SELECT o FROM OrderJpa o LEFT JOIN FETCH o.orderItems WHERE o.id = :id")
OrderJpa findByIdWithItems(@Param("id") String id);
```

---

### ¿Cuándo definir manualmente las relaciones inversas?

#### ❌ NO necesitas definir ManyToOne si:

Ya definiste `OneToMany` con `mappedBy` en el lado "padre". eva4j genera automáticamente la relación inversa.

**Ejemplo - Solo defines OneToMany:**

```yaml
# ✅ SUFICIENTE: Solo defines esto en Order
entities:
  - name: order
    isRoot: true
    relationships:
      - type: OneToMany
        target: OrderItem
        mappedBy: order          # ← eva4j genera ManyToOne automáticamente
        cascade: [PERSIST, MERGE, REMOVE]
        fetch: LAZY

# ❌ NO NECESITAS esto en OrderItem (se genera automáticamente)
#   - name: orderItem
#     relationships:
#       - type: ManyToOne
#         target: Order
#         joinColumn: order_id
#         fetch: LAZY
```

**Resultado:** Relación bidireccional completa con FK `order_id` generada automáticamente.

**✅ Ventajas:**
- Menos código YAML (solo defines un lado)
- Sin duplicación ni inconsistencias
- Funciona igual que definir ambos lados
- FK inferida automáticamente: `{mappedBy}_id`

---

#### ✅ SÍ debes definir ManyToOne manualmente si:

##### 1. **Necesitas un nombre específico de columna FK**

```yaml
# Define ambos lados para controlar el nombre de FK
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
        joinColumn: fk_pedido_uuid    # ← Nombre personalizado
        fetch: LAZY
```

**Cuándo usar:**
- Tu BD tiene convenciones específicas (`fk_*`, prefijos, etc.)
- Necesitas mantener compatibilidad con esquema existente
- Migración desde otra herramienta/framework

---

##### 2. **Múltiples FKs a la misma entidad**

```yaml
# Transaction tiene 'from' y 'to' Account
entities:
  - name: transaction
    tableName: transactions
    
    fields:
      - name: id
        type: String
      - name: amount
        type: BigDecimal
    
    relationships:
      # Primera relación
      - type: ManyToOne
        target: Account
        joinColumn: from_account_id    # ← Nombre explícito necesario
        fetch: LAZY
      
      # Segunda relación a la misma entidad
      - type: ManyToOne
        target: Account
        joinColumn: to_account_id      # ← Diferente nombre de FK
        fetch: LAZY
```

**Cuándo usar:**
- Auto-relaciones (árbol de categorías, org chart)
- Relaciones múltiples al mismo tipo (from/to, parent/child)
- No puedes usar `mappedBy` (¿cuál de las dos sería?)

---

##### 3. **Relación unidireccional (sin lado inverso)**

```yaml
# OrderItem necesita Product, pero Product NO necesita OrderItems
entities:
  - name: orderItem
    relationships:
      - type: ManyToOne
        target: Product         # Product NO tiene List<OrderItem>
        joinColumn: product_id
        fetch: LAZY
  
  # En Product NO defines OneToMany
  - name: product
    isRoot: true
    fields:
      - name: id
        type: String
      - name: name
        type: String
    # Sin relationships hacia OrderItem
```

**Cuándo usar:**
- Performance: evitas cargar colecciones innecesarias
- Product no forma parte del agregado Order
- Solo necesitas navegación en una dirección

---

#### 📊 Comparación Rápida

| Escenario | ¿Definir ManyToOne? | ¿Por qué? |
|-----------|---------------------|-----------|
| Relación estándar con `mappedBy` | ❌ No | eva4j lo genera automáticamente |
| FK con nombre personalizado | ✅ Sí | Para controlar `joinColumn` |
| Múltiples FKs a misma entidad | ✅ Sí | Necesitas nombres explícitos |
| Relación unidireccional | ✅ Sí | No hay lado inverso (`mappedBy`) |
| Convenciones BD específicas | ✅ Sí | Para cumplir estándares |
| Caso estándar simple | ❌ No | Deja que eva4j lo genere |

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

1. **No uses Long para UUIDs**: Usa String
2. **No pongas relaciones bidireccionales sin mappedBy**: Define el owner
3. **No uses EAGER sin razón**: LAZY es mejor para performance
4. **No mezcles conceptos**: Un agregado = una transacción
5. **No uses @Column en domain.yaml**: Es para JPA, se genera automáticamente

---

## Soporte y Limitaciones Actuales

### ✅ Soportado

- Agregados con entidad raíz y secundarias
- Value Objects embebidos
- Enums con valores
- Relaciones OneToMany, ManyToOne, OneToOne
- Tipos primitivos y de fecha Java
- Colecciones de primitivos y VOs
- IDs: String (UUID), Long/Integer (IDENTITY)
- Cascade y Fetch personalizados

### 🚧 Próximamente

- Validaciones JSR-303
- Auditoría automática
- Soft delete
- Query methods personalizados
- Índices y constraints
- Herencia de entidades

---

## Preguntas Frecuentes

**P: ¿Puedo tener múltiples agregados en un domain.yaml?**  
R: Sí, define múltiples entradas en el array `aggregates`.

**P: ¿Cómo referencio un enum de otro agregado?**  
R: Los enums son globales al módulo, solo usa el nombre: `type: OrderStatus`

**P: ¿Puedo usar un VO en múltiples agregados?**  
R: Sí, pero debes definirlo en cada agregado (por ahora).

**P: ¿Qué pasa si regenero el código?**  
R: Se sobrescriben los archivos. Modifica solo en templates, no en código generado.

**P: ¿Puedo personalizar las entidades generadas?**  
R: Sí, modifica las plantillas en `templates/aggregate/`.

---

## Recursos Adicionales

- [Guía de Implementación](IMPLEMENTATION_SUMMARY.md)
- [Guía de Testing](TESTING_GUIDE.md)
- [Referencia Rápida](QUICK_REFERENCE.md)
- [Documentación DDD](https://martinfowler.com/bliki/DomainDrivenDesign.html)

---

**¿Listo para empezar?** Crea tu `domain.yaml` y ejecuta:

```bash
eva4j generate entities <tu-modulo>
```
