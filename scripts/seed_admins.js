require('dotenv').config();
const { MongoClient } = require('mongodb');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const adminData = {
    email: 'francisco.jm.aguilar@gmail.com',
    role: 'superadmin',
    notes: 'Administrador Principal y Creador',
    created_at: new Date().toISOString()
  };

  // 1. MongoDB Atlas
  try {
    const mClient = new MongoClient(process.env.MONGODB_URI);
    await mClient.connect();
    const db = mClient.db('orbibot');
    
    // In collection admins
    await db.collection('admins').updateOne(
      { email: 'francisco.jm.aguilar@gmail.com' },
      { $set: adminData },
      { upsert: true }
    );
    
    // In collection settings (global)
    await db.collection('settings').updateOne(
      { streamer_id: 'global', key: 'admins' },
      { $set: { streamer_id: 'global', key: 'admins', value: [adminData], updated_at: new Date().toISOString() } },
      { upsert: true }
    );
    
    console.log('✅ Guardado en MongoDB Atlas (colecciones "admins" y "settings")');
    await mClient.close();
  } catch (err) {
    console.error('❌ Error en MongoDB:', err.message);
  }

  // 2. Supabase
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
    
    // In existing table orbibot_settings
    const { error: setErr } = await sb.from('orbibot_settings').upsert({
      streamer_id: 'global',
      key: 'admins',
      value: [adminData]
    });
    
    if (setErr) {
      console.warn('⚠️ Error en orbibot_settings:', setErr.message);
    } else {
      console.log('✅ Guardado en Supabase (tabla orbibot_settings con key="admins")');
    }

    // Try in orbibot_admins if created
    const { error: admErr } = await sb.from('orbibot_admins').upsert(adminData, { onConflict: 'email' });
    if (!admErr) {
      console.log('✅ Guardado en Supabase (tabla orbibot_admins)');
    }
  } catch (err) {
    console.error('❌ Error en Supabase:', err.message);
  }

  console.log('🚀 Finalizado con éxito.');
}

main();
