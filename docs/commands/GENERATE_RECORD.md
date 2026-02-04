# Command `generate record` (alias: `g record`)

## 📋 Description

Generates a Java Record class with immutable data structure, ideal for DTOs, value objects, or simple data carriers.

## 🎯 Purpose

Quickly create immutable data classes using Java Records (Java 14+), reducing boilerplate code for simple data structures.

## 📝 Syntax

```bash
eva4j generate record <RecordName>
eva4j g record <RecordName>    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `RecordName` | Yes | Name of the record (PascalCase, e.g., CustomerDto, OrderSummary) |

## 💡 Examples

### Example 1: Simple DTO

```bash
eva4j g record CustomerDto
```

**Generates:**
```java
package com.example.project.customer.application.dtos;

/**
 * CustomerDto - Immutable data transfer object
 */
public record CustomerDto(
    // Add your fields here
) {
}
```

### Example 2: Value Object

```bash
eva4j g record Address
```

### Example 3: API Response

```bash
eva4j g record ApiResponse
```

## 📦 Generated Code Structure

**Location:** `<module>/application/dtos/<RecordName>.java`

**Basic Template:**
```java
package com.example.project.customer.application.dtos;

/**
 * CustomerDto - Immutable data transfer object
 */
public record CustomerDto(
    // Add your fields here
    Long id,
    String name,
    String email
) {
}
```

## ✨ Features

### Java Records Benefits
- ✅ **Immutable by default** - All fields are final
- ✅ **Automatic getters** - `record.id()`, `record.name()`
- ✅ **Automatic equals/hashCode** - Based on all fields
- ✅ **Automatic toString()** - Human-readable representation
- ✅ **Compact syntax** - Less boilerplate than classes
- ✅ **Type-safe** - Compile-time field validation

### Common Use Cases
- Data Transfer Objects (DTOs)
- API Responses
- Configuration objects
- Event payloads
- Query results
- Value Objects (simple ones)

## 🔧 Customization Examples

### Add Fields

```java
public record CustomerDto(
    Long id,
    String firstName,
    String lastName,
    String email,
    LocalDateTime createdAt
) {
}
```

### Add Validation

```java
import jakarta.validation.constraints.*;

public record CreateCustomerDto(
    @NotBlank
    @Size(max = 100)
    String firstName,
    
    @NotBlank
    @Size(max = 100)
    String lastName,
    
    @Email
    @NotBlank
    String email
) {
}
```

### Add Custom Methods

```java
public record CustomerDto(
    Long id,
    String firstName,
    String lastName,
    String email
) {
    // Custom method
    public String fullName() {
        return firstName + " " + lastName;
    }
    
    // Compact constructor with validation
    public CustomerDto {
        if (firstName == null || firstName.isBlank()) {
            throw new IllegalArgumentException("First name is required");
        }
    }
}
```

### Nested Records

```java
public record OrderDto(
    Long id,
    CustomerDto customer,
    List<OrderItemDto> items,
    BigDecimal total
) {
}

public record OrderItemDto(
    Long productId,
    String productName,
    Integer quantity,
    BigDecimal price
) {
}
```

## 🎯 Record vs Class

### Use Record When:
- ✅ Data is immutable
- ✅ Simple data carrier without complex behavior
- ✅ DTOs for API requests/responses
- ✅ Value objects with few fields
- ✅ Event payloads

### Use Class When:
- ❌ Need mutability (setters)
- ❌ Complex business logic
- ❌ Inheritance required
- ❌ Need lazy loading
- ❌ JPA entities (use `@Entity` classes)

## 📚 Common Patterns

### Request DTO

```java
public record CreateOrderRequest(
    @NotNull Long customerId,
    @NotEmpty List<OrderItemRequest> items,
    @Size(max = 500) String notes
) {
}
```

### Response DTO

```java
public record OrderResponse(
    Long id,
    String orderNumber,
    CustomerSummary customer,
    BigDecimal total,
    OrderStatus status,
    LocalDateTime createdAt
) {
}
```

### Page Response

```java
public record PageResponse<T>(
    List<T> content,
    int pageNumber,
    int pageSize,
    long totalElements,
    int totalPages
) {
}
```

### Error Response

```java
public record ErrorResponse(
    String message,
    String code,
    LocalDateTime timestamp
) {
    public ErrorResponse(String message, String code) {
        this(message, code, LocalDateTime.now());
    }
}
```

## 🚀 Next Steps

After generating a record:

1. **Add fields:**
   ```java
   public record CustomerDto(
       Long id,
       String name,
       String email
   ) {
   }
   ```

2. **Use in controllers:**
   ```java
   @PostMapping
   public ResponseEntity<CustomerDto> create(@Valid @RequestBody CustomerDto dto) {
       // Process DTO
   }
   ```

3. **Create mappers:**
   ```java
   public class CustomerMapper {
       public static CustomerDto toDto(Customer entity) {
           return new CustomerDto(
               entity.getId(),
               entity.getName(),
               entity.getEmail()
           );
       }
   }
   ```

## ⚠️ Prerequisites

- Java 17+ (Records require Java 14+, but project uses 21+)
- Be in a project created with `eva4j create`
- Module must exist

## 🔍 Validations

The command validates:
- ✅ Valid eva4j project
- ✅ Record name is in PascalCase
- ✅ Module exists
- ✅ Java version supports records

## 📚 See Also

- [generate-entities](./GENERATE_ENTITIES.md) - Generate full entities
- [generate-usecase](./GENERATE_USECASE.md) - Create use cases that use records
- [generate-resource](./GENERATE_RESOURCE.md) - Create controllers

## 🐛 Troubleshooting

**Error: "Records not supported"**
- Solution: Ensure your project uses Java 17+ (configured during `eva4j create`)

**Validation annotations not working**
- Solution: Add Jakarta Validation dependency and `@Valid` annotation

**Cannot modify record fields**
- Solution: Records are immutable by design. Create new instances instead of modifying existing ones

**JPA errors with records**
- Solution: Don't use records for JPA entities. Use regular classes with `@Entity` annotation
