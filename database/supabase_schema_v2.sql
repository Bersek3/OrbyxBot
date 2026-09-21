-- =============================================================================
-- ⚡ OrbiBot - Esquema Profesional de Base de Datos v2 (Supabase / PostgreSQL)
-- =============================================================================
-- Repositorio: https://github.com/Bersek3/OrbiBot
-- Diseñado para arquitectura Multi-Tenant, Alta Disponibilidad y Resiliencia.
-- Ejecuta este script completo en el SQL Editor de tu proyecto Supabase:
-- https://supabase.com/dashboard/project/pzrlfuzjkwkrnmqkoaue/sql
-- =============================================================================

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 2. FUNCIÓN GENERAL: Actualizador Automático de Marcas de Tiempo (updated_at)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 3. TABLA: orbibot_streamers (Perfiles Canónicos de Streamers)
-- =============================================================================
-- Permite unificar los diferentes identificadores (Twitch username, Kick, Email, Auth UUID)
-- en un único perfil centralizado.
CREATE TABLE IF NOT EXISTS public.orbibot_streamers (
    id TEXT PRIMARY KEY,                       -- Canonical streamer_id (ej: 'bersek___', 'plantasi')
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Vínculo opcional con Supabase Auth
    email TEXT,                                -- Correo del propietario
    channel_name TEXT,                         -- Nombre del canal principal
    display_name TEXT,                         -- Nombre mostrado en pantalla
    platform TEXT DEFAULT 'twitch',            -- 'twitch', 'kick', 'multistream'
    avatar_url TEXT,                           -- Imagen de perfil
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,        -- Datos extendidos (ej: IDs de plataformas)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_streamers_email ON public.orbibot_streamers(email);
CREATE INDEX IF NOT EXISTS idx_streamers_user_id ON public.orbibot_streamers(user_id);
CREATE INDEX IF NOT EXISTS idx_streamers_platform ON public.orbibot_streamers(platform);

DROP TRIGGER IF EXISTS trg_streamers_updated_at ON public.orbibot_streamers;
CREATE TRIGGER trg_streamers_updated_at
    BEFORE UPDATE ON public.orbibot_streamers
    FOR EACH ROW EXECUTE PROCEDURE public.fn_set_updated_at();

-- =============================================================================
-- 4. TABLA: orbibot_settings (Almacén Multi-Tenant Clave-Valor de Configuración)
-- =============================================================================
-- Almacena todas las entidades del streamer (config, commands, alerts, tts, widgets)
CREATE TABLE IF NOT EXISTS public.orbibot_settings (
    streamer_id TEXT NOT NULL DEFAULT 'default',
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (streamer_id, key)
);

CREATE INDEX IF NOT EXISTS idx_orbibot_settings_streamer ON public.orbibot_settings(streamer_id);
CREATE INDEX IF NOT EXISTS idx_orbibot_settings_key ON public.orbibot_settings(key);
CREATE INDEX IF NOT EXISTS idx_orbibot_settings_updated ON public.orbibot_settings(updated_at DESC);

-- Índice GIN para búsquedas profundas dentro del JSONB
CREATE INDEX IF NOT EXISTS idx_orbibot_settings_value_gin ON public.orbibot_settings USING GIN (value);

DROP TRIGGER IF EXISTS trg_settings_updated_at ON public.orbibot_settings;
CREATE TRIGGER trg_settings_updated_at
    BEFORE UPDATE ON public.orbibot_settings
    FOR EACH ROW EXECUTE PROCEDURE public.fn_set_updated_at();

-- =============================================================================
-- 5. TABLA: orbibot_admins (Superadministradores y Soporte Técnico)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.orbibot_admins (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    user_id TEXT,
    role TEXT NOT NULL DEFAULT 'superadmin' CHECK (role IN ('superadmin', 'admin', 'support', 'moderator')),
    notes TEXT,
    permissions JSONB DEFAULT '["*"]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orbibot_admins_email ON public.orbibot_admins(email);
CREATE INDEX IF NOT EXISTS idx_orbibot_admins_role ON public.orbibot_admins(role);

DROP TRIGGER IF EXISTS trg_admins_updated_at ON public.orbibot_admins;
CREATE TRIGGER trg_admins_updated_at
    BEFORE UPDATE ON public.orbibot_admins
    FOR EACH ROW EXECUTE PROCEDURE public.fn_set_updated_at();

-- =============================================================================
-- 6. TABLA: orbibot_audit_logs (Trazabilidad y Auditoría de Seguridad)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.orbibot_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    streamer_id TEXT,
    actor_email TEXT,
    action TEXT NOT NULL,                      -- ej: 'CONFIG_UPDATED', 'TTS_VOICE_SAVED', 'ADMIN_LOGIN'
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_streamer ON public.orbibot_audit_logs(streamer_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.orbibot_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.orbibot_audit_logs(created_at DESC);

-- =============================================================================
-- 7. TABLA: orbibot_heartbeats (Módulo Keep-Alive Anti-Pausa 24/7)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.orbibot_heartbeats (
    service_id TEXT PRIMARY KEY DEFAULT 'orbibot-core',
    status TEXT NOT NULL DEFAULT 'active',
    last_ping TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- =============================================================================
-- 8. VISTAS DE MONITOREO Y GESTIÓN
-- =============================================================================
-- Vista resumen de streamers activos y volumen de configuración
CREATE OR REPLACE VIEW public.v_streamer_health AS
SELECT 
    s.streamer_id,
    COUNT(s.key) AS total_keys,
    MAX(s.updated_at) AS last_activity,
    bool_or(s.key = 'twitch_auth') AS has_twitch,
    bool_or(s.key = 'kick_auth') AS has_kick,
    bool_or(s.key = 'tts_commands') AS has_tts
FROM public.orbibot_settings s
GROUP BY s.streamer_id;

-- =============================================================================
-- 9. SEGURIDAD Y POLÍTICAS RLS (Row Level Security)
-- =============================================================================
ALTER TABLE public.orbibot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbibot_streamers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbibot_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbibot_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orbibot_heartbeats ENABLE ROW LEVEL SECURITY;

-- Políticas para orbibot_settings (Permite lectura y escritura pública y authenticated)
DROP POLICY IF EXISTS "Settings_Permitir_Lectura" ON public.orbibot_settings;
CREATE POLICY "Settings_Permitir_Lectura" ON public.orbibot_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Settings_Permitir_Escritura" ON public.orbibot_settings;
CREATE POLICY "Settings_Permitir_Escritura" ON public.orbibot_settings FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Settings_Permitir_Actualizacion" ON public.orbibot_settings;
CREATE POLICY "Settings_Permitir_Actualizacion" ON public.orbibot_settings FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Settings_Permitir_Eliminacion" ON public.orbibot_settings;
CREATE POLICY "Settings_Permitir_Eliminacion" ON public.orbibot_settings FOR DELETE USING (true);

-- Políticas para orbibot_streamers
DROP POLICY IF EXISTS "Streamers_Lectura" ON public.orbibot_streamers;
CREATE POLICY "Streamers_Lectura" ON public.orbibot_streamers FOR SELECT USING (true);

DROP POLICY IF EXISTS "Streamers_Escritura" ON public.orbibot_streamers;
CREATE POLICY "Streamers_Escritura" ON public.orbibot_streamers FOR ALL USING (true);

-- Políticas para orbibot_admins
DROP POLICY IF EXISTS "Admins_Lectura" ON public.orbibot_admins;
CREATE POLICY "Admins_Lectura" ON public.orbibot_admins FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins_Modificacion" ON public.orbibot_admins;
CREATE POLICY "Admins_Modificacion" ON public.orbibot_admins FOR ALL USING (true);

-- Políticas para orbibot_audit_logs
DROP POLICY IF EXISTS "Audit_Lectura" ON public.orbibot_audit_logs;
CREATE POLICY "Audit_Lectura" ON public.orbibot_audit_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Audit_Insercion" ON public.orbibot_audit_logs;
CREATE POLICY "Audit_Insercion" ON public.orbibot_audit_logs FOR INSERT WITH CHECK (true);

-- Políticas para orbibot_heartbeats
DROP POLICY IF EXISTS "Heartbeat_Public" ON public.orbibot_heartbeats;
CREATE POLICY "Heartbeat_Public" ON public.orbibot_heartbeats FOR ALL USING (true);

-- =============================================================================
-- 10. DATOS SEMILLA (SEED DATA)
-- =============================================================================
-- Administrador principal
INSERT INTO public.orbibot_admins (email, role, notes, permissions)
VALUES (
    'francisco.jm.aguilar@gmail.com',
    'superadmin',
    'Creador y Administrador Maestro del Sistema',
    '["*"]'::jsonb
)
ON CONFLICT (email) DO UPDATE 
SET role = 'superadmin', notes = EXCLUDED.notes;

-- Registro inicial de Heartbeat
INSERT INTO public.orbibot_heartbeats (service_id, status, last_ping, metadata)
VALUES ('orbibot-core', 'active', now(), '{"version": "2.0.0"}'::jsonb)
ON CONFLICT (service_id) DO UPDATE 
SET last_ping = now(), status = 'active';

-- =============================================================================
-- Fin del Esquema Profesional v2
-- =============================================================================
