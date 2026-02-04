# Command `detach`

## 📋 Description

Extracts a module from the monolithic application and converts it into an independent microservice, maintaining the same hexagonal architecture structure.

## 🎯 Purpose

Enable the transition from modular monolith to microservices architecture by extracting specific modules into standalone deployable applications when scaling or organizational needs require it.

## 📝 Syntax

```bash
eva4j detach <module-name>
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `module-name` | Yes | Name of the module to extract (must exist in the project) |

## 💡 Examples

### Example 1: Extract Customer Module

```bash
eva4j detach customer
```

**Result:** Creates `customer-service/` directory as a standalone Spring Boot application

### Example 2: Extract Order Module

```bash
eva4j detach order
```

### Example 3: Extract Payment Module

```bash
eva4j detach payment
```

## 📦 Generated Structure

```
<module-name>-service/
├── build.gradle                   # Independent Gradle config
├── settings.gradle
├── docker-compose.yml             # Service-specific infrastructure
├── Dockerfile                     # Container image definition
├── src/
│   └── main/
│       ├── java/
│       │   └── com/example/<module>/
│       │       ├── Application.java         # Standalone application
│       │       ├── domain/                  # Same domain layer
│       │       ├── application/             # Same application layer
│       │       └── infrastructure/          # Same infrastructure layer
│       └── resources/
│           ├── application.yml              # Service-specific config
│           └── application-*.yml            # Environment configs
└── README.md
```

## ✨ Features

### Module Preservation
- ✅ **Same code structure** - Domain, application, infrastructure layers intact
- ✅ **Zero code rewrite** - Module code copied as-is
- ✅ **All dependencies** - Required libraries included in build.gradle
- ✅ **Configuration** - Adapted for standalone deployment

### Microservice Additions
- ✅ **Independent Application class** - Separate Spring Boot app
- ✅ **Own database** - Dedicated database configuration
- ✅ **Docker support** - Dockerfile and docker-compose.yml
- ✅ **Service discovery ready** - Eureka client configuration (optional)
- ✅ **API Gateway ready** - Can integrate with Spring Cloud Gateway

### Communication Setup
- ✅ **REST APIs** - Existing controllers work as-is
- ✅ **Kafka integration** - If module has events configured
- ✅ **HTTP clients** - Feign clients for inter-service communication

## 🔄 Detachment Process

### What Gets Copied
1. **Domain layer** - All entities, value objects, enums, repositories
2. **Application layer** - Commands, queries, handlers, DTOs, mappers
3. **Infrastructure layer** - JPA entities, repositories, controllers
4. **Configuration** - Module-specific settings

### What Gets Created
1. **New Application.java** - Standalone Spring Boot application
2. **Independent build.gradle** - Only necessary dependencies
3. **Docker support** - Dockerfile and docker-compose.yml
4. **Service configuration** - application.yml with service-specific settings
5. **README.md** - Service documentation

### What Gets Removed
1. **Shared dependencies** - From other modules (if any existed)
2. **Monolith references** - Cleaned up imports and configs
3. **Unused infrastructure** - Only keeps what this module needs

## 🌐 Inter-Service Communication

After detachment, services communicate via:

### 1. REST APIs
```java
// In calling service
@FeignClient(name = "customer-service", url = "${services.customer.url}")
public interface CustomerClient {
    @GetMapping("/api/customers/{id}")
    CustomerDto getCustomer(@PathVariable Long id);
}
```

### 2. Kafka Events
```java
// Publishing service
@Autowired
private KafkaTemplate<String, OrderCreatedEvent> kafkaTemplate;

public void publishOrderCreated(Order order) {
    kafkaTemplate.send("order.created", new OrderCreatedEvent(order));
}

// Consuming service
@KafkaListener(topics = "order.created")
public void handleOrderCreated(OrderCreatedEvent event) {
    // Process event
}
```

## 🚀 Next Steps

After detaching a module:

1. **Review configuration:**
   ```yaml
   # application.yml in detached service
   server:
     port: 8081  # Different port
   
   spring:
     datasource:
       url: jdbc:postgresql://localhost:5432/customer_db  # Own database
   ```

2. **Build the service:**
   ```bash
   cd customer-service
   ./gradlew build
   ```

3. **Run locally:**
   ```bash
   ./gradlew bootRun
   ```

4. **Or run with Docker:**
   ```bash
   docker-compose up -d
   docker build -t customer-service .
   docker run -p 8081:8081 customer-service
   ```

5. **Deploy independently:**
   - Kubernetes
   - Docker Swarm
   - Cloud platforms (AWS, GCP, Azure)
   - PaaS (Heroku, Cloud Foundry)

6. **Set up service discovery:**
   ```yaml
   # application.yml
   eureka:
     client:
       service-url:
         defaultZone: http://localhost:8761/eureka
     instance:
       prefer-ip-address: true
   ```

## 🎯 When to Detach

### Good Reasons
- ✅ **Different scaling needs** - Module needs more/fewer instances
- ✅ **Team autonomy** - Separate team owns the module
- ✅ **Technology requirements** - Module needs different tech stack
- ✅ **Deployment frequency** - Module changes more/less often
- ✅ **Performance isolation** - Module has different performance characteristics
- ✅ **Security boundaries** - Module needs stricter security

### Bad Reasons (Keep as Monolith)
- ❌ **Premature optimization** - "Might need to scale later"
- ❌ **Resume-driven development** - "Want microservices on resume"
- ❌ **Following trends** - "Everyone is doing microservices"
- ❌ **Organizational pressure** - Without actual technical need

## ⚙️ Configuration Changes

### Database
```yaml
# Before (shared database)
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/monolith_db

# After (dedicated database)
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/customer_db
```

### Server Port
```yaml
# Each service needs different port
server:
  port: 8081  # customer-service
  # 8082 for order-service
  # 8083 for payment-service
```

### Service Discovery
```yaml
spring:
  application:
    name: customer-service

eureka:
  client:
    enabled: true
    service-url:
      defaultZone: http://localhost:8761/eureka
```

## ⚠️ Prerequisites

- Be in a project created with `eva4j create`
- Module must exist and be fully implemented
- All module tests should pass
- Module should have minimal dependencies on other modules

## 🔍 Validations

The command validates:
- ✅ Valid eva4j project
- ✅ Module exists
- ✅ Module is properly structured
- ✅ No circular dependencies
- ✅ Target directory doesn't exist

## 📚 See Also

- [add-module](./ADD_MODULE.md) - Create modules (first step)
- [generate-entities](./GENERATE_ENTITIES.md) - Implement module
- [generate-http-exchange](./GENERATE_HTTP_EXCHANGE.md) - Inter-service communication

## 🐛 Troubleshooting

**Error: "Module not found"**
- Solution: Ensure the module exists. Use `eva4j info` to list modules

**Error: "Module has dependencies"**
- Solution: Detach dependent modules first, or refactor to remove dependencies

**Build fails in detached service**
- Solution: Check that all necessary dependencies are in the new build.gradle

**Cannot connect to other services**
- Solution: Configure service URLs in application.yml
- Use service discovery or configure direct URLs

**Database connection errors**
- Solution: Update datasource configuration with service-specific database
- Ensure database exists and is accessible
