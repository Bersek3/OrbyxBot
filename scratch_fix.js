require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { MongoClient } = require('mongodb');

async function fixDB() {
    console.log("Connecting to databases...");
    
    // Supabase
    const supabaseUrl = 'https://pzrlfuzjkwkrnmqkoaue.supabase.co';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_L6kzW0ZtGyfl6mvKevDX0Q_6G0DCGDP'; // Trying anon key if service key missing
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        console.log("Checking Supabase for plantasi...");
        const { data: supaData, error: supaErr } = await supabase
            .from('orbibot_settings')
            .select('*')
            .in('streamer_id', ['plantasi']);
        
        if (supaErr) console.error("Supabase Error:", supaErr);
        else console.log("Supabase Data for plantasi:", JSON.stringify(supaData, null, 2));
    } catch (e) {
        console.error("Supabase error:", e);
    }

    // MongoDB
    try {
        const mongoUrl = process.env.MONGODB_URI || 'mongodb+srv://user:pass@cluster.mongodb.net/test'; // fallback?
        if (mongoUrl) {
            console.log("Connecting to MongoDB...", mongoUrl.split('@')[1] || mongoUrl);
            const client = new MongoClient(mongoUrl);
            await client.connect();
            const db = client.db('orbibot');
            
            const plantasiDocs = await db.collection('streamers').find({ streamerId: 'plantasi' }).toArray();
            console.log("MongoDB Data for plantasi:", JSON.stringify(plantasiDocs, null, 2));
            
            const bersekDocs = await db.collection('streamers').find({ streamerId: 'bersek___' }).toArray();
            console.log("MongoDB Data for bersek___:", JSON.stringify(bersekDocs, null, 2));
            
            await client.close();
        }
    } catch(e) {
        console.error("Mongo error:", e);
    }
}

fixDB();
