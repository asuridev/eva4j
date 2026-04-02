# Guía práctica: Camunda DMN desde cero

Guía paso a paso para aprender DMN (Decision Model and Notation) con Camunda Platform, desde levantar el servidor hasta integrarlo con Spring Boot.

---

## Table of Contents

1. [Levantar Camunda con Docker Compose](#1-levantar-camunda-con-docker-compose)
2. [Conceptos fundamentales de DMN](#2-conceptos-fundamentales-de-dmn)
3. [Ejemplo 1 — Aprobación de crédito (FIRST)](#3-ejemplo-1--aprobación-de-crédito-first)
4. [Ejemplo 2 — Beneficios de membresía (COLLECT)](#4-ejemplo-2--beneficios-de-membresía-collect)
5. [Ejemplo 3 — Precio dinámico con FEEL (UNIQUE)](#5-ejemplo-3--precio-dinámico-con-feel-unique)
6. [Ejemplo 4 — Cadena de decisiones DRG](#6-ejemplo-4--cadena-de-decisiones-drg)
7. [Ejemplo 5 — Asignación de tickets (RULE ORDER)](#7-ejemplo-5--asignación-de-tickets-rule-order)
8. [API REST de Camunda — Referencia completa](#8-api-rest-de-camunda--referencia-completa)
9. [Consumir desde Spring Boot (sin eva4j)](#9-consumir-desde-spring-boot-sin-eva4j)
10. [Integración futura con eva4j](#10-integración-futura-con-eva4j)

---

## 1. Levantar Camunda con Docker Compose

### docker-compose.yml

```yaml
version: '3.8'

services:
  camunda:
    image: camunda/camunda-bpm-platform:7.21.0
    container_name: camunda-engine
    ports:
      - "8090:8080"
    environment:
      - DB_DRIVER=org.h2.Driver
      - DB_URL=jdbc:h2:./camundadb;DB_CLOSE_DELAY=-1
      - DB_USERNAME=sa
      - DB_PASSWORD=sa
      - CAMUNDA_BPM_ADMIN_USER_ID=admin
      - CAMUNDA_BPM_ADMIN_USER_PASSWORD=admin
    volumes:
      - camunda-data:/camunda/camundadb
      - ./deployments:/camunda/configuration/resources

volumes:
  camunda-data:
```

### Comandos

```bash
# Preparar directorio de reglas y levantar
mkdir -p deployments
docker-compose up -d

# Verificar logs
docker logs -f camunda-engine

# Detener
docker-compose down
```

### URLs disponibles

| URL | Propósito |
|-----|-----------|
| `http://localhost:8090/camunda/app/welcome/` | Portal principal (login: `admin` / `admin`) |
| `http://localhost:8090/camunda/app/cockpit/` | Monitoreo de procesos y decisiones |
| `http://localhost:8090/camunda/app/tasklist/` | Lista de tareas humanas |
| `http://localhost:8090/engine-rest/` | REST API para integración programática |

---

## 2. Conceptos fundamentales de DMN

### Anatomía de una Decision Table

```
┌─────────────────────────────────────────────────┐
│                  DMN DECISION                    │
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  INPUT    │ →  │  RULES   │ →  │  OUTPUT  │  │
│  │  (datos)  │    │  (tabla) │    │ (result) │  │
│  └──────────┘    └──────────┘    └──────────┘  │
│                                                  │
│  Hit Policy: cómo se seleccionan las filas       │
│  Lenguaje: FEEL (Friendly Enough Expression)     │
└─────────────────────────────────────────────────┘
```

### Hit Policies

Determinan **cuántas filas** del resultado se retornan y en qué orden:

| Policy | Símbolo | Comportamiento | Cuándo usarla |
|--------|:-------:|----------------|---------------|
| **UNIQUE** | U | Exactamente una regla debe coincidir | Clasificaciones mutuamente excluyentes |
| **FIRST** | F | Primera regla que coincida (orden importa) | Reglas con prioridad / fallbacks |
| **RULE ORDER** | R | Todas las que coinciden, en orden de tabla | Pasos secuenciales, listas priorizadas |
| **COLLECT** | C | Todas las que coinciden (agregable: SUM, MIN, MAX, COUNT) | Acumular beneficios, permisos, coberturas |
| **ANY** | A | Varias reglas pueden coincidir si dan el mismo resultado | Validación de consistencia |

### FEEL — Expresiones en celdas

FEEL (Friendly Enough Expression Language) es el lenguaje estándar de DMN:

| Expresión | Significado | Ejemplo |
|-----------|-------------|---------|
| `"HIGH"` | Igualdad exacta | String match |
| `> 1000` | Mayor que | Numéricos |
| `[18..65]` | Rango inclusivo | Edad entre 18 y 65 |
| `< date("2025-01-01")` | Comparación de fecha | Antes de 2025 |
| `"A","B","C"` | Lista de valores | Cualquiera de los tres |
| `not("X")` | Negación | Cualquier cosa excepto X |
| *(vacío)* | Cualquier valor (wildcard) | Sin restricción |

### Tipos de datos soportados

| Tipo DMN | Ejemplo | Notas |
|----------|---------|-------|
| `string` | `"PREMIUM"` | Siempre entre comillas en reglas |
| `integer` | `42` | Enteros |
| `long` | `100000000` | Enteros grandes |
| `double` | `0.085` | Decimales |
| `boolean` | `true` / `false` | |
| `date` | `date("2025-06-15")` | ISO 8601 en FEEL |

---

## 3. Ejemplo 1 — Aprobación de crédito (FIRST)

**Escenario:** Un banco evalúa solicitudes de crédito personal según el score crediticio, ingreso mensual y monto solicitado. Se usa `FIRST` porque las reglas tienen prioridad descendente — la primera que coincide gana.

### Tabla de decisión visual

| # | Score Crediticio | Ingreso Mensual | Monto Solicitado | → Decisión | → Tasa Interés | → Requiere Revisión |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | < 500 | — | — | RECHAZADO | — | false |
| 2 | [500..650] | — | > 500000 | RECHAZADO | — | true |
| 3 | [500..650] | >= 30000 | — | APROBADO_CONDICIONAL | 18.5 | true |
| 4 | [651..750] | — | — | APROBADO | 14.0 | false |
| 5 | > 750 | — | — | APROBADO | 10.5 | false |
| 6 | — | — | — | PENDIENTE_REVISION | — | true |

### Archivo DMN

Crear `deployments/credit-approval.dmn`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="credit-approval" name="Credit Approval"
             namespace="http://camunda.org/schema/1.0/dmn">

  <decision id="evaluateCredit" name="Evaluate Credit Application">
    <decisionTable id="dt_credit" hitPolicy="FIRST">

      <!-- INPUTS -->
      <input id="i_score" label="Credit Score">
        <inputExpression id="ie_score" typeRef="integer">
          <text>creditScore</text>
        </inputExpression>
      </input>

      <input id="i_income" label="Monthly Income">
        <inputExpression id="ie_income" typeRef="double">
          <text>monthlyIncome</text>
        </inputExpression>
      </input>

      <input id="i_amount" label="Requested Amount">
        <inputExpression id="ie_amount" typeRef="double">
          <text>requestedAmount</text>
        </inputExpression>
      </input>

      <!-- OUTPUTS -->
      <output id="o_decision" label="Decision" name="decision" typeRef="string">
        <outputValues>
          <text>"RECHAZADO","APROBADO_CONDICIONAL","APROBADO","PENDIENTE_REVISION"</text>
        </outputValues>
      </output>

      <output id="o_rate" label="Interest Rate %" name="interestRate" typeRef="double"/>

      <output id="o_review" label="Requires Review" name="requiresReview" typeRef="boolean"/>

      <!-- RULES -->

      <!-- Rule 1: Score muy bajo → rechazo directo -->
      <rule id="r1">
        <description>Score crediticio muy bajo — rechazo automático</description>
        <inputEntry id="r1_i1"><text>&lt; 500</text></inputEntry>
        <inputEntry id="r1_i2"><text></text></inputEntry>
        <inputEntry id="r1_i3"><text></text></inputEntry>
        <outputEntry id="r1_o1"><text>"RECHAZADO"</text></outputEntry>
        <outputEntry id="r1_o2"><text></text></outputEntry>
        <outputEntry id="r1_o3"><text>false</text></outputEntry>
      </rule>

      <!-- Rule 2: Score medio-bajo + monto alto → rechazo con revisión -->
      <rule id="r2">
        <description>Score medio-bajo con monto elevado</description>
        <inputEntry id="r2_i1"><text>[500..650]</text></inputEntry>
        <inputEntry id="r2_i2"><text></text></inputEntry>
        <inputEntry id="r2_i3"><text>&gt; 500000</text></inputEntry>
        <outputEntry id="r2_o1"><text>"RECHAZADO"</text></outputEntry>
        <outputEntry id="r2_o2"><text></text></outputEntry>
        <outputEntry id="r2_o3"><text>true</text></outputEntry>
      </rule>

      <!-- Rule 3: Score medio-bajo pero buen ingreso → aprobado condicional -->
      <rule id="r3">
        <description>Score medio-bajo con ingreso suficiente</description>
        <inputEntry id="r3_i1"><text>[500..650]</text></inputEntry>
        <inputEntry id="r3_i2"><text>&gt;= 30000</text></inputEntry>
        <inputEntry id="r3_i3"><text></text></inputEntry>
        <outputEntry id="r3_o1"><text>"APROBADO_CONDICIONAL"</text></outputEntry>
        <outputEntry id="r3_o2"><text>18.5</text></outputEntry>
        <outputEntry id="r3_o3"><text>true</text></outputEntry>
      </rule>

      <!-- Rule 4: Score bueno → aprobado -->
      <rule id="r4">
        <description>Score crediticio bueno</description>
        <inputEntry id="r4_i1"><text>[651..750]</text></inputEntry>
        <inputEntry id="r4_i2"><text></text></inputEntry>
        <inputEntry id="r4_i3"><text></text></inputEntry>
        <outputEntry id="r4_o1"><text>"APROBADO"</text></outputEntry>
        <outputEntry id="r4_o2"><text>14.0</text></outputEntry>
        <outputEntry id="r4_o3"><text>false</text></outputEntry>
      </rule>

      <!-- Rule 5: Score excelente → aprobado con mejor tasa -->
      <rule id="r5">
        <description>Score crediticio excelente</description>
        <inputEntry id="r5_i1"><text>&gt; 750</text></inputEntry>
        <inputEntry id="r5_i2"><text></text></inputEntry>
        <inputEntry id="r5_i3"><text></text></inputEntry>
        <outputEntry id="r5_o1"><text>"APROBADO"</text></outputEntry>
        <outputEntry id="r5_o2"><text>10.5</text></outputEntry>
        <outputEntry id="r5_o3"><text>false</text></outputEntry>
      </rule>

      <!-- Rule 6: Default — caso no contemplado -->
      <rule id="r6">
        <description>Caso no contemplado — revisión manual</description>
        <inputEntry id="r6_i1"><text></text></inputEntry>
        <inputEntry id="r6_i2"><text></text></inputEntry>
        <inputEntry id="r6_i3"><text></text></inputEntry>
        <outputEntry id="r6_o1"><text>"PENDIENTE_REVISION"</text></outputEntry>
        <outputEntry id="r6_o2"><text></text></outputEntry>
        <outputEntry id="r6_o3"><text>true</text></outputEntry>
      </rule>

    </decisionTable>
  </decision>
</definitions>
```

### Deploy y pruebas

```bash
# Reiniciar para cargar la decisión
docker-compose restart camunda

# Test 1: Score excelente → APROBADO, tasa 10.5%
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/evaluateCredit/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "creditScore": { "value": 780, "type": "Integer" },
      "monthlyIncome": { "value": 45000, "type": "Double" },
      "requestedAmount": { "value": 200000, "type": "Double" }
    }
  }'
# → [{"decision":{"value":"APROBADO"},"interestRate":{"value":10.5},"requiresReview":{"value":false}}]

# Test 2: Score bajo → RECHAZADO
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/evaluateCredit/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "creditScore": { "value": 420, "type": "Integer" },
      "monthlyIncome": { "value": 15000, "type": "Double" },
      "requestedAmount": { "value": 100000, "type": "Double" }
    }
  }'
# → [{"decision":{"value":"RECHAZADO"},"requiresReview":{"value":false}}]

# Test 3: Score medio + buen ingreso → APROBADO_CONDICIONAL, tasa 18.5%
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/evaluateCredit/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "creditScore": { "value": 580, "type": "Integer" },
      "monthlyIncome": { "value": 50000, "type": "Double" },
      "requestedAmount": { "value": 150000, "type": "Double" }
    }
  }'
# → [{"decision":{"value":"APROBADO_CONDICIONAL"},"interestRate":{"value":18.5},"requiresReview":{"value":true}}]

# Test 4: Score medio + monto muy alto → RECHAZADO con revisión
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/evaluateCredit/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "creditScore": { "value": 600, "type": "Integer" },
      "monthlyIncome": { "value": 25000, "type": "Double" },
      "requestedAmount": { "value": 800000, "type": "Double" }
    }
  }'
# → [{"decision":{"value":"RECHAZADO"},"requiresReview":{"value":true}}]
```

---

## 4. Ejemplo 2 — Beneficios de membresía (COLLECT)

**Escenario:** Una plataforma de e-commerce determina qué beneficios obtiene un cliente según su nivel de membresía, antigüedad y gasto acumulado. Se usa `COLLECT` porque un cliente puede recibir **múltiples beneficios simultáneamente**.

### Tabla de decisión visual

| # | Nivel Membresía | Antigüedad (años) | Gasto Acumulado | → Beneficio | → Valor |
|---|:---:|:---:|:---:|:---:|:---:|
| 1 | — | — | — | ENVIO_GRATIS_BASICO | 100 |
| 2 | GOLD, PLATINUM | — | — | ENVIO_GRATIS_TOTAL | 100 |
| 3 | — | >= 2 | — | DESCUENTO_ANIVERSARIO | 5 |
| 4 | — | — | >= 50000 | DESCUENTO_VOLUMEN | 8 |
| 5 | PLATINUM | — | — | ACCESO_PREVENTAS | 100 |
| 6 | GOLD, PLATINUM | >= 3 | — | SOPORTE_PRIORITARIO | 100 |
| 7 | — | — | >= 100000 | GIFT_CARD_ANUAL | 500 |

### Archivo DMN

Crear `deployments/membership-benefits.dmn`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="membership-benefits" name="Membership Benefits"
             namespace="http://camunda.org/schema/1.0/dmn">

  <decision id="determineBenefits" name="Determine Membership Benefits">
    <decisionTable id="dt_benefits" hitPolicy="COLLECT">

      <!-- INPUTS -->
      <input id="i_level" label="Membership Level">
        <inputExpression id="ie_level" typeRef="string">
          <text>membershipLevel</text>
        </inputExpression>
        <inputValues><text>"BASIC","SILVER","GOLD","PLATINUM"</text></inputValues>
      </input>

      <input id="i_years" label="Years as Member">
        <inputExpression id="ie_years" typeRef="integer">
          <text>memberYears</text>
        </inputExpression>
      </input>

      <input id="i_spent" label="Total Spent">
        <inputExpression id="ie_spent" typeRef="double">
          <text>totalSpent</text>
        </inputExpression>
      </input>

      <!-- OUTPUTS -->
      <output id="o_benefit" label="Benefit" name="benefit" typeRef="string"/>
      <output id="o_value" label="Value" name="benefitValue" typeRef="double"/>

      <!-- RULES — todos se evalúan; se acumulan los que coinciden -->

      <!-- Rule 1: Envío gratis básico para todos -->
      <rule id="r1">
        <description>Todos los miembros tienen envío gratis en compras menores</description>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"ENVIO_GRATIS_BASICO"</text></outputEntry>
        <outputEntry><text>100</text></outputEntry>
      </rule>

      <!-- Rule 2: Envío gratis total para Gold/Platinum -->
      <rule id="r2">
        <description>Envío gratis sin límite de monto</description>
        <inputEntry><text>"GOLD","PLATINUM"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"ENVIO_GRATIS_TOTAL"</text></outputEntry>
        <outputEntry><text>100</text></outputEntry>
      </rule>

      <!-- Rule 3: Descuento por antigüedad -->
      <rule id="r3">
        <description>5% descuento a partir de 2 años como miembro</description>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>&gt;= 2</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"DESCUENTO_ANIVERSARIO"</text></outputEntry>
        <outputEntry><text>5</text></outputEntry>
      </rule>

      <!-- Rule 4: Descuento por volumen de compra -->
      <rule id="r4">
        <description>8% descuento para clientes con alto gasto acumulado</description>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>&gt;= 50000</text></inputEntry>
        <outputEntry><text>"DESCUENTO_VOLUMEN"</text></outputEntry>
        <outputEntry><text>8</text></outputEntry>
      </rule>

      <!-- Rule 5: Acceso a preventas exclusivas -->
      <rule id="r5">
        <description>Solo Platinum accede a preventas</description>
        <inputEntry><text>"PLATINUM"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"ACCESO_PREVENTAS"</text></outputEntry>
        <outputEntry><text>100</text></outputEntry>
      </rule>

      <!-- Rule 6: Soporte prioritario -->
      <rule id="r6">
        <description>Gold/Platinum con 3+ años: soporte prioritario</description>
        <inputEntry><text>"GOLD","PLATINUM"</text></inputEntry>
        <inputEntry><text>&gt;= 3</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"SOPORTE_PRIORITARIO"</text></outputEntry>
        <outputEntry><text>100</text></outputEntry>
      </rule>

      <!-- Rule 7: Gift card anual por alto gasto -->
      <rule id="r7">
        <description>Gift card de $500 para clientes con 100k+ de gasto</description>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>&gt;= 100000</text></inputEntry>
        <outputEntry><text>"GIFT_CARD_ANUAL"</text></outputEntry>
        <outputEntry><text>500</text></outputEntry>
      </rule>

    </decisionTable>
  </decision>
</definitions>
```

### Deploy y pruebas

```bash
docker-compose restart camunda

# Test 1: Cliente Platinum, 5 años, $120k gastados → TODOS los beneficios
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/determineBenefits/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "membershipLevel": { "value": "PLATINUM", "type": "String" },
      "memberYears": { "value": 5, "type": "Integer" },
      "totalSpent": { "value": 120000, "type": "Double" }
    }
  }'
# → 7 beneficios (todos aplican)

# Test 2: Cliente Basic, 1 año, $10k → solo envío gratis básico
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/determineBenefits/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "membershipLevel": { "value": "BASIC", "type": "String" },
      "memberYears": { "value": 1, "type": "Integer" },
      "totalSpent": { "value": 10000, "type": "Double" }
    }
  }'
# → 1 beneficio: ENVIO_GRATIS_BASICO

# Test 3: Cliente Silver, 4 años, $80k → envío básico + aniversario + volumen
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/determineBenefits/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "membershipLevel": { "value": "SILVER", "type": "String" },
      "memberYears": { "value": 4, "type": "Integer" },
      "totalSpent": { "value": 80000, "type": "Double" }
    }
  }'
# → 3 beneficios: ENVIO_GRATIS_BASICO, DESCUENTO_ANIVERSARIO, DESCUENTO_VOLUMEN
```

---

## 5. Ejemplo 3 — Precio dinámico con FEEL (UNIQUE)

**Escenario:** Un hotel calcula el precio por noche según la temporada, tipo de habitación y si el huésped es miembro del programa de lealtad. Se usa `UNIQUE` porque cada combinación tiene exactamente un precio — si hay ambigüedad es un error de diseño.

### Archivo DMN

Crear `deployments/hotel-pricing.dmn`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="hotel-pricing" name="Hotel Dynamic Pricing"
             namespace="http://camunda.org/schema/1.0/dmn">

  <decision id="calculateRoomPrice" name="Calculate Room Price">
    <decisionTable id="dt_pricing" hitPolicy="UNIQUE">

      <!-- INPUTS -->
      <input id="i_season" label="Season">
        <inputExpression id="ie_season" typeRef="string">
          <text>season</text>
        </inputExpression>
        <inputValues><text>"HIGH","MEDIUM","LOW"</text></inputValues>
      </input>

      <input id="i_room" label="Room Type">
        <inputExpression id="ie_room" typeRef="string">
          <text>roomType</text>
        </inputExpression>
        <inputValues><text>"STANDARD","DELUXE","SUITE"</text></inputValues>
      </input>

      <input id="i_loyalty" label="Loyalty Member">
        <inputExpression id="ie_loyalty" typeRef="boolean">
          <text>isLoyaltyMember</text>
        </inputExpression>
      </input>

      <!-- OUTPUTS -->
      <output id="o_price" label="Base Price/Night" name="basePrice" typeRef="double"/>
      <output id="o_discount" label="Loyalty Discount %" name="loyaltyDiscount" typeRef="double"/>

      <!-- HIGH SEASON -->
      <rule id="r1">
        <inputEntry><text>"HIGH"</text></inputEntry>
        <inputEntry><text>"STANDARD"</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>2500</text></outputEntry>
        <outputEntry><text>10</text></outputEntry>
      </rule>
      <rule id="r2">
        <inputEntry><text>"HIGH"</text></inputEntry>
        <inputEntry><text>"STANDARD"</text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>2500</text></outputEntry>
        <outputEntry><text>0</text></outputEntry>
      </rule>
      <rule id="r3">
        <inputEntry><text>"HIGH"</text></inputEntry>
        <inputEntry><text>"DELUXE"</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>4200</text></outputEntry>
        <outputEntry><text>12</text></outputEntry>
      </rule>
      <rule id="r4">
        <inputEntry><text>"HIGH"</text></inputEntry>
        <inputEntry><text>"DELUXE"</text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>4200</text></outputEntry>
        <outputEntry><text>0</text></outputEntry>
      </rule>
      <rule id="r5">
        <inputEntry><text>"HIGH"</text></inputEntry>
        <inputEntry><text>"SUITE"</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>8500</text></outputEntry>
        <outputEntry><text>15</text></outputEntry>
      </rule>
      <rule id="r6">
        <inputEntry><text>"HIGH"</text></inputEntry>
        <inputEntry><text>"SUITE"</text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>8500</text></outputEntry>
        <outputEntry><text>0</text></outputEntry>
      </rule>

      <!-- MEDIUM SEASON -->
      <rule id="r7">
        <inputEntry><text>"MEDIUM"</text></inputEntry>
        <inputEntry><text>"STANDARD"</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>1800</text></outputEntry>
        <outputEntry><text>10</text></outputEntry>
      </rule>
      <rule id="r8">
        <inputEntry><text>"MEDIUM"</text></inputEntry>
        <inputEntry><text>"STANDARD"</text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>1800</text></outputEntry>
        <outputEntry><text>0</text></outputEntry>
      </rule>
      <rule id="r9">
        <inputEntry><text>"MEDIUM"</text></inputEntry>
        <inputEntry><text>"DELUXE"</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>3000</text></outputEntry>
        <outputEntry><text>12</text></outputEntry>
      </rule>
      <rule id="r10">
        <inputEntry><text>"MEDIUM"</text></inputEntry>
        <inputEntry><text>"DELUXE"</text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>3000</text></outputEntry>
        <outputEntry><text>0</text></outputEntry>
      </rule>
      <rule id="r11">
        <inputEntry><text>"MEDIUM"</text></inputEntry>
        <inputEntry><text>"SUITE"</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>6000</text></outputEntry>
        <outputEntry><text>15</text></outputEntry>
      </rule>
      <rule id="r12">
        <inputEntry><text>"MEDIUM"</text></inputEntry>
        <inputEntry><text>"SUITE"</text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>6000</text></outputEntry>
        <outputEntry><text>0</text></outputEntry>
      </rule>

      <!-- LOW SEASON -->
      <rule id="r13">
        <inputEntry><text>"LOW"</text></inputEntry>
        <inputEntry><text>"STANDARD"</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>1200</text></outputEntry>
        <outputEntry><text>10</text></outputEntry>
      </rule>
      <rule id="r14">
        <inputEntry><text>"LOW"</text></inputEntry>
        <inputEntry><text>"STANDARD"</text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>1200</text></outputEntry>
        <outputEntry><text>0</text></outputEntry>
      </rule>
      <rule id="r15">
        <inputEntry><text>"LOW"</text></inputEntry>
        <inputEntry><text>"DELUXE"</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>2000</text></outputEntry>
        <outputEntry><text>12</text></outputEntry>
      </rule>
      <rule id="r16">
        <inputEntry><text>"LOW"</text></inputEntry>
        <inputEntry><text>"DELUXE"</text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>2000</text></outputEntry>
        <outputEntry><text>0</text></outputEntry>
      </rule>
      <rule id="r17">
        <inputEntry><text>"LOW"</text></inputEntry>
        <inputEntry><text>"SUITE"</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>4000</text></outputEntry>
        <outputEntry><text>15</text></outputEntry>
      </rule>
      <rule id="r18">
        <inputEntry><text>"LOW"</text></inputEntry>
        <inputEntry><text>"SUITE"</text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>4000</text></outputEntry>
        <outputEntry><text>0</text></outputEntry>
      </rule>

    </decisionTable>
  </decision>
</definitions>
```

### Pruebas

```bash
docker-compose restart camunda

# Suite en temporada alta, miembro → $8500 - 15% = $7225 (precio final)
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/calculateRoomPrice/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "season": { "value": "HIGH", "type": "String" },
      "roomType": { "value": "SUITE", "type": "String" },
      "isLoyaltyMember": { "value": true, "type": "Boolean" }
    }
  }'
# → [{"basePrice":{"value":8500.0},"loyaltyDiscount":{"value":15.0}}]

# Standard en temporada baja, no miembro → $1200, sin descuento
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/calculateRoomPrice/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "season": { "value": "LOW", "type": "String" },
      "roomType": { "value": "STANDARD", "type": "String" },
      "isLoyaltyMember": { "value": false, "type": "Boolean" }
    }
  }'
# → [{"basePrice":{"value":1200.0},"loyaltyDiscount":{"value":0.0}}]
```

---

## 6. Ejemplo 4 — Cadena de decisiones DRG

**Escenario:** Un sistema de logística necesita dos decisiones encadenadas:
1. **Clasificar el paquete** según peso y volumen → determina la categoría
2. **Calcular el costo de envío** según la categoría (output de decisión 1) + distancia + urgencia

Camunda resuelve automáticamente la cadena: al evaluar la decisión 2, evalúa primero la decisión 1.

```
   ┌──────────────────┐     ┌───────────────────┐
   │ Classify Package  │────→│ Calculate Shipping │
   │ (peso, volumen)   │     │ (categoría + dist) │
   └──────────────────┘     └───────────────────┘
```

### Archivo DMN

Crear `deployments/shipping-drg.dmn`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="shipping-drg" name="Shipping Decision Requirements Graph"
             namespace="http://camunda.org/schema/1.0/dmn">

  <!-- Decision 1: Classify Package -->
  <decision id="classifyPackage" name="Classify Package">
    <decisionTable id="dt_classify" hitPolicy="FIRST">

      <input id="i_weight">
        <inputExpression typeRef="double"><text>weightKg</text></inputExpression>
      </input>
      <input id="i_volume">
        <inputExpression typeRef="double"><text>volumeCm3</text></inputExpression>
      </input>

      <output id="o_category" name="packageCategory" typeRef="string"/>
      <output id="o_handling" name="specialHandling" typeRef="boolean"/>

      <!-- Oversized: heavy OR very large volume -->
      <rule id="c1">
        <inputEntry><text>&gt; 30</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"OVERSIZED"</text></outputEntry>
        <outputEntry><text>true</text></outputEntry>
      </rule>
      <rule id="c2">
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>&gt; 500000</text></inputEntry>
        <outputEntry><text>"OVERSIZED"</text></outputEntry>
        <outputEntry><text>true</text></outputEntry>
      </rule>

      <!-- Large -->
      <rule id="c3">
        <inputEntry><text>[10..30]</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"LARGE"</text></outputEntry>
        <outputEntry><text>false</text></outputEntry>
      </rule>

      <!-- Medium -->
      <rule id="c4">
        <inputEntry><text>[2..10)</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"MEDIUM"</text></outputEntry>
        <outputEntry><text>false</text></outputEntry>
      </rule>

      <!-- Small (default) -->
      <rule id="c5">
        <inputEntry><text></text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"SMALL"</text></outputEntry>
        <outputEntry><text>false</text></outputEntry>
      </rule>

    </decisionTable>
  </decision>

  <!-- Decision 2: Calculate Shipping Cost (depends on classifyPackage) -->
  <decision id="calculateShipping" name="Calculate Shipping Cost">
    <informationRequirement>
      <requiredDecision href="#classifyPackage"/>
    </informationRequirement>

    <decisionTable id="dt_shipping" hitPolicy="FIRST">

      <input id="i_cat">
        <inputExpression typeRef="string">
          <text>classifyPackage.packageCategory</text>
        </inputExpression>
      </input>
      <input id="i_dist">
        <inputExpression typeRef="double"><text>distanceKm</text></inputExpression>
      </input>
      <input id="i_urgent">
        <inputExpression typeRef="boolean"><text>isUrgent</text></inputExpression>
      </input>

      <output id="o_cost" name="shippingCost" typeRef="double"/>
      <output id="o_days" name="estimatedDays" typeRef="integer"/>
      <output id="o_carrier" name="carrier" typeRef="string"/>

      <!-- OVERSIZED — siempre flete especial -->
      <rule id="s1">
        <inputEntry><text>"OVERSIZED"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>850</text></outputEntry>
        <outputEntry><text>2</text></outputEntry>
        <outputEntry><text>"FLETE_EXPRESS"</text></outputEntry>
      </rule>
      <rule id="s2">
        <inputEntry><text>"OVERSIZED"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>500</text></outputEntry>
        <outputEntry><text>5</text></outputEntry>
        <outputEntry><text>"FLETE_STANDARD"</text></outputEntry>
      </rule>

      <!-- LARGE + larga distancia -->
      <rule id="s3">
        <inputEntry><text>"LARGE"</text></inputEntry>
        <inputEntry><text>&gt; 500</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>350</text></outputEntry>
        <outputEntry><text>2</text></outputEntry>
        <outputEntry><text>"PAQUETERIA_EXPRESS"</text></outputEntry>
      </rule>
      <rule id="s4">
        <inputEntry><text>"LARGE"</text></inputEntry>
        <inputEntry><text>&gt; 500</text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>200</text></outputEntry>
        <outputEntry><text>5</text></outputEntry>
        <outputEntry><text>"PAQUETERIA_STANDARD"</text></outputEntry>
      </rule>
      <rule id="s5">
        <inputEntry><text>"LARGE"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>150</text></outputEntry>
        <outputEntry><text>3</text></outputEntry>
        <outputEntry><text>"PAQUETERIA_STANDARD"</text></outputEntry>
      </rule>

      <!-- MEDIUM -->
      <rule id="s6">
        <inputEntry><text>"MEDIUM"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>120</text></outputEntry>
        <outputEntry><text>1</text></outputEntry>
        <outputEntry><text>"COURIER_EXPRESS"</text></outputEntry>
      </rule>
      <rule id="s7">
        <inputEntry><text>"MEDIUM"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>75</text></outputEntry>
        <outputEntry><text>3</text></outputEntry>
        <outputEntry><text>"COURIER_STANDARD"</text></outputEntry>
      </rule>

      <!-- SMALL -->
      <rule id="s8">
        <inputEntry><text>"SMALL"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>80</text></outputEntry>
        <outputEntry><text>1</text></outputEntry>
        <outputEntry><text>"COURIER_EXPRESS"</text></outputEntry>
      </rule>
      <rule id="s9">
        <inputEntry><text>"SMALL"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>45</text></outputEntry>
        <outputEntry><text>4</text></outputEntry>
        <outputEntry><text>"CORREO_POSTAL"</text></outputEntry>
      </rule>

    </decisionTable>
  </decision>
</definitions>
```

### Pruebas

```bash
docker-compose restart camunda

# Paquete pesado (35kg), 800km, urgente → classifies as OVERSIZED → FLETE_EXPRESS $850
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/calculateShipping/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "weightKg": { "value": 35, "type": "Double" },
      "volumeCm3": { "value": 50000, "type": "Double" },
      "distanceKm": { "value": 800, "type": "Double" },
      "isUrgent": { "value": true, "type": "Boolean" }
    }
  }'
# → [{"shippingCost":{"value":850.0},"estimatedDays":{"value":2},"carrier":{"value":"FLETE_EXPRESS"}}]

# Paquete pequeño (0.5kg), 100km, no urgente → SMALL → CORREO_POSTAL $45
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/calculateShipping/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "weightKg": { "value": 0.5, "type": "Double" },
      "volumeCm3": { "value": 3000, "type": "Double" },
      "distanceKm": { "value": 100, "type": "Double" },
      "isUrgent": { "value": false, "type": "Boolean" }
    }
  }'
# → [{"shippingCost":{"value":45.0},"estimatedDays":{"value":4},"carrier":{"value":"CORREO_POSTAL"}}]

# Paquete mediano (5kg), 300km, urgente → MEDIUM → COURIER_EXPRESS $120, 1 día
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/calculateShipping/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "weightKg": { "value": 5, "type": "Double" },
      "volumeCm3": { "value": 30000, "type": "Double" },
      "distanceKm": { "value": 300, "type": "Double" },
      "isUrgent": { "value": true, "type": "Boolean" }
    }
  }'
# → [{"shippingCost":{"value":120.0},"estimatedDays":{"value":1},"carrier":{"value":"COURIER_EXPRESS"}}]
```

---

## 7. Ejemplo 5 — Asignación de tickets (RULE ORDER)

**Escenario:** Un sistema de helpdesk asigna tickets de soporte según la urgencia, categoría del problema y horario. Se usa `RULE ORDER` porque se necesita una **lista priorizada** de equipos candidatos — el sistema intenta asignar al primero disponible, si no, al segundo, etc.

### Archivo DMN

Crear `deployments/ticket-assignment.dmn`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             id="ticket-assignment" name="Ticket Assignment"
             namespace="http://camunda.org/schema/1.0/dmn">

  <decision id="assignTicket" name="Assign Support Ticket">
    <decisionTable id="dt_assign" hitPolicy="RULE ORDER">

      <!-- INPUTS -->
      <input id="i_urgency">
        <inputExpression typeRef="string"><text>urgency</text></inputExpression>
        <inputValues><text>"CRITICAL","HIGH","MEDIUM","LOW"</text></inputValues>
      </input>

      <input id="i_category">
        <inputExpression typeRef="string"><text>category</text></inputExpression>
        <inputValues><text>"INFRASTRUCTURE","APPLICATION","SECURITY","GENERAL"</text></inputValues>
      </input>

      <input id="i_business_hours">
        <inputExpression typeRef="boolean"><text>isBusinessHours</text></inputExpression>
      </input>

      <!-- OUTPUTS -->
      <output id="o_team" name="assignedTeam" typeRef="string"/>
      <output id="o_sla" name="slaHours" typeRef="integer"/>
      <output id="o_escalation" name="escalationLevel" typeRef="string"/>

      <!-- CRITICAL + Security → Security team first, then senior on-call -->
      <rule id="r1">
        <inputEntry><text>"CRITICAL"</text></inputEntry>
        <inputEntry><text>"SECURITY"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"SECURITY_RESPONSE"</text></outputEntry>
        <outputEntry><text>1</text></outputEntry>
        <outputEntry><text>"VP_ENGINEERING"</text></outputEntry>
      </rule>
      <rule id="r2">
        <inputEntry><text>"CRITICAL"</text></inputEntry>
        <inputEntry><text>"SECURITY"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"SENIOR_ON_CALL"</text></outputEntry>
        <outputEntry><text>1</text></outputEntry>
        <outputEntry><text>"CTO"</text></outputEntry>
      </rule>

      <!-- CRITICAL + Infrastructure → Infra team, then DevOps -->
      <rule id="r3">
        <inputEntry><text>"CRITICAL"</text></inputEntry>
        <inputEntry><text>"INFRASTRUCTURE"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"INFRASTRUCTURE_TEAM"</text></outputEntry>
        <outputEntry><text>2</text></outputEntry>
        <outputEntry><text>"ENGINEERING_MANAGER"</text></outputEntry>
      </rule>
      <rule id="r4">
        <inputEntry><text>"CRITICAL"</text></inputEntry>
        <inputEntry><text>"INFRASTRUCTURE"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"DEVOPS_ON_CALL"</text></outputEntry>
        <outputEntry><text>2</text></outputEntry>
        <outputEntry><text>"VP_ENGINEERING"</text></outputEntry>
      </rule>

      <!-- HIGH during business hours → specialized team -->
      <rule id="r5">
        <inputEntry><text>"HIGH"</text></inputEntry>
        <inputEntry><text>"APPLICATION"</text></inputEntry>
        <inputEntry><text>true</text></inputEntry>
        <outputEntry><text>"APP_SUPPORT_L2"</text></outputEntry>
        <outputEntry><text>4</text></outputEntry>
        <outputEntry><text>"TEAM_LEAD"</text></outputEntry>
      </rule>

      <!-- HIGH outside business hours → on-call -->
      <rule id="r6">
        <inputEntry><text>"HIGH"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text>false</text></inputEntry>
        <outputEntry><text>"ON_CALL_ROTATION"</text></outputEntry>
        <outputEntry><text>4</text></outputEntry>
        <outputEntry><text>"ENGINEERING_MANAGER"</text></outputEntry>
      </rule>

      <!-- MEDIUM → L1 support -->
      <rule id="r7">
        <inputEntry><text>"MEDIUM"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"SUPPORT_L1"</text></outputEntry>
        <outputEntry><text>8</text></outputEntry>
        <outputEntry><text>"TEAM_LEAD"</text></outputEntry>
      </rule>

      <!-- LOW → general queue -->
      <rule id="r8">
        <inputEntry><text>"LOW"</text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <inputEntry><text></text></inputEntry>
        <outputEntry><text>"GENERAL_QUEUE"</text></outputEntry>
        <outputEntry><text>24</text></outputEntry>
        <outputEntry><text>"NONE"</text></outputEntry>
      </rule>

    </decisionTable>
  </decision>
</definitions>
```

### Pruebas

```bash
docker-compose restart camunda

# Incidente crítico de seguridad → 2 candidatos en orden de prioridad
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/assignTicket/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "urgency": { "value": "CRITICAL", "type": "String" },
      "category": { "value": "SECURITY", "type": "String" },
      "isBusinessHours": { "value": false, "type": "Boolean" }
    }
  }'
# → [
#   {"assignedTeam":"SECURITY_RESPONSE","slaHours":1,"escalationLevel":"VP_ENGINEERING"},
#   {"assignedTeam":"SENIOR_ON_CALL","slaHours":1,"escalationLevel":"CTO"}
# ]

# Problema medio general → L1, SLA 8h
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/assignTicket/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "urgency": { "value": "MEDIUM", "type": "String" },
      "category": { "value": "GENERAL", "type": "String" },
      "isBusinessHours": { "value": true, "type": "Boolean" }
    }
  }'
# → [{"assignedTeam":"SUPPORT_L1","slaHours":8,"escalationLevel":"TEAM_LEAD"}]

# Ticket bajo → cola general, SLA 24h
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/assignTicket/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "urgency": { "value": "LOW", "type": "String" },
      "category": { "value": "APPLICATION", "type": "String" },
      "isBusinessHours": { "value": true, "type": "Boolean" }
    }
  }'
# → [{"assignedTeam":"GENERAL_QUEUE","slaHours":24,"escalationLevel":"NONE"}]
```

---

## 8. API REST de Camunda — Referencia completa

### Decisiones

```bash
# Listar todas las decisiones desplegadas
curl -s http://localhost:8090/engine-rest/decision-definition | python -m json.tool

# Obtener una decisión por key
curl -s http://localhost:8090/engine-rest/decision-definition/key/evaluateCredit

# Obtener el XML (.dmn) de una decisión
curl -s http://localhost:8090/engine-rest/decision-definition/key/evaluateCredit/xml

# Evaluar una decisión
curl -s -X POST \
  http://localhost:8090/engine-rest/decision-definition/key/{decisionKey}/evaluate \
  -H "Content-Type: application/json" \
  -d '{ "variables": { ... } }'

# Listar versiones de una decisión
curl -s "http://localhost:8090/engine-rest/decision-definition?key=evaluateCredit&sortBy=version&sortOrder=desc"
```

### Deployments

```bash
# Listar todos los deployments
curl -s http://localhost:8090/engine-rest/deployment | python -m json.tool

# Deploy programático (sin restart del container)
curl -X POST http://localhost:8090/engine-rest/deployment/create \
  -F "deployment-name=credit-rules-v2" \
  -F "deploy-changed-only=true" \
  -F "data=@deployments/credit-approval.dmn"

# Eliminar un deployment
curl -X DELETE "http://localhost:8090/engine-rest/deployment/{deploymentId}?cascade=true"
```

### Historial

```bash
# Historial de evaluaciones de una decisión
curl -s "http://localhost:8090/engine-rest/history/decision-instance?decisionDefinitionKey=evaluateCredit" \
  | python -m json.tool

# Detalle de una evaluación (inputs y outputs)
curl -s "http://localhost:8090/engine-rest/history/decision-instance/{instanceId}" \
  | python -m json.tool
```

### Formato de variables

Estructura estándar para enviar variables a Camunda:

```json
{
  "variables": {
    "stringVar":  { "value": "HELLO",    "type": "String" },
    "intVar":     { "value": 42,         "type": "Integer" },
    "longVar":    { "value": 100000000,  "type": "Long" },
    "doubleVar":  { "value": 3.14,       "type": "Double" },
    "boolVar":    { "value": true,       "type": "Boolean" },
    "dateVar":    { "value": "2026-04-02T10:00:00.000-0500", "type": "Date" }
  }
}
```

---

## 9. Consumir desde Spring Boot (sin eva4j)

### Dependencias (build.gradle)

```groovy
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.cloud:spring-cloud-starter-openfeign'
}
```

### Puerto de dominio

```java
// domain/repositories/CreditEvaluator.java
public interface CreditEvaluator {
    CreditDecision evaluate(int creditScore, double monthlyIncome, double requestedAmount);
}

// domain/models/CreditDecision.java
public record CreditDecision(
    String decision,
    Double interestRate,
    boolean requiresReview
) {}
```

### Feign Client a la REST API de Camunda

```java
// infrastructure/adapters/camunda/CamundaDmnClient.java
@FeignClient(name = "camunda-dmn", url = "${camunda.engine.base-url}")
public interface CamundaDmnClient {

    @PostMapping("/engine-rest/decision-definition/key/{decisionKey}/evaluate")
    List<Map<String, CamundaVariable>> evaluate(
        @PathVariable String decisionKey,
        @RequestBody CamundaEvaluateRequest request
    );
}

// infrastructure/adapters/camunda/CamundaVariable.java
public record CamundaVariable(String type, Object value) {}

// infrastructure/adapters/camunda/CamundaEvaluateRequest.java
public record CamundaEvaluateRequest(Map<String, CamundaVariable> variables) {}
```

### Adapter (ACL)

```java
// infrastructure/adapters/camunda/CamundaCreditEvaluator.java
@Component
public class CamundaCreditEvaluator implements CreditEvaluator {

    private final CamundaDmnClient dmnClient;

    public CamundaCreditEvaluator(CamundaDmnClient dmnClient) {
        this.dmnClient = dmnClient;
    }

    @Override
    public CreditDecision evaluate(int creditScore, double monthlyIncome,
                                   double requestedAmount) {
        var variables = Map.of(
            "creditScore",     new CamundaVariable("Integer", creditScore),
            "monthlyIncome",   new CamundaVariable("Double", monthlyIncome),
            "requestedAmount", new CamundaVariable("Double", requestedAmount)
        );

        var results = dmnClient.evaluate("evaluateCredit",
            new CamundaEvaluateRequest(variables));

        var result = results.get(0);

        return new CreditDecision(
            (String) result.get("decision").value(),
            result.containsKey("interestRate")
                ? (Double) result.get("interestRate").value()
                : null,
            (Boolean) result.get("requiresReview").value()
        );
    }
}
```

### Use Case

```java
// application/usecases/ProcessCreditApplicationHandler.java
@Component
public class ProcessCreditApplicationHandler {

    private final CreditEvaluator creditEvaluator;
    private final ApplicationRepository applicationRepository;

    public ProcessCreditApplicationHandler(CreditEvaluator creditEvaluator,
                                           ApplicationRepository applicationRepository) {
        this.creditEvaluator = creditEvaluator;
        this.applicationRepository = applicationRepository;
    }

    public void handle(ProcessCreditApplicationCommand command) {
        CreditApplication app = applicationRepository.findById(command.applicationId())
            .orElseThrow();

        // Delega la decisión al motor de reglas
        CreditDecision decision = creditEvaluator.evaluate(
            app.getCreditScore(),
            app.getMonthlyIncome(),
            app.getRequestedAmount()
        );

        app.applyDecision(decision);
        applicationRepository.save(app);
    }
}
```

### Configuración

```yaml
# application.yml
camunda:
  engine:
    base-url: http://localhost:8090
```

---

## 10. Integración futura con eva4j

### Lo que ya funciona hoy con `ports[]`

El lado consumidor (microservicio → Camunda) se puede declarar en `domain.yaml`:

```yaml
ports:
  - name: evaluateCredit
    service: CreditRuleEngine
    target: camunda-engine-external
    baseUrl: http://localhost:8090
    http: POST /engine-rest/decision-definition/key/evaluateCredit/evaluate
    body:
      - name: creditScore
        type: Integer
      - name: monthlyIncome
        type: BigDecimal
      - name: requestedAmount
        type: BigDecimal
    fields:
      - name: decision
        type: String
      - name: interestRate
        type: BigDecimal
      - name: requiresReview
        type: Boolean
```

Esto genera automáticamente: puerto de dominio, FeignClient, FeignAdapter con ACL, domain model, DTOs de infraestructura.

### Lo que se podría agregar

```bash
# Capacidad DMN nativa
eva add dmn-client

# Generar regla + consumidor en un solo comando
eva g dmn-rule credits EvaluateCredit
```

Generaría: archivo `.dmn` scaffold, puerto de dominio, Feign/gRPC client, ACL mapper, script de deploy a Camunda.

---

## Resumen del learning path

| Fase | Contenido | Tipo |
|------|-----------|------|
| 1 | Docker Compose | Infraestructura |
| 2 | Conceptos DMN (hit policies, FEEL, tipos) | Teoría |
| 3 | Aprobación de crédito (FIRST) | Hands-on |
| 4 | Beneficios de membresía (COLLECT) | Hands-on |
| 5 | Precio dinámico hotel (UNIQUE) | Hands-on |
| 6 | Cadena de decisiones logística (DRG) | Hands-on |
| 7 | Asignación de tickets (RULE ORDER) | Hands-on |
| 8 | API REST de Camunda | Referencia |
| 9 | Consumir desde Spring Boot | Integración |
| 10 | Integración con eva4j (ports[]) | Futuro |
