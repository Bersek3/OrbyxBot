// =============================================================================
// 🍃 OrbiBot - Configuración y Validación de Esquemas para MongoDB Atlas
// =============================================================================
// Repositorio: https://github.com/Bersek3/OrbiBot
// Este script aplica esquemas de validación ($jsonSchema), índices únicos,
// índices TTL y limpia colecciones residuales en MongoDB Atlas.
// =============================================================================

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://Berserk:Bersek%401106%403200@servidor.krd1u.mongodb.net/orbibot?retryWrites=true&w=majority';

// Definición de validadores JSON Schema para MongoDB
const SCHEMAS = {
  streamers: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['streamer_id'],
      properties: {
        streamer_id: {
          bsonType: 'string',
          description: 'Identificador canónico del streamer (requerido)'
        },
        channel_name: { bsonType: ['string', 'null'] },
        platform: { bsonType: ['string', 'null'] },
        email: { bsonType: ['string', 'null'] },
        display_name: { bsonType: ['string', 'null'] },
        created_at: { bsonType: ['string', 'date'] },
        updated_at: { bsonType: ['string', 'date'] },
        metadata: { bsonType: 'object' }
      }
    }
  },

  settings: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['streamer_id', 'key', 'value'],
      properties: {
        streamer_id: {
          bsonType: 'string',
          description: 'Identificador del streamer o ámbito (requerido)'
        },
        key: {
          bsonType: 'string',
          description: 'Clave de configuración (ej: config, commands, alerts)'
        },
        value: {
          description: 'Valor de la configuración (objeto, array, primitivo)'
        },
        updated_at: {
          bsonType: ['string', 'date']
        }
      }
    }
  },

  admins: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'role'],
      properties: {
        email: {
          bsonType: 'string',
          description: 'Correo electrónico del administrador'
        },
        role: {
          enum: ['superadmin', 'admin', 'support', 'moderator'],
          description: 'Rol de autorización'
        },
        notes: { bsonType: ['string', 'null'] },
        permissions: { bsonType: 'array' },
        created_at: { bsonType: ['string', 'date'] },
        updated_at: { bsonType: ['string', 'date'] }
      }
    }
  },

  users: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email'],
      properties: {
        email: { bsonType: 'string' },
        passwordHash: { bsonType: 'string' },
        displayName: { bsonType: ['string', 'null'] },
        created_at: { bsonType: ['string', 'date'] }
      }
    }
  },

  audit_logs: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['action', 'created_at'],
      properties: {
        streamer_id: { bsonType: ['string', 'null'] },
        action: { bsonType: 'string' },
        actor_email: { bsonType: ['string', 'null'] },
        details: { bsonType: 'object' },
        created_at: { bsonType: ['string', 'date'] }
      }
    }
  },

  heartbeats: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['service_id', 'last_ping'],
      properties: {
        service_id: { bsonType: 'string' },
        status: { bsonType: 'string' },
        last_ping: { bsonType: ['string', 'date'] },
        metadata: { bsonType: 'object' }
      }
    }
  }
};

async function setupMongoDatabase() {
  console.log('🍃 =========================================================');
  console.log('🍃  OrbiBot - Inicializador de Esquema MongoDB Atlas');
  console.log('🍃 =========================================================\n');

  let client;
  try {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db('orbibot');
    console.log('✅ Conexión establecida con MongoDB Atlas ("orbibot")\n');

    // 1. Limpieza de colecciones residuales/temporales
    const existingCollections = (await db.listCollections().toArray()).map(c => c.name);
    console.log(`📁 Colecciones encontradas: [${existingCollections.join(', ')}]`);

    if (existingCollections.includes('test')) {
      await db.collection('test').drop();
      console.log('🧹 Colección residual "test" eliminada con éxito.');
    }

    // 2. Creación o actualización de colecciones con $jsonSchema
    for (const [colName, schemaRule] of Object.entries(SCHEMAS)) {
      if (existingCollections.includes(colName)) {
        try {
          await db.command({
            collMod: colName,
            validator: schemaRule.validator || schemaRule,
            validationLevel: 'moderate' // No bloquea lecturas existentes con esquemas previos
          });
          console.log(`🛡️  Validador $jsonSchema actualizado en colección "${colName}".`);
        } catch (vErr) {
          console.warn(`⚠️ No se pudo aplicar collMod en "${colName}":`, vErr.message);
        }
      } else {
        await db.createCollection(colName, {
          validator: schemaRule.validator || schemaRule,
          validationLevel: 'moderate'
        });
        console.log(`✨ Colección "${colName}" creada con validación $jsonSchema.`);
      }
    }

    // 3. Creación de Índices Estratégicos de forma segura
    console.log('\n⚡ Configurando índices de alta velocidad:');

    async function ensureIndex(col, keys, options = {}) {
      try {
        await col.createIndex(keys, options);
      } catch (e) {
        if (e.code === 85 || (e.message && e.message.includes('already exists'))) {
          // Si ya existe con otro nombre, es compatible
          return;
        }
        console.warn(`⚠️ Índice en ${col.collectionName}:`, e.message);
      }
    }

    // Colección: settings
    await ensureIndex(db.collection('settings'), { streamer_id: 1, key: 1 }, { unique: true });
    await ensureIndex(db.collection('settings'), { updated_at: -1 });
    console.log('   ✓ settings: { streamer_id: 1, key: 1 } (UNIQUE) + { updated_at: -1 }');

    // Colección: streamers
    await ensureIndex(db.collection('streamers'), { streamer_id: 1 }, { unique: true });
    await ensureIndex(db.collection('streamers'), { email: 1 }, { sparse: true });
    console.log('   ✓ streamers: { streamer_id: 1 } (UNIQUE)');

    // Colección: admins
    await ensureIndex(db.collection('admins'), { email: 1 }, { unique: true });
    console.log('   ✓ admins: { email: 1 } (UNIQUE)');

    // Colección: users
    await ensureIndex(db.collection('users'), { email: 1 }, { unique: true });
    console.log('   ✓ users: { email: 1 } (UNIQUE)');

    // Colección: audit_logs (TTL Index: expira a los 30 días para ahorrar cuota)
    await ensureIndex(db.collection('audit_logs'), { created_at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
    console.log('   ✓ audit_logs: TTL 30 días automático');

    // Colección: heartbeats
    await ensureIndex(db.collection('heartbeats'), { service_id: 1 }, { unique: true });
    console.log('   ✓ heartbeats: { service_id: 1 } (UNIQUE)');

    // 4. Semilla de Superadministrador
    const adminEmail = process.env.ADMIN_EMAILS || 'francisco.jm.aguilar@gmail.com';
    await db.collection('admins').updateOne(
      { email: adminEmail },
      {
        $set: {
          email: adminEmail,
          role: 'superadmin',
          notes: 'Creador y Administrador Maestro del Sistema',
          permissions: ['*'],
          created_at: new Date().toISOString()
        }
      },
      { upsert: true }
    );
    console.log(`\n👑 Superadministrador asegurado: ${adminEmail}`);

    // 5. Autodescubrimiento y registro de Streamers a partir de settings
    const uniqueStreamers = await db.collection('settings').distinct('streamer_id', {
      streamer_id: { $nin: ['system', 'default', 'global', '_heartbeat'] }
    });

    console.log(`\n🔍 Streamers activos detectados en MongoDB (${uniqueStreamers.length}):`);
    for (const sId of uniqueStreamers) {
      const isEmail = sId.includes('@');
      await db.collection('streamers').updateOne(
        { streamer_id: sId },
        {
          $setOnInsert: {
            streamer_id: sId,
            channel_name: isEmail ? sId.split('@')[0] : sId,
            email: isEmail ? sId : null,
            platform: 'twitch',
            created_at: new Date().toISOString()
          },
          $set: {
            updated_at: new Date().toISOString()
          }
        },
        { upsert: true }
      );
      console.log(`   • ${sId}`);
    }

    console.log('\n🎉 ¡Base de datos MongoDB Atlas estructurada profesionalmente con éxito!');
  } catch (error) {
    console.error('\n❌ Error durante la configuración de MongoDB:', error);
    process.exitCode = 1;
  } finally {
    if (client) await client.close();
  }
}

if (require.main === module) {
  setupMongoDatabase();
}

module.exports = { setupMongoDatabase, SCHEMAS };
