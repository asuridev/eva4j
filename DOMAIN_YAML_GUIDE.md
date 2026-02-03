# Guía Completa: domain.yaml

## 📋 Tabla de Contenidos

- [Introducción](#introducción)
- [Estructura General](#estructura-general)
- [Definición de Agregados](#definición-de-agregados)
- [Entidades](#entidades)
- [Value Objects](#value-objects)
- [Enums](#enums)
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

---

## Estructura General

```yaml
aggregates:
  - name: NombreAgregado
    rootEntity:
      # Definición de la entidad raíz
    
    secondaryEntities:
      # Entidades dentro del agregado
    
    valueObjects:
      # Value Objects del agregado
    
    enums:
      # Enumeraciones del dominio
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
    rootEntity:
      name: order
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

```yaml
rootEntity:
  name: order              # Nombre de la entidad (camelCase o snake_case)
  tableName: orders        # Nombre de la tabla en BD (opcional)
  isRoot: true             # Siempre true para rootEntity
  
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

Entidades que pertenecen al agregado pero no son la raíz.

```yaml
secondaryEntities:
  - name: orderItem
    tableName: order_items
    
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

#### Sintaxis completa

```yaml
fields:
  - name: fieldName          # Nombre del campo (camelCase)
    type: String             # Tipo de dato Java
    isValueObject: true      # (Opcional) Si es un VO
    isEmbedded: true         # (Opcional) Para JPA @Embedded
    annotations:             # (Opcional) Anotaciones personalizadas
      - "@Column(length = 500)"
```

#### Detección automática

eva4j detecta automáticamente:
- ✅ **Value Objects**: Si el tipo coincide con un VO definido
- ✅ **Enums**: Si el tipo coincide con un enum definido
- ✅ **Tipos primitivos**: String, Integer, Long, etc.

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
rootEntity:
  name: order
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
rootEntity:
  name: order
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
secondaryEntities:
  - name: orderItem
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

### OneToOne (Uno a Uno)

**Bidireccional con mappedBy:**

```yaml
# En Order
relationships:
  - type: OneToOne
    target: OrderSummary
    mappedBy: order
    cascade: [PERSIST, MERGE]
    fetch: LAZY
```

**Sin mappedBy (owner):**

```yaml
# En OrderSummary
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
    rootEntity:
      name: order
      tableName: orders
      isRoot: true
      
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
    
    secondaryEntities:
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
    rootEntity:
      name: post
      tableName: posts
      isRoot: true
      
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
    
    secondaryEntities:
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
    rootEntity:
      name: account
      tableName: accounts
      isRoot: true
      
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
    
    secondaryEntities:
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
    rootEntity:
      name: customer
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
    rootEntity:
      name: product
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
