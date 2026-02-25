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
eva4j create my-app

# Agregar módulo
eva4j add module users

# Generar entidades desde YAML
eva4j g entities users

# Generar use case
eva4j g usecase users ActivateUser

# Generar resource (REST)
eva4j g resource users
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
```

---

## 🚨 Errores Comunes a Evitar

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
| `hidden: true` | ✅ | ✅ | ❌ |
| Ambos flags | ❌ | ❌ | ❌ |

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

### Tipos de Relaciones

- `OneToOne` - Relación uno a uno
- `OneToMany` - Relación uno a muchos
- `ManyToOne` - Relación muchos a uno
- `ManyToMany` - Relación muchos a muchos (evitar si es posible)

---

## 🎯 Mejores Prácticas para Agentes

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

### Tests de Dominio

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

---

## 📖 Documentos Relacionados

- **[DOMAIN_YAML_GUIDE.md](DOMAIN_YAML_GUIDE.md)** - Guía completa de sintaxis YAML
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Referencia rápida de comandos
- **[FUTURE_FEATURES.md](FUTURE_FEATURES.md)** - Características planeadas
- **[README.md](README.md)** - Documentación general

---

## ✅ Checklist para Agentes

Al generar o modificar código, verificar:

- [ ] Entidades de dominio **sin constructor vacío**
- [ ] Entidades de dominio **sin setters públicos**
- [ ] Métodos de negocio con **validaciones explícitas**
- [ ] Entidades JPA con **Lombok y herencia correcta**
- [ ] Mappers **excluyen campos de auditoría**
- [ ] Mappers **excluyen campos readOnly en creación**
- [ ] Mappers **excluyen campos hidden en respuestas**
- [ ] DTOs de respuesta **sin createdBy/updatedBy**
- [ ] DTOs de respuesta **sin campos hidden**
- [ ] DTOs de creación **sin campos readOnly**
- [ ] Relaciones bidireccionales con métodos `assign*()`
- [ ] Value Objects **inmutables**
- [ ] Configuración de auditoría cuando `trackUser: true`
- [ ] Validaciones JSR-303 **solo en Command y CreateDto, nunca en dominio**

---

**Última actualización:** 2026-02-21  
**Versión de eva4j:** 1.x  
**Estado:** Documento de referencia para agentes IA
