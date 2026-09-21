# 🏛️ Arquitectura de Bases de Datos de OrbiBot (Supabase & MongoDB)

Este documento detalla la arquitectura, el esquema relacional y documental, los diagramas entidad-relación y los diagramas de flujo de datos que rigen la persistencia de **OrbiBot**.

---

## 1. Visión General de la Arquitectura

OrbiBot implementa un patrón de **Persistencia Políglota con Doble Respaldo Activo (Dual-Write)**:
- **Base de Datos Principal:** **Supabase (PostgreSQL 15+)** para gestión relacional, autenticación OAuth, políticas de seguridad a nivel de fila (**RLS**) y almacenamiento estructurado `JSONB`.
- **Base de Datos Secundaria:** **MongoDB Atlas (M0/Serverless)** para almacenamiento distribuido de documentos, tolerancia a particiones, respaldo automático y validación mediante `$jsonSchema`.
- **Caché Local de Búfer:** Archivos JSON locales en `data/` para arranque en frío inmediato y funcionamiento offline de emergencia.

```mermaid
graph TD
    subgraph Clientes ["🖥️ Clientes & Interfaces"]
        UI["Panel de Control / Dashboard Web (docs/index.html)"]
        OBS["Overlays OBS (Alertas, TTS, Metas, Widget SR)"]
        BOT["Bots de Chat (Twitch IRC & Kick WebSocket)"]
    end

    subgraph Backend ["⚡ Servidor OrbiBot (Express & WS)"]
        API["API REST (/api/config, /api/auth, etc.)"]
        STORAGE["StorageService (src/services/storage.js)"]
        CACHE["Caché Local / Búfer (data/*.json)"]
    end

    subgraph CloudDB ["☁️ Bases de Datos en la Nube (Doble Respaldo)"]
        subgraph SupabaseCloud ["🟢 Supabase (PostgreSQL)"]
            SB_SETTINGS["orbibot_settings (Multi-Tenant KV)"]
            SB_STREAMERS["orbibot_streamers (Perfiles)"]
            SB_ADMINS["orbibot_admins (Superadmins & RBAC)"]
            SB_AUDIT["orbibot_audit_logs (Trazabilidad)"]
            SB_HEARTBEAT["orbibot_heartbeats (Keep-Alive)"]
        end

        subgraph MongoCloud ["🍃 MongoDB Atlas"]
            MG_SETTINGS["settings ({ streamer_id, key, value })"]
            MG_STREAMERS["streamers (Perfiles Canónicos)"]
            MG_ADMINS["admins (Superadmins)"]
            MG_USERS["users (Credenciales)"]
            MG_AUDIT["audit_logs (TTL 30 días)"]
            MG_HEARTBEAT["heartbeats (Ping 24/7)"]
        end
    end

    UI -->|HTTPS / REST| API
    OBS -->|WebSocket & REST| API
    BOT -->|Eventos de Chat| STORAGE

    API --> STORAGE
    STORAGE <--> CACHE

    STORAGE -->|Dual-Write Paralelo| SB_SETTINGS
    STORAGE -->|Dual-Write Paralelo| MG_SETTINGS

    STORAGE -.->|Heartbeat 5m| SB_HEARTBEAT
    STORAGE -.->|Heartbeat 5m| MG_HEARTBEAT
```

---

## 2. Diagrama Entidad-Relación (ERD Multi-Modelo)

```mermaid
erDiagram
    ORBIBOT_STREAMERS ||--o{ ORBIBOT_SETTINGS : "posee muchas configuraciones"
    ORBIBOT_STREAMERS ||--o{ ORBIBOT_AUDIT_LOGS : "genera registros"
    ORBIBOT_ADMINS ||--o{ ORBIBOT_AUDIT_LOGS : "ejecuta auditorias"

    ORBIBOT_STREAMERS {
        text id PK "Identificador canónico (ej: bersek___)"
        uuid user_id FK "Vínculo con auth.users en Supabase"
        text email "Correo electrónico del streamer"
        text channel_name "Nombre del canal en Twitch / Kick"
        text platform "twitch | kick | multistream"
        text display_name "Nombre visible"
        text avatar_url "URL de imagen de perfil"
        boolean is_active "Estado del streamer"
        jsonb metadata "Detalles de tokens y canales"
        timestamptz created_at "Fecha de registro"
        timestamptz updated_at "Última actividad"
    }

    ORBIBOT_SETTINGS {
        text streamer_id PK "Identificador del streamer o ámbito"
        text key PK "Clave: config, commands, alerts, tts_commands, etc."
        jsonb value "Payload estructurado con la data completa"
        timestamptz updated_at "Marca de tiempo de sincronización"
    }

    ORBIBOT_ADMINS {
        uuid id PK "Identificador único"
        text email UK "Correo del superadministrador"
        text role "superadmin | admin | support | moderator"
        text notes "Observaciones de la cuenta"
        jsonb permissions "Matriz de capacidades permitidas"
        timestamptz created_at "Fecha de concesión"
        timestamptz updated_at "Fecha de modificación"
    }

    ORBIBOT_AUDIT_LOGS {
        bigserial id PK "ID auto-incremental"
        text streamer_id "Streamer afectado"
        text actor_email "Usuario que ejecutó la acción"
        text action "Tipo de evento de seguridad"
        jsonb details "Payload con estado anterior y nuevo"
        text ip_address "IP de origen"
        timestamptz created_at "Marca de tiempo del suceso"
    }

    ORBIBOT_HEARTBEATS {
        text service_id PK "Instancia del servidor (orbibot-core)"
        text status "active | idle | degraded"
        timestamptz last_ping "Timestamp del último Keep-Alive"
        jsonb metadata "Versión del sistema y latencia"
    }
```

---

## 3. Diagramas de Flujo de Datos (Data Flowcharts)

### 3.1. Flujo de Escritura Concurrente (Dual-Write Resiliente)
Cada vez que un streamer edita comandos, voces TTS, alertas o configuraciones en el dashboard:

```mermaid
sequenceDiagram
    autonumber
    actor Streamer as 🧑‍💻 Streamer / Admin
    participant Dashboard as 🖥️ Dashboard UI
    participant Backend as ⚡ Express Backend
    participant Storage as 🗄️ StorageService
    participant LocalCache as 💾 Caché Local JSON
    participant Supabase as 🟢 Supabase (Postgres)
    participant MongoDB as 🍃 MongoDB Atlas

    Streamer->>Dashboard: Modifica ajuste (ej: volumen TTS / nuevo comando)
    Dashboard->>Backend: POST /api/save (scope: streamer_id, key, payload)
    Backend->>Storage: saveSetting(key, payload)
    Storage->>LocalCache: Escribe inmediatamente en disco local (Zero Lag)
    Backend-->>Dashboard: 200 OK (Respuesta ultra rápida al usuario)

    par Sincronización en Paralelo a Nube 1
        Storage->>Supabase: UPSERT orbibot_settings (streamer_id, key, value)
        alt Éxito Supabase
            Supabase-->>Storage: Confirmación de fila actualizada
        else Falla Supabase (timeout/mantenimiento)
            Supabase--xStorage: Error registrado silenciosamente
        end
    and Sincronización en Paralelo a Nube 2
        Storage->>MongoDB: updateOne({ streamer_id, key }, $set, upsert: true)
        alt Éxito MongoDB
            MongoDB-->>Storage: Acknowledged matched/upserted: 1
        else Falla MongoDB
            MongoDB--xStorage: Error registrado silenciosamente
        end
    end
```

---

### 3.2. Flujo de Lectura y Resolución Multi-Tenant con Fallback
Al arrancar el servidor o conectar un overlay de OBS:

```mermaid
flowchart TD
    Start(["🚀 Solicitud de Datos para Streamer X"]) --> Resolve["Determinar streamer_id canónico"]
    Resolve --> CheckSupabase{"¿Supabase disponible?"}

    CheckSupabase -- Sí --> QuerySB["SELECT * FROM orbibot_settings WHERE streamer_id = X"]
    QuerySB --> SBSuccess{"¿Datos encontrados?"}
    SBSuccess -- Sí --> ReturnSB["✅ Cargar datos desde Supabase y sincronizar búfer local"]
    SBSuccess -- No / Vacío --> CheckMongo

    CheckSupabase -- No / Error --> CheckMongo{"¿MongoDB Atlas disponible?"}
    CheckMongo -- Sí --> QueryMongo["db.settings.find({ streamer_id: X })"]
    QueryMongo --> MongoSuccess{"¿Datos encontrados?"}
    MongoSuccess -- Sí --> ReturnMongo["🍃 Cargar datos desde MongoDB Atlas y actualizar local"]
    MongoSuccess -- No / Error --> FallbackLocal["💾 Cargar desde archivos data/*.json locales (Modo Offline)"]

    ReturnSB --> End(["🏁 Configuración Lista y Activa"])
    ReturnMongo --> End
    FallbackLocal --> End
```

---

### 3.3. Ciclo Anti-Pausa 24/7 (Keep-Alive Heartbeat)
Tanto Supabase como MongoDB Atlas suspenden las bases de datos inactivas en sus planes comunitarios tras varios días de inactividad. OrbiBot previene esto de forma automatizada:

```mermaid
flowchart LR
    Timer(["⏰ Cronómetro Cada 5 Minutos"]) --> PingWorker["Worker de Mantenimiento"]
    PingWorker --> SupabasePing["🟢 Supabase: UPSERT en orbibot_heartbeats"]
    PingWorker --> MongoPing["🍃 MongoDB: db.command({ ping: 1 }) & UPSERT heartbeats"]
    SupabasePing --> CheckLatency["Calcular Latencia (ms)"]
    MongoPing --> CheckLatency
    CheckLatency --> ConsoleLog["💓 Log: Heartbeat Activo - Latencias Saludables"]
```

---

## 4. Estructura de Colecciones en MongoDB Atlas

| Colección | Propósito | Índices Principales | Regla $jsonSchema |
| :--- | :--- | :--- | :--- |
| **`streamers`** | Perfiles canónicos y canales | `{ streamer_id: 1 }` (UNIQUE) | Validación de tipos y campos requeridos |
| **`settings`** | Almacén Multi-Tenant | `{ streamer_id: 1, key: 1 }` (UNIQUE), `{ updated_at: -1 }` | `streamer_id`, `key`, `value` requeridos |
| **`admins`** | Superadministradores del sistema | `{ email: 1 }` (UNIQUE) | Email y rol (`superadmin`, `admin`, etc.) |
| **`users`** | Usuarios registrados | `{ email: 1 }` (UNIQUE) | Email y hash de contraseña |
| **`audit_logs`** | Auditoría de acciones críticas | `{ created_at: 1 }` (TTL: 30 días) | Auto-expiración para proteger cuotas de almacenamiento |
| **`heartbeats`** | Pings de diagnóstico y Anti-Pausa | `{ service_id: 1 }` (UNIQUE) | Timestamp y estado |

---

## 5. Guía de Ejecución y Mantenimiento

### 1. Aplicar Esquema en Supabase (SQL Editor)
Abre tu consola de Supabase:
👉 [https://supabase.com/dashboard/project/pzrlfuzjkwkrnmqkoaue/sql](https://supabase.com/dashboard/project/pzrlfuzjkwkrnmqkoaue/sql)

Copia y pega el contenido completo del archivo:
📄 `database/supabase_schema_v2.sql`

Presiona **"RUN"**. Esto creará:
- Las tablas `orbibot_streamers`, `orbibot_settings`, `orbibot_admins`, `orbibot_audit_logs`, `orbibot_heartbeats`.
- Los índices GIN y B-Tree de alto rendimiento.
- Las políticas de seguridad RLS.
- Las vistas de diagnóstico `v_streamer_health`.

### 2. Aplicar Validadores e Índices en MongoDB Atlas
Ejecuta desde la terminal de tu proyecto:
```bash
node database/mongo_schema_setup.js
```

### 3. Ejecutar Diagnóstico de Salud
Verifica en cualquier momento la latencia y sincronización de ambas nubes:
```bash
node scripts/maintain_databases.js
```
