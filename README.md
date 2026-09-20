# ⚡ OrbiBot (OrbyxBot)

Plataforma integral y modular para creadores de contenido y streamers en Twitch y Kick. Provee un panel de control web en tiempo real, bots de chat interactivos, sistema de peticiones de canciones (Song Request) con cola sincronizada, motor Text-To-Speech (TTS) multivoz y widgets transparentes listos para integrar en OBS Studio.

---

## 📌 Problema que resuelve

Gestionar un stream en vivo requiere coordinar múltiples herramientas independientes: bots de chat, reproductores de música, síntesis de voz (TTS) para donaciones o puntos de canal y overlays visuales para alertas. 

Esta fragmentación provoca:
- Alto consumo de recursos por múltiples aplicaciones en segundo plano.
- Desincronización entre el chat, las alertas y el contenido audiovisual en pantalla.
- Complejidad en la configuración y persistencia de datos al cambiar de dispositivo.

**OrbiBot** unifica estas funciones en un único servidor ligero y un panel de control centralizado, sincronizado en la nube (Supabase + MongoDB) y con soporte para múltiples plataformas simultáneas (Twitch y Kick).

---

## 🚀 Características principales

- **Autenticación y Conexión Directa**:
  - Integración vía OAuth2 con Twitch y Kick.
  - Sincronización automática de perfil, canal y eventos en tiempo real.
- **Bot de Chat Multiplataforma**:
  - Motores independientes para Twitch (IRC vía `tmi.js`) y Kick (WebSocket).
  - Comandos configurables con control de permisos y cooldowns.
  - Integración nativa con puntos de canal de Twitch.
- **Sistema de Song Request (SR)**:
  - Búsqueda directa e integración con YouTube.
  - Reproductor integrado con reproducción automática y sincronización de cola en tiempo real.
  - Comandos de control (`!sr`, `!song`, `!skip`, `!queue`).
  - Filtros de duración máxima, límite de canciones por usuario y niveles de acceso (todos, subs, moderadores).
- **Motor Text-To-Speech (TTS) Avanzado**:
  - Soporte de múltiples motores (TikTok TTS, StreamElements, Google Translate, Fish Audio).
  - Asignación de voces dinámicas por comandos (`!messi`, `!dross`, `!goku`, etc.).
  - Filtro y censura de palabras prohibidas.
  - Disparadores por comando de chat, bits y recompensas de puntos de canal.
- **Overlays para OBS Studio (Browser Sources)**:
  - **Alert Box**: Notificaciones visuales y sonoras para follows, subs, bits, donaciones y raids.
  - **Now Playing**: Widget de reproducción actual con carátula, ecualizador animado y detalles de la canción.
  - **Goal Bar**: Barras de progreso dinámicas para metas de seguidores, suscriptores o bits.
  - **TTS Player**: Receptor de audio dedicado para salida de voz en OBS sin interferir en el audio de escritorio.
  - **Chat Overlay**: Visualización de chat limpia y personalizable con insignias de rol.
- **Persistencia Híbrida**:
  - Doble respaldo simultáneo en Supabase (PostgreSQL) y MongoDB Atlas con sincronización automática e inspectores de salud.

---

## 🛠️ Tecnologías utilizadas

- **Entorno de ejecución**: Node.js (v20+)
- **Servidor HTTP y WebSockets**: Express 5, `ws`
- **Integraciones de Streaming**: `tmi.js` (Twitch IRC), Twitch Helix API, Kick WebSocket API
- **Bases de Datos y Almacenamiento**: Supabase (`@supabase/supabase-js`), MongoDB (`mongodb`)
- **Frontend**: HTML5, CSS3 moderno (Glassmorphism, CSS Variables, Flexbox/Grid), JavaScript Vanilla (ES6+)
- **Audio y Multimedia**: Web Audio API, YouTube IFrame Player API, StreamElements TTS API, TikTok TTS API

---

## 📂 Arquitectura del Proyecto

```
ORBIBOT/
├── data/                      # Persistencia local / respaldos en JSON
│   ├── channel_points.json    # Mapeo de recompensas de puntos de canal
│   ├── commands.json          # Comandos de chat personalizados
│   ├── config.json            # Configuración general de la plataforma
│   ├── custom_sounds.json     # Registro de audios personalizados
│   └── tts_commands.json      # Configuración de comandos de voces TTS
├── docs/                      # Frontend estático desplegable (GitHub Pages / Render)
│   ├── css/                   # Hojas de estilo
│   ├── js/                    # Lógica del cliente y panel de control
│   └── overlays/              # Plantillas de widgets para OBS
├── public/                    # Archivos estáticos servidos por Express
│   ├── audio/                 # Efectos de sonido y alertas
│   ├── css/                   # Estilos del dashboard
│   ├── js/                    # Scripts cliente
│   └── overlays/              # Widgets para Browser Source de OBS
├── src/                       # Código fuente del backend
│   ├── bot/                   # Controladores de bots de chat
│   │   ├── kickBot.js         # Cliente y gestor de eventos de Kick
│   │   └── twitchBot.js       # Cliente y gestor de eventos de Twitch
│   └── services/              # Lógica de negocio y servicios
│       ├── songRequest.js     # Gestión de cola y búsqueda de canciones
│       ├── storage.js         # Capa de datos (Supabase, MongoDB y Local JSON)
│       ├── ttsService.js      # Procesamiento de audio y llamadas a APIs de voz
│       └── voiceCatalog.js    # Catálogo de voces disponibles
├── .env.example               # Plantilla de variables de entorno
├── package.json               # Dependencias y scripts de Node.js
├── render.yaml                # Manifiesto de despliegue para Render.com
├── server.js                  # Punto de entrada principal y API REST / WS
├── supabase_migration.sql     # Script de migración SQL para Supabase
└── supabase_schema.sql        # Esquema inicial de tablas para Supabase
```

---

## 🚦 Primeros pasos y Configuración

### Prerrequisitos
- [Node.js](https://nodejs.org/) v20.x o superior instalado.
- [Git](https://git-scm.com/) instalado.
- Cuenta de desarrollador de Twitch (para credenciales de API).

### Configuración de Variables de Entorno
Crea un archivo `.env` en la raíz del proyecto tomando como referencia `.env.example`:

```env
PORT=3000
NODE_ENV=development

# Twitch API
TWITCH_CLIENT_ID=tu_twitch_client_id

# Supabase (Opcional si usas almacenamiento local)
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_PUBLISHABLE_KEY=tu_supabase_publishable_key
SUPABASE_SECRET_KEY=tu_supabase_secret_key
SUPABASE_JWKS_URL=https://tu-proyecto.supabase.co/auth/v1/.well-known/jwks.json

# MongoDB (Opcional para respaldo redundante)
MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/orbibot?retryWrites=true&w=majority
```

---

## 💻 Cómo ejecutar el proyecto localmente

1. **Clonar el repositorio e instalar dependencias:**
   ```bash
   git clone https://github.com/Bersek3/OrbiBot.git
   cd OrbiBot
   npm install
   ```

2. **Iniciar en modo producción / estándar:**
   ```bash
   npm start
   ```

3. **Iniciar en modo desarrollo (recarga automática):**
   ```bash
   npm run dev
   ```

4. **Acceder a la aplicación:**
   Abre tu navegador web en `http://localhost:3000`.

---

## 🐳 Ejecución con Docker

Puedes ejecutar OrbiBot de forma aislada y reproducible mediante contenedores.

### 1. Dockerfile
Crea un archivo llamado `Dockerfile` en la raíz del proyecto si aún no cuentas con uno:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

### 2. Construir la imagen
```bash
docker build -t orbibot .
```

### 3. Ejecutar el contenedor
```bash
docker run -d \
  --name orbibot-app \
  -p 3000:3000 \
  --env-file .env \
  orbibot
```

### 4. Uso con Docker Compose
Crea un archivo `docker-compose.yml`:

```yaml
version: '3.8'

services:
  orbibot:
    build: .
    container_name: orbibot
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
```

Inicia el servicio con:
```bash
docker compose up -d
```

---

## 📡 Integración en OBS Studio

Agrega las siguientes URLs como fuentes de navegador (`Browser Source`) en tus escenas de OBS:

| Widget | URL Local | Descripción |
|---|---|---|
| **Alert Box** | `http://localhost:3000/overlays/alerts.html` | Alertas animadas para eventos de stream |
| **Now Playing** | `http://localhost:3000/overlays/nowplaying.html` | Información del tema musical en reproducción |
| **Goal Bar** | `http://localhost:3000/overlays/goals.html?type=subs` | Barra de metas (parámetros: `subs`, `followers`, `bits`) |
| **TTS Player** | `http://localhost:3000/overlays/tts.html` | Reproductor de voz en off para el stream |
| **Chat Overlay** | `http://localhost:3000/overlays/chat.html` | Chat semitransparente para transmisión |

---

## 👤 Autor

- **Bersek** - *Desarrollo inicial, arquitectura y mantenimiento* - [GitHub (@Bersek3)](https://github.com/Bersek3)

---

## 📄 Licencia

Este proyecto está bajo la Licencia ISC.
