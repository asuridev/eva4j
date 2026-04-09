---
description: "Implementar todos los casos de uso pendientes de un bounded context. Detecta handlers con UnsupportedOperationException y los implementa uno a uno siguiendo la arquitectura DDD/hexagonal del proyecto."
argument-hint: "Nombre del módulo (ej: product-catalog, orders, customers)"
mode: "agent"
---

Vas a implementar **todos los casos de uso pendientes** del módulo `$ARGUMENTS` en este proyecto eva4j.

---

## Paso 1 — Descubrir el módulo

1. Busca el directorio del módulo bajo `src/main/java/` que corresponda a `$ARGUMENTS` (normaliza kebab-case → package name)
2. Confirma que existe `domain.yaml` en ese módulo
3. Lee `domain.yaml` completo — es la fuente de verdad del modelo

## Paso 2 — Leer la especificación funcional

1. Lee `system/$ARGUMENTS.md` — contiene la descripción detallada de cada caso de uso: tipo, precondiciones, postcondiciones, invariantes, validaciones, eventos emitidos
2. Si existe `system/system.md`, léelo para entender integraciones entre módulos

## Paso 3 — Inventariar handlers pendientes

### 3a. Handlers CQRS
1. Lista todos los archivos en `application/usecases/` del módulo
2. Lee cada handler (`*CommandHandler.java`, `*QueryHandler.java`) y clasifícalo:
   - ✅ **Implementado** — tiene lógica real
   - ❌ **Pendiente** — contiene `UnsupportedOperationException` o `throw new UnsupportedOperationException()`
3. **Ignora** archivos de workflow (`*WorkFlow.java`, `*WorkFlowImpl.java`, `*WorkFlowService.java`, `*Input.java`, `*DomainEventHandler.java`) — estos no se implementan aquí

### 3b. Temporal Activities (si el módulo tiene workflows)
1. Detecta si existen archivos `*WorkFlowImpl.java` en `application/usecases/`
2. Si existen, lee cada `WorkFlowImpl` para extraer **todas las activities** que orquesta (busca todos los `Workflow.newActivityStub(...)`)
3. Para cada activity, identifica:
   - El **módulo destino** (derivado del task queue: `ORDERS_LIGHT_TASK_QUEUE` → módulo `orders`)
   - Si es **local** (mismo módulo) o **cross-module** (task queue de otro módulo)
   - Si tiene **compensación** asociada (busca `saga.addCompensation(...)` inmediatamente después)
4. Lee cada `ActivityImpl` en `{targetModule}/infrastructure/adapters/activities/` y clasifícalo:
   - ✅ **Implementado** — tiene lógica real
   - ❌ **Pendiente** — contiene `UnsupportedOperationException`, `//todo`, o body vacío
5. Agrupa las activities pendientes por módulo destino

### 3c. Presentar inventario al usuario
Presenta la lista completa con el estado ANTES de comenzar:
```
## Handlers CQRS (módulo: shopping-carts)
- ✅ CreateShoppingCartCommandHandler — implementado
- ❌ CheckoutShoppingCartCommandHandler — pendiente

## Temporal Activities (workflow: PlaceOrder)
### Módulo: orders
- ❌ CreateOrderFromCartActivityImpl — pendiente
- ❌ ConfirmOrderActivityImpl — pendiente
### Módulo: inventory
- ❌ ReserveStockActivityImpl — pendiente
- ❌ ReleaseStockActivityImpl — pendiente (compensación)
### Módulo: payments
- ❌ ProcessPaymentActivityImpl — pendiente
```

## Paso 4 — Implementar cada handler/activity pendiente

### 4a. Implementar handlers CQRS pendientes

Para cada handler CQRS pendiente, sigue este flujo **en orden**:

#### Recopilar contexto del caso de uso
- Lee la sección del caso de uso en el `.md` del módulo
- Lee el Command/Query record correspondiente
- Lee la entidad de dominio involucrada
- Lee el repositorio de dominio (interfaz)
- Lee el Application Mapper
- Lee el DTO de respuesta (si aplica)

#### Implementar siguiendo los patrones
Aplica el patrón correcto según el tipo de caso de uso:

| Tipo | Patrón |
|------|--------|
| Query por ID | `repository.findById()` → mapear a DTO → retornar |
| Query paginada | `PageRequest.of()` → repositorio → `PagedResponse.of()` |
| Query con filtros | Agregar método en repositorio (3 archivos) → handler |
| Command crear | Validar → construir entidad → `repository.save()` → retornar ID |
| Command actualizar | Buscar → merge PATCH → `repository.save()` |
| Command transición | Buscar → método de negocio → `repository.save()` |
| Command soft delete | Buscar → `entity.softDelete()` → `repository.save()` |
| Command hard delete | Buscar → `repository.delete()` |

### 4b. Implementar Temporal Activities pendientes

Para las activities Temporal, **agrupa por módulo destino** e implementa todas las de un módulo antes de pasar al siguiente (así el contexto del dominio está fresco).

#### Para cada módulo destino:
1. Lee la entidad de dominio, repositorio, y enums del módulo destino
2. Lee el `WorkFlowImpl` para entender qué datos pasa como Input y qué espera como Output
3. Lee el contrato de la activity (interfaz + Input + Output):
   - Cross-module: `shared/domain/contracts/{module}/`
   - Local: `{module}/application/ports/` + `{module}/application/dtos/temporal/`

#### Implementar según el tipo de activity:

| Tipo | Patrón |
|------|--------|
| Activity con output | Construir entidad desde Input → persistir → retornar Output |
| Activity void (transición) | Buscar entidad → método de negocio → `repository.save()` |
| Activity de compensación | Buscar entidad → método inverso → `repository.save()` |
| Activity de lectura | Buscar entidad → mapear a Output → retornar |
| Activity con servicio externo | Crear entidad → llamar puerto externo → transicionar estado |

#### Reglas específicas para activities:
- `@Component` + `@RequiredArgsConstructor` (NO `@ApplicationComponent`)
- Implementar **dos interfaces**: contrato `{Activity}Activity` + marker `{Module}Light/HeavyActivity`
- **NO** usar `@Transactional` ni `@LogExceptions`
- **SOLO** inyectar repositorios del propio módulo — datos de otros módulos llegan vía Input
- **NO** modificar los contratos en `shared/domain/contracts/`

### 4c. Si necesitas agregar un método al repositorio
Siempre modifica **3 archivos**:
1. `domain/repositories/{Entity}Repository.java` — interfaz
2. `infrastructure/database/repositories/{Entity}JpaRepository.java` — Spring Data
3. `infrastructure/database/repositories/{Entity}RepositoryImpl.java` — implementación

### 4d. Marcar como completado
Después de implementar cada handler, confírmalo y pasa al siguiente.

## Paso 5 — Reglas inviolables

Mientras implementas, respeta estas reglas SIN EXCEPCIÓN:

### Dominio
- **NUNCA** setters en entidades de dominio — usar métodos de negocio
- **NUNCA** constructor vacío en entidades de dominio
- **NUNCA** imports de Spring/JPA/infraestructura en `domain/`
- Transiciones de estado vía `this.status.transitionTo(TargetStatus)`

### Aplicación
- **NUNCA** inyectar `JpaRepository` — usar interfaz de dominio `{Entity}Repository`
- **NUNCA** devolver entidades de dominio — siempre mapear a DTO
- **NUNCA** mapear `createdBy`/`updatedBy` en DTOs de respuesta
- **NUNCA** incluir campos `readOnly` en `CreateCommand`
- **NUNCA** incluir campos `hidden` en ResponseDto
- `@Transactional` para commands, `@Transactional(readOnly = true)` para queries

### Infraestructura
- **NUNCA** mapear campos de auditoría en builder JPA
- Con soft delete: **NUNCA** `deleteById()` — usar `softDelete()` + `save()`

### Excepciones
- `NotFoundException` → 404
- `BusinessException` → 422
- `InvalidStateTransitionException` → 409

### Temporal Activities
- Cada activity accede **SOLO** a la BD de su propio módulo
- **NUNCA** `@Transactional` en activities
- **NUNCA** modificar contratos en `shared/domain/contracts/`
- Activities implementan interfaz del contrato + marker `{Module}Light/HeavyActivity`
- Compensaciones son idempotentes — ejecutar 2 veces no causa error
- El `WorkFlowImpl` es la spec funcional: Input = datos disponibles, Output = datos que el workflow consume

## Paso 6 — Verificación final

Después de implementar todos los handlers y activities:
1. Lista los handlers CQRS implementados con un resumen de lo que hace cada uno
2. Lista las activities Temporal implementadas, agrupadas por módulo destino
3. Verifica que no queden `UnsupportedOperationException` ni `//todo` en:
   - `{module}/application/usecases/` (handlers CQRS)
   - `{module}/infrastructure/adapters/activities/` (activities locales)
   - Cada `{targetModule}/infrastructure/adapters/activities/` (activities cross-module)
4. Señala si algún handler/activity requiere lógica adicional que no pudiste resolver (ej: método de negocio que no existe en la entidad, integración externa no definida en el `.md`)
