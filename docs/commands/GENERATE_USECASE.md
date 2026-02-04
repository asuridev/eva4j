# Command `generate usecase` (alias: `g usecase`)

## 📋 Description

Generates CQRS use cases (Commands or Queries) with their respective handlers, following the Command Query Responsibility Segregation pattern.

## 🎯 Purpose

Create individual use cases for specific business operations, maintaining clear separation between write operations (Commands) and read operations (Queries).

## 📝 Syntax

```bash
eva4j generate usecase <UseCaseName> --type <command|query>
eva4j g usecase <UseCaseName> --type <command|query>    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `UseCaseName` | Yes | Name of the use case (PascalCase, e.g., UpdateCustomer, GetOrderById) |
| `--type` | Yes | Type of use case: `command` (write) or `query` (read) |

## 💡 Examples

### Example 1: Update Command

```bash
eva4j g usecase UpdateCustomer --type command
```

**Generates:**
- `application/commands/UpdateCustomerCommand.java` - Command with request data
- `application/commands/UpdateCustomerCommandHandler.java` - Handler with business logic

### Example 2: Delete Command

```bash
eva4j g usecase DeleteOrder --type command
```

**Generates:**
- `application/commands/DeleteOrderCommand.java`
- `application/commands/DeleteOrderCommandHandler.java`

### Example 3: Custom Query

```bash
eva4j g usecase GetCustomerByEmail --type query
```

**Generates:**
- `application/queries/GetCustomerByEmailQuery.java`
- `application/queries/GetCustomerByEmailQueryHandler.java`

### Example 4: Search Query

```bash
eva4j g usecase SearchProducts --type query
```

**Generates:**
- `application/queries/SearchProductsQuery.java`
- `application/queries/SearchProductsQueryHandler.java`

## 📦 Generated Code Structure

### Command Example

**UpdateCustomerCommand.java:**
```java
package com.example.project.customer.application.commands;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UpdateCustomerCommand {
    private Long id;
    // Add your fields here
}
```

**UpdateCustomerCommandHandler.java:**
```java
package com.example.project.customer.application.commands;

import com.example.project.customer.domain.models.Customer;
import com.example.project.customer.domain.repositories.CustomerRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UpdateCustomerCommandHandler {
    
    private final CustomerRepository repository;
    
    @Transactional
    public void handle(UpdateCustomerCommand command) {
        // TODO: Implement update logic
        Customer customer = repository.findById(command.getId())
            .orElseThrow(() -> new RuntimeException("Customer not found"));
        
        // Update customer fields
        
        repository.save(customer);
    }
}
```

### Query Example

**GetCustomerByEmailQuery.java:**
```java
package com.example.project.customer.application.queries;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class GetCustomerByEmailQuery {
    private String email;
}
```

**GetCustomerByEmailQueryHandler.java:**
```java
package com.example.project.customer.application.queries;

import com.example.project.customer.domain.models.Customer;
import com.example.project.customer.domain.repositories.CustomerRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class GetCustomerByEmailQueryHandler {
    
    private final CustomerRepository repository;
    
    @Transactional(readOnly = true)
    public Customer handle(GetCustomerByEmailQuery query) {
        // TODO: Implement query logic
        return repository.findByEmail(query.getEmail())
            .orElseThrow(() -> new RuntimeException("Customer not found"));
    }
}
```

## ✨ Features

### Commands (Write Operations)
- ✅ **@Transactional** - Ensures data consistency
- ✅ **Repository injection** - Domain repository ready
- ✅ **TODO comments** - Guides implementation
- ✅ **Lombok annotations** - Reduces boilerplate

### Queries (Read Operations)
- ✅ **@Transactional(readOnly = true)** - Optimized for reads
- ✅ **Repository injection** - Domain repository ready
- ✅ **Return type flexibility** - Can return entities or DTOs
- ✅ **Clean structure** - Follows CQRS pattern

## 🎯 Common Use Cases

### Customer Module
```bash
eva4j g usecase UpdateCustomer --type command
eva4j g usecase DeactivateCustomer --type command
eva4j g usecase GetCustomerByEmail --type query
eva4j g usecase SearchCustomers --type query
eva4j g usecase CountActiveCustomers --type query
```

### Order Module
```bash
eva4j g usecase UpdateOrderStatus --type command
eva4j g usecase CancelOrder --type command
eva4j g usecase AddOrderItem --type command
eva4j g usecase GetOrdersByCustomer --type query
eva4j g usecase GetOrdersByDateRange --type query
```

### Product Module
```bash
eva4j g usecase UpdateProductPrice --type command
eva4j g usecase UpdateStock --type command
eva4j g usecase DeactivateProduct --type command
eva4j g usecase SearchProductsByCategory --type query
eva4j g usecase GetLowStockProducts --type query
```

## 🔄 CQRS Pattern Guidelines

### Commands (Writes)
- **Purpose:** Change system state
- **Transaction:** Required (`@Transactional`)
- **Return:** Usually `void` or entity ID
- **Examples:** Create, Update, Delete, Activate, Deactivate

### Queries (Reads)
- **Purpose:** Retrieve data without side effects
- **Transaction:** Read-only (`@Transactional(readOnly = true)`)
- **Return:** Entity, DTO, or List
- **Examples:** Get, List, Search, Count, Find

## 🚀 Next Steps

After generating a use case:

1. **Implement the logic:**
   - Edit the handler class
   - Add business validations
   - Implement the actual operation

2. **Add to controller (if needed):**
   ```java
   @PostMapping("/update")
   public ResponseEntity<Void> update(@RequestBody UpdateCustomerCommand command) {
       handler.handle(command);
       return ResponseEntity.ok().build();
   }
   ```

3. **Add validations to command:**
   ```java
   @NotNull
   private Long id;
   
   @NotBlank
   @Size(max = 100)
   private String name;
   ```

4. **Create DTOs if needed:**
   - Create response DTOs for queries
   - Create mappers between entities and DTOs

## ⚠️ Prerequisites

- Be in a project created with `eva4j create`
- Module must exist (created with `eva4j add module`)
- Working directory should be the project root

## 🔍 Validations

The command validates:
- ✅ Valid eva4j project
- ✅ Use case name is in PascalCase
- ✅ Type is either `command` or `query`
- ✅ Module exists in the project

## 📚 See Also

- [generate-entities](./GENERATE_ENTITIES.md) - Generate complete CRUD
- [generate-resource](./GENERATE_RESOURCE.md) - Generate REST controller
- [add-module](./ADD_MODULE.md) - Create modules

## 🐛 Troubleshooting

**Error: "Invalid use case name"**
- Solution: Use PascalCase naming (e.g., `UpdateCustomer`, not `updateCustomer` or `update-customer`)

**Error: "Type must be command or query"**
- Solution: Always specify `--type command` or `--type query`

**Files not created in correct location**
- Solution: Run command from project root directory
- Check that you're in a valid eva4j project

**Repository not found after generation**
- Solution: Generate entities first with `eva4j g entities`, or create repository interface manually
