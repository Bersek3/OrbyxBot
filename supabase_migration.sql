-- =======================================================
-- ⚡ OrbiBot - Migración a Multi-Tenant & Administradores
-- =======================================================
-- Ejecuta este script en: https://supabase.com/dashboard/project/pzrlfuzjkwkrnmqkoaue/sql

-- 1. Agregar columna streamer_id a la tabla orbibot_settings existente si no existe
ALTER TABLE public.orbibot_settings 
ADD COLUMN IF NOT EXISTS streamer_id TEXT NOT NULL DEFAULT 'default';

-- 2. Asegurar clave primaria compuesta (streamer_id + key)
ALTER TABLE public.orbibot_settings DROP CONSTRAINT IF EXISTS orbibot_settings_pkey;
ALTER TABLE public.orbibot_settings ADD PRIMARY KEY (streamer_id, key);

-- 3. Índice para búsquedas rápidas por streamer
CREATE INDEX IF NOT EXISTS idx_orbibot_streamer ON public.orbibot_settings(streamer_id);

-- =======================================================
-- 👑 4. CREAR TABLA DE ADMINISTRADORES GENERALES
-- =======================================================
CREATE TABLE IF NOT EXISTS public.orbibot_admins (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    user_id TEXT,
    role TEXT NOT NULL DEFAULT 'superadmin', -- 'superadmin', 'support', 'admin'
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orbibot_admins_email ON public.orbibot_admins(email);

ALTER TABLE public.orbibot_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura de admins" ON public.orbibot_admins;
CREATE POLICY "Permitir lectura de admins" ON public.orbibot_admins
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir gestion de admins" ON public.orbibot_admins;
CREATE POLICY "Permitir gestion de admins" ON public.orbibot_admins
    FOR ALL USING (true);

-- ✅ Para añadirte como Administrador General manualmente en Supabase:
-- INSERT INTO public.orbibot_admins (email, role, notes) 
-- VALUES ('tu_correo@gmail.com', 'superadmin', 'Admin Principal')
-- ON CONFLICT (email) DO NOTHING;
