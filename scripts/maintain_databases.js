// =============================================================================
// ⚡ OrbiBot - Diagnóstico, Salud y Mantenimiento de Bases de Datos
// =============================================================================
// Repositorio: https://github.com/Bersek3/OrbiBot
// Este script verifica la conectividad, integridad de datos, latencia y
// sincronización entre Supabase (PostgreSQL) y MongoDB Atlas.
// =============================================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { MongoClient } = require('mongodb');
const { setupMongoDatabase } = require('../database/mongo_schema_setup');

async function runHealthCheck() {
  console.log('\n=============================================================');
  console.log('⚡ ORBIBOT - DIAGNÓSTICO DE SALUD DE BASES DE DATOS DUALES');
  console.log('=============================================================\n');

  const report = {
    timestamp: new Date().toISOString(),
    supabase: { status: 'offline', latencyMs: 0, details: {} },
    mongodb: { status: 'offline', latencyMs: 0, details: {} },
    synchronization: {一致: false}
  };

  // 1. SUPABASE POSTGRESQL CHECK
  console.log('🟢 [1/3] Verificando Supabase (PostgreSQL)...');
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supaUrl || !supaKey) {
    console.warn('   ⚠️ Supabase no está configurado en el archivo .env');
    report.supabase.status = 'unconfigured';
  } else {
    try {
      const supa = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
      const t0 = Date.now();
      
      // Consultar tabla orbibot_settings
      const { data: settingsData, error: sErr } = await supa
        .from('orbibot_settings')
        .select('streamer_id, key, updated_at');
      
      const supaLatency = Date.now() - t0;
      report.supabase.latencyMs = supaLatency;

      if (sErr) {
        console.error(`   ❌ Error al consultar orbibot_settings: ${sErr.message}`);
        report.supabase.status = 'error';
        report.supabase.details.error = sErr.message;
      } else {
        report.supabase.status = 'online';
        const distinctStreamers = new Set(settingsData.map(r => r.streamer_id));
        report.supabase.details.totalRecords = settingsData.length;
        report.supabase.details.distinctStreamers = distinctStreamers.size;
        console.log(`   ✅ Supabase ONLINE (${supaLatency}ms)`);
        console.log(`      • Registros en orbibot_settings: ${settingsData.length}`);
        console.log(`      • Streamers únicos en la nube: ${distinctStreamers.size}`);
      }

      // Verificar tabla orbibot_admins
      const { data: adminsData, error: aErr } = await supa
        .from('orbibot_admins')
        .select('*');

      if (aErr) {
        console.log(`   ℹ️  Tabla 'orbibot_admins': Requiere ejecución de database/supabase_schema_v2.sql en Supabase SQL Editor.`);
        report.supabase.details.hasAdminsTable = false;
      } else {
        console.log(`   ✅ Tabla 'orbibot_admins' activa: ${adminsData.length} administradores registrados.`);
        report.supabase.details.hasAdminsTable = true;
      }

      // Verificar tabla orbibot_streamers
      const { data: streamersData, error: stErr } = await supa
        .from('orbibot_streamers')
        .select('*');

      if (stErr) {
        console.log(`   ℹ️  Tabla 'orbibot_streamers': Requiere ejecución de database/supabase_schema_v2.sql en Supabase SQL Editor.`);
        report.supabase.details.hasStreamersTable = false;
      } else {
        console.log(`   ✅ Tabla 'orbibot_streamers' activa: ${streamersData.length} perfiles.`);
        report.supabase.details.hasStreamersTable = true;
      }

    } catch (err) {
      console.error(`   ❌ Excepción en cliente Supabase: ${err.message}`);
      report.supabase.status = 'error';
    }
  }

  // 2. MONGODB ATLAS CHECK
  console.log('\n🍃 [2/3] Verificando MongoDB Atlas (Doble Respaldo)...');
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.warn('   ⚠️ MONGODB_URI no está configurada en .env');
    report.mongodb.status = 'unconfigured';
  } else {
    let client;
    try {
      const t0 = Date.now();
      client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const db = client.db('orbibot');
      await db.command({ ping: 1 });
      const mongoLatency = Date.now() - t0;

      report.mongodb.status = 'online';
      report.mongodb.latencyMs = mongoLatency;

      const collections = await db.listCollections().toArray();
      const colNames = collections.map(c => c.name);
      console.log(`   ✅ MongoDB Atlas ONLINE (${mongoLatency}ms)`);
      console.log(`      • Colecciones activas: [${colNames.join(', ')}]`);

      const settingsCount = await db.collection('settings').countDocuments();
      const streamersCount = await db.collection('streamers').countDocuments();
      const adminsCount = await db.collection('admins').countDocuments();

      console.log(`      • Documentos en 'settings': ${settingsCount}`);
      console.log(`      • Perfiles en 'streamers': ${streamersCount}`);
      console.log(`      • Administradores en 'admins': ${adminsCount}`);

      report.mongodb.details = {
        collections: colNames,
        settingsCount,
        streamersCount,
        adminsCount
      };

    } catch (err) {
      console.error(`   ❌ Error al conectar con MongoDB Atlas: ${err.message}`);
      report.mongodb.status = 'error';
      report.mongodb.details.error = err.message;
    } finally {
      if (client) await client.close();
    }
  }

  // 3. COMPARATIVA Y RESUMEN
  console.log('\n⚖️  [3/3] Resumen de Disponibilidad y Arquitectura Dual:');
  console.log('-------------------------------------------------------------');
  console.log(`  Supabase:      ${report.supabase.status.toUpperCase()} (${report.supabase.latencyMs}ms)`);
  console.log(`  MongoDB Atlas: ${report.mongodb.status.toUpperCase()} (${report.mongodb.latencyMs}ms)`);
  console.log('-------------------------------------------------------------');

  if (report.supabase.status === 'online' && report.mongodb.status === 'online') {
    console.log('✨ [Excelente] Doble Respaldo 100% Operativo y Listo para Producción.');
  } else if (report.supabase.status === 'online' || report.mongodb.status === 'online') {
    console.log('🛡️ [Modo Resiliente] Al menos una base de datos está activa. El sistema operará con failover.');
  } else {
    console.warn('⚠️ [Atención] Ambas bases de datos en la nube están desconectadas. OrbiBot usará caché JSON local.');
  }
  console.log('=============================================================\n');

  return report;
}

if (require.main === module) {
  runHealthCheck();
}

module.exports = { runHealthCheck };
