# Command `generate http-exchange` (alias: `g http`)

## 📋 Description

Generates HTTP client infrastructure using Spring Cloud OpenFeign for consuming external REST APIs, following the hexagonal architecture pattern with ports and adapters.

## 🎯 Purpose

Enable modules to communicate with external HTTP services or other microservices through clean, declarative interfaces while maintaining architectural boundaries.

## 📝 Syntax

```bash
eva4j generate http-exchange <ClientName>
eva4j g http <ClientName>    # Short alias
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ClientName` | Yes | Name of the HTTP client (PascalCase, e.g., PaymentGateway, UserService) |

## 💡 Examples

### Example 1: Payment Gateway Client

```bash
eva4j g http PaymentGateway
```

### Example 2: User Service Client

```bash
eva4j g http UserService
```

### Example 3: External API Client

```bash
eva4j g http WeatherApi
```

## 📦 Generated Code Structure

```
<module>/
├── domain/
│   └── ports/
│       └── PaymentGatewayPort.java              # Port (interface)
│
├── application/
│   └── services/
│       └── PaymentGatewayAdapter.java           # Adapter implementation
│
└── infrastructure/
    └── external/
        ├── clients/
        │   └── PaymentGatewayClient.java        # Feign client
        └── config/
            └── PaymentGatewayConfig.java        # Feign configuration
```

## 📄 Generated Files

### 1. Port (Domain Layer)

**PaymentGatewayPort.java:**
```java
package com.example.project.payment.domain.ports;

/**
 * Port for PaymentGateway external communication
 */
public interface PaymentGatewayPort {
    
    // Define your methods here
    // Example:
    // PaymentResponse processPayment(PaymentRequest request);
}
```

### 2. Feign Client (Infrastructure Layer)

**PaymentGatewayClient.java:**
```java
package com.example.project.payment.infrastructure.external.clients;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;

/**
 * Feign client for PaymentGateway
 */
@FeignClient(
    name = "payment-gateway",
    url = "${external.payment-gateway.url}",
    configuration = PaymentGatewayConfig.class
)
public interface PaymentGatewayClient {
    
    // Define your HTTP endpoints here
    // Example:
    // @PostMapping("/payments")
    // PaymentResponse processPayment(@RequestBody PaymentRequest request);
    
    // @GetMapping("/payments/{id}")
    // PaymentResponse getPayment(@PathVariable String id);
}
```

### 3. Configuration (Infrastructure Layer)

**PaymentGatewayConfig.java:**
```java
package com.example.project.payment.infrastructure.external.config;

import feign.Logger;
import feign.RequestInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration for PaymentGateway Feign client
 */
@Configuration
public class PaymentGatewayConfig {
    
    @Value("${external.payment-gateway.api-key:}")
    private String apiKey;
    
    @Bean
    public Logger.Level feignLoggerLevel() {
        return Logger.Level.FULL;
    }
    
    @Bean
    public RequestInterceptor requestInterceptor() {
        return requestTemplate -> {
            // Add headers
            requestTemplate.header("Content-Type", "application/json");
            if (apiKey != null && !apiKey.isEmpty()) {
                requestTemplate.header("X-API-Key", apiKey);
            }
        };
    }
}
```

### 4. Adapter (Application Layer)

**PaymentGatewayAdapter.java:**
```java
package com.example.project.payment.application.services;

import com.example.project.payment.domain.ports.PaymentGatewayPort;
import com.example.project.payment.infrastructure.external.clients.PaymentGatewayClient;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * Adapter implementation for PaymentGateway
 */
@Service
@RequiredArgsConstructor
public class PaymentGatewayAdapter implements PaymentGatewayPort {
    
    private final PaymentGatewayClient client;
    
    // Implement port methods here
    // Example:
    // @Override
    // public PaymentResponse processPayment(PaymentRequest request) {
    //     return client.processPayment(request);
    // }
}
```

## ✨ Features

### OpenFeign Capabilities
- ✅ **Declarative HTTP client** - Annotate interfaces, no implementation needed
- ✅ **Request/Response mapping** - Automatic JSON serialization
- ✅ **Load balancing** - Integration with Spring Cloud LoadBalancer
- ✅ **Circuit breaker** - Resilience4j integration
- ✅ **Logging** - Configurable request/response logging
- ✅ **Error handling** - Custom error decoders
- ✅ **Interceptors** - Add headers, authentication, etc.

### Hexagonal Architecture
- ✅ **Port** - Domain-level interface (technology-agnostic)
- ✅ **Adapter** - Application-level implementation
- ✅ **Client** - Infrastructure-level Feign interface
- ✅ **Configuration** - Centralized client setup

## 🔧 Configuration

### Application Properties

```yaml
# application.yaml

# External service configuration
external:
  payment-gateway:
    url: https://api.paymentgateway.com
    api-key: ${PAYMENT_API_KEY}
    timeout:
      connect: 5000
      read: 10000

# Feign configuration
feign:
  client:
    config:
      payment-gateway:
        connectTimeout: 5000
        readTimeout: 10000
        loggerLevel: full

# Logging
logging:
  level:
    com.example.project.payment.infrastructure.external: DEBUG
```

## 🎯 Common Use Cases

### 1. Payment Gateway Integration

```java
@FeignClient(name = "stripe", url = "${external.stripe.url}")
public interface StripeClient {
    
    @PostMapping("/v1/charges")
    ChargeResponse createCharge(@RequestBody ChargeRequest request);
    
    @GetMapping("/v1/charges/{id}")
    ChargeResponse getCharge(@PathVariable String id);
    
    @PostMapping("/v1/refunds")
    RefundResponse createRefund(@RequestBody RefundRequest request);
}
```

### 2. External API Integration

```java
@FeignClient(name = "weather-api", url = "${external.weather.url}")
public interface WeatherApiClient {
    
    @GetMapping("/current")
    WeatherResponse getCurrentWeather(
        @RequestParam String location,
        @RequestParam String apiKey
    );
}
```

### 3. Microservice Communication

```java
@FeignClient(name = "user-service", url = "${services.user.url}")
public interface UserServiceClient {
    
    @GetMapping("/api/users/{id}")
    UserDto getUser(@PathVariable Long id);
    
    @PostMapping("/api/users")
    UserDto createUser(@RequestBody CreateUserRequest request);
}
```

### 4. Third-Party Service

```java
@FeignClient(name = "sendgrid", url = "${external.sendgrid.url}")
public interface SendGridClient {
    
    @PostMapping("/v3/mail/send")
    void sendEmail(
        @RequestHeader("Authorization") String apiKey,
        @RequestBody EmailRequest email
    );
}
```

## 🛡️ Error Handling

### Custom Error Decoder

```java
@Configuration
public class PaymentGatewayConfig {
    
    @Bean
    public ErrorDecoder errorDecoder() {
        return (methodKey, response) -> {
            if (response.status() >= 400 && response.status() <= 499) {
                return new PaymentClientException("Client error: " + response.reason());
            }
            if (response.status() >= 500 && response.status() <= 599) {
                return new PaymentServerException("Server error: " + response.reason());
            }
            return new Exception("Generic error");
        };
    }
}
```

### Fallback Support

```java
@FeignClient(
    name = "payment-gateway",
    url = "${external.payment-gateway.url}",
    fallback = PaymentGatewayFallback.class
)
public interface PaymentGatewayClient {
    @PostMapping("/payments")
    PaymentResponse processPayment(@RequestBody PaymentRequest request);
}

@Component
public class PaymentGatewayFallback implements PaymentGatewayClient {
    @Override
    public PaymentResponse processPayment(PaymentRequest request) {
        // Return fallback response
        return PaymentResponse.error("Service temporarily unavailable");
    }
}
```

## 🚀 Next Steps

After generating the HTTP exchange:

1. **Define the contract in the Port:**
   ```java
   public interface PaymentGatewayPort {
       PaymentResponse processPayment(PaymentRequest request);
       PaymentStatus checkStatus(String transactionId);
   }
   ```

2. **Implement Feign client endpoints:**
   ```java
   @FeignClient(name = "payment-gateway", url = "${external.payment.url}")
   public interface PaymentGatewayClient {
       @PostMapping("/v1/payments")
       PaymentResponse processPayment(@RequestBody PaymentRequest request);
       
       @GetMapping("/v1/payments/{id}/status")
       PaymentStatus checkStatus(@PathVariable String id);
   }
   ```

3. **Implement the Adapter:**
   ```java
   @Service
   @RequiredArgsConstructor
   public class PaymentGatewayAdapter implements PaymentGatewayPort {
       private final PaymentGatewayClient client;
       
       @Override
       public PaymentResponse processPayment(PaymentRequest request) {
           return client.processPayment(request);
       }
       
       @Override
       public PaymentStatus checkStatus(String transactionId) {
           return client.checkStatus(transactionId);
       }
   }
   ```

4. **Configure the service URL:**
   ```yaml
   external:
     payment:
       url: https://api.payment-provider.com
       api-key: ${PAYMENT_API_KEY}
   ```

5. **Use the port in your domain:**
   ```java
   @Service
   @RequiredArgsConstructor
   public class ProcessOrderCommandHandler {
       private final PaymentGatewayPort paymentGateway;
       
       public void handle(ProcessOrderCommand command) {
           PaymentResponse payment = paymentGateway.processPayment(
               new PaymentRequest(command.getAmount())
           );
           // Continue with business logic
       }
   }
   ```

## ⚠️ Prerequisites

- Be in a project created with `eva4j create`
- Module must exist
- Spring Cloud OpenFeign dependency (automatically added)

## 🔍 Validations

The command validates:
- ✅ Valid eva4j project
- ✅ Client name is in PascalCase
- ✅ Module exists
- ✅ Feign is configured in the project

## 📚 See Also

- [generate-kafka-event](./GENERATE_KAFKA_EVENT.md) - Async communication
- [add-module](./ADD_MODULE.md) - Create modules
- [detach](./DETACH.md) - Extract to microservices

## 🐛 Troubleshooting

**Error: "Feign client not found"**
- Solution: Ensure `@EnableFeignClients` is in your main Application class

**Connection timeout errors**
- Solution: Increase timeout in configuration:
  ```yaml
  feign:
    client:
      config:
        default:
          connectTimeout: 10000
          readTimeout: 20000
  ```

**401/403 authentication errors**
- Solution: Add authentication in RequestInterceptor
  ```java
  @Bean
  public RequestInterceptor authInterceptor() {
      return template -> {
          template.header("Authorization", "Bearer " + getToken());
      };
  }
  ```

**Load balancer errors**
- Solution: Specify URL directly or configure service discovery
