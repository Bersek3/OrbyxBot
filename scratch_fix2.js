require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://pzrlfuzjkwkrnmqkoaue.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_L6kzW0ZtGyfl6mvKevDX0Q_6G0DCGDP';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data, error } = await supabase.from('orbibot_settings').select('*');
    if (error) {
        console.error(error);
        return;
    }
    const bersekRelated = data.filter(r => JSON.stringify(r).toLowerCase().includes('bersek'));
    console.log("Rows mentioning bersek:", JSON.stringify(bersekRelated, null, 2));
}
main();
