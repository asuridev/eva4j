# Características Futuras - eva4j

Este documento contiene características planeadas para futuras versiones de eva4j, con ejemplos de implementación y consideraciones técnicas.

---

## 📋 Tabla de Contenidos

- [Auditoría de Usuario (trackUser)](#auditoría-de-usuario-trackuser)
- [Soft Delete Avanzado](#soft-delete-avanzado)
- [Validaciones JSR-303](#validaciones-jsr-303)

---

## Auditoría de Usuario (trackUser)

### Descripción

Extensión de la auditoría básica (`auditable: true`) para incluir **quién** realizó cada operación, además de **cuándo**.

### Estado Actual vs Futuro

#### ✅ Implementado (Fase 1): Auditoría de Tiempo

```yaml
entities:
  - name: order
    isRoot: true
    auditable: true  # Solo agrega createdAt, updatedAt
```

**Campos generados:**
- `createdAt: LocalDateTime`
- `updatedAt: LocalDateTime`

---

#### 🚧 Por Implementar (Fase 2): Auditoría de Usuario

```yaml
entities:
  - name: order
    isRoot: true
    audit:
      enabled: true
      trackUser: true     # ← Nueva funcionalidad
```

**Campos adicionales generados:**
- `createdBy: String` - Usuario que creó el registro
- `updatedBy: String` - Usuario que modificó por última vez

---

### Implementación Técnica

#### 1. Clase Base Extendida: `FullAuditableEntity`

**Ubicación:** `src/{package}/shared/domain/FullAuditableEntity.java`

```java
package com.yourproject.shared.domain;

import java.time.LocalDateTime;
import jakarta.persistence.Column;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.MappedSuperclass;
import org.springframework.data.annotation.CreatedBy;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedBy;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class FullAuditableEntity {
    
    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
    
    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
    
    @CreatedBy
    @Column(name = "created_by", updatable = false, length = 100)
    private String createdBy;
    
    @LastModifiedBy
    @Column(name = "updated_by", length = 100)
    private String updatedBy;
    
    // Getters y Setters
    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
    
    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
    
    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }
    
    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
    
    public String getCreatedBy() {
        return createdBy;
    }
    
    public void setCreatedBy(String createdBy) {
        this.createdBy = createdBy;
    }
    
    public String getUpdatedBy() {
        return updatedBy;
    }
    
    public void setUpdatedBy(String updatedBy) {
        this.updatedBy = updatedBy;
    }
}
```

---

#### 2. Configuración de AuditorAware Bean

**Ubicación:** `src/{package}/shared/config/AuditConfig.java`

```java
package com.yourproject.shared.config;

import java.util.Optional;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.AuditorAware;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

@Configuration
@EnableJpaAuditing(auditorAwareRef = "auditorProvider")
public class AuditConfig {
    
    @Bean
    public AuditorAware<String> auditorProvider() {
        return new AuditorAwareImpl();
    }
    
    /**
     * Implementación que obtiene el usuario actual del contexto de seguridad
     */
    public static class AuditorAwareImpl implements AuditorAware<String> {
        
        @Override
        public Optional<String> getCurrentAuditor() {
            Authentication authentication = SecurityContextHolder
                .getContext()
                .getAuthentication();
            
            if (authentication == null || !authentication.isAuthenticated()) {
                return Optional.of("system");
            }
            
            // Si el usuario es anónimo
            if ("anonymousUser".equals(authentication.getPrincipal())) {
                return Optional.of("anonymous");
            }
            
            // Retorna el username del usuario autenticado
            return Optional.of(authentication.getName());
        }
    }
}
```

---

#### 3. Alternativa: Sin Spring Security

Si el proyecto **no usa Spring Security**:

##### Opción A: ThreadLocal personalizado

```java
public class UserContext {
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

@Bean
public AuditorAware<String> auditorProvider() {
    return () -> {
        String user = UserContext.getCurrentUser();
        return Optional.ofNullable(user != null ? user : "system");
    };
}
```

**Uso en controladores:**
```java
@PostMapping
public ResponseEntity<OrderDto> create(@RequestBody CreateOrderDto dto,
                                       @RequestHeader("X-User-Id") String userId) {
    UserContext.setCurrentUser(userId);
    try {
        return orderService.create(dto);
    } finally {
        UserContext.clear();
    }
}
```

##### Opción B: JWT Token

```java
@Bean
public AuditorAware<String> auditorProvider() {
    return () -> {
        ServletRequestAttributes attributes = 
            (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        
        if (attributes == null) {
            return Optional.of("system");
        }
        
        HttpServletRequest request = attributes.getRequest();
        String token = request.getHeader("Authorization");
        
        if (token != null && token.startsWith("Bearer ")) {
            String jwt = token.substring(7);
            String username = jwtService.extractUsername(jwt);
            return Optional.of(username);
        }
        
        return Optional.of("anonymous");
    };
}
```

---

#### 4. Sintaxis en domain.yaml

**Opción Simple (actual):**
```yaml
entities:
  - name: order
    isRoot: true
    auditable: true    # Solo createdAt, updatedAt
```

**Opción Completa (futuro):**
```yaml
entities:
  - name: order
    isRoot: true
    audit:
      enabled: true
      trackUser: true       # ← Agrega createdBy, updatedBy
```

---

#### 5. Lógica de Generación

```javascript
// En yaml-to-entity.js
function parseEntity(entityData) {
  const audit = {
    enabled: false,
    trackUser: false
  };
  
  // Compatibilidad con auditable: true (actual)
  if (entityData.auditable === true) {
    audit.enabled = true;
    audit.trackUser = false;
  }
  
  // Nueva sintaxis audit: {}
  if (entityData.audit) {
    audit.enabled = entityData.audit.enabled === true;
    audit.trackUser = entityData.audit.trackUser === true;
  }
  
  return {
    name: entityData.name,
    audit,
    // ... resto de campos
  };
}
```

**En template JpaEntity.java.ejs:**
```java
<%_ if (entity.audit.enabled && entity.audit.trackUser) { _%>
public class <%= entity.className %>Jpa extends FullAuditableEntity {
<%_ } else if (entity.audit.enabled) { _%>
public class <%= entity.className %>Jpa extends AuditableEntity {
<%_ } else { _%>
public class <%= entity.className %>Jpa {
<%_ } _%>
```

---

### Estructura de Tabla en BD

```sql
-- Con auditable: true
CREATE TABLE orders (
    id VARCHAR(36) PRIMARY KEY,
    order_number VARCHAR(50),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

-- Con audit: { enabled: true, trackUser: true }
CREATE TABLE orders (
    id VARCHAR(36) PRIMARY KEY,
    order_number VARCHAR(50),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    created_by VARCHAR(100),      -- ← Nuevo
    updated_by VARCHAR(100)       -- ← Nuevo
);
```

---

### Ejemplo Completo de Uso

```yaml
# domain.yaml
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
          - name: orderNumber
            type: String
          - name: customerId
            type: String
          - name: totalAmount
            type: BigDecimal
```

**Código generado - OrderJpa.java:**
```java
@Entity
@Table(name = "orders")
public class OrderJpa extends FullAuditableEntity {
    
    @Id
    private String id;
    
    @Column(name = "order_number")
    private String orderNumber;
    
    @Column(name = "customer_id")
    private String customerId;
    
    @Column(name = "total_amount")
    private BigDecimal totalAmount;
    
    // Hereda: createdAt, updatedAt, createdBy, updatedBy
}
```

**Uso en aplicación:**
```java
// Al crear una orden (usuario: john@example.com autenticado)
Order order = new Order();
order.setOrderNumber("ORD-001");
orderRepository.save(order);

// Resultado en BD:
// created_at: 2026-02-03 10:30:00
// updated_at: 2026-02-03 10:30:00
// created_by: john@example.com
// updated_by: john@example.com

// Al actualizar (usuario: jane@example.com autenticado)
order.setTotalAmount(BigDecimal.valueOf(150.00));
orderRepository.save(order);

// Resultado en BD:
// created_at: 2026-02-03 10:30:00   (sin cambios)
// updated_at: 2026-02-03 14:15:00   (actualizado)
// created_by: john@example.com       (sin cambios)
// updated_by: jane@example.com       (actualizado)
```

---

### Beneficios de trackUser

1. ✅ **Trazabilidad completa** - Saber quién hizo qué cambio
2. ✅ **Auditoría de seguridad** - Cumplir con regulaciones (GDPR, SOC2)
3. ✅ **Debugging** - Identificar quién causó un problema
4. ✅ **Análisis de negocio** - Métricas de actividad por usuario
5. ✅ **Rollback informado** - Restaurar con contexto de quién cambió

---

### Consideraciones de Seguridad

1. **PII (Personal Identifiable Information)**
   - ⚠️ `createdBy`/`updatedBy` pueden contener información personal
   - Considerar encriptación en columnas sensibles
   - Cumplir con GDPR para anonimización

2. **Autenticación requerida**
   - ⚠️ Requiere que el proyecto tenga Spring Security o similar
   - Alternativa: Header personalizado con middleware

3. **Auditoria de la auditoría**
   - ✅ Los propios campos de auditoría no deberían ser editables manualmente
   - ✅ JPA listeners garantizan valores correctos

---

## Soft Delete Avanzado

### Descripción

Implementación de soft delete para marcar registros como eliminados sin borrarlos físicamente de la base de datos.

### Sintaxis Propuesta

```yaml
entities:
  - name: order
    isRoot: true
    softDelete: true    # ← Agrega deletedAt, deleted
```

**Campos generados:**
- `deletedAt: LocalDateTime` - Timestamp de eliminación
- `deleted: Boolean` - Flag de eliminación (default: false)

### Clase Base

```java
@MappedSuperclass
public abstract class SoftDeletableEntity {
    
    @Column(name = "deleted")
    private Boolean deleted = false;
    
    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;
    
    public void softDelete() {
        this.deleted = true;
        this.deletedAt = LocalDateTime.now();
    }
    
    public void restore() {
        this.deleted = false;
        this.deletedAt = null;
    }
}
```

---

## Validaciones JSR-303

### Descripción

Generación automática de validaciones Bean Validation en DTOs y entidades.

### Sintaxis Propuesta

```yaml
fields:
  - name: email
    type: String
    validations:
      - type: Email
        message: "Email inválido"
      - type: NotBlank
        message: "Email es requerido"
  
  - name: age
    type: Integer
    validations:
      - type: Min
        value: 18
      - type: Max
        value: 100
```

**Código generado:**
```java
@Email(message = "Email inválido")
@NotBlank(message = "Email es requerido")
private String email;

@Min(value = 18)
@Max(value = 100)
private Integer age;
```

---

## Prioridad de Implementación

| Característica | Prioridad | Complejidad | Dependencias |
|----------------|-----------|-------------|--------------|
| Auditoría de tiempo (`auditable: true`) | ✅ Alta | 🟢 Baja | Ninguna |
| Auditoría de usuario (`trackUser: true`) | 🚧 Media | 🟡 Media | Spring Security o alternativa |
| Soft Delete | 🚧 Media | 🟢 Baja | Ninguna |
| Validaciones JSR-303 | 📋 Baja | 🟡 Media | Hibernate Validator |

---

## Referencias

- [Spring Data JPA Auditing](https://docs.spring.io/spring-data/jpa/reference/auditing.html)
- [JPA EntityListeners](https://jakarta.ee/specifications/persistence/3.0/apidocs/jakarta.persistence/jakarta/persistence/entitylisteners)
- [Spring Security Authentication](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html)
- [Bean Validation (JSR-303)](https://beanvalidation.org/2.0/spec/)

---

**Última actualización:** 2026-02-03  
**Versión de eva4j:** 1.x  
**Estado:** Documento de planificación
