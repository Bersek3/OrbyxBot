const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://pzrlfuzjkwkrnmqkoaue.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_L6kzW0ZtGyfl6mvKevDX0Q_6G0DCGDP';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testSupportIsolation() {
  console.log('--- Testing Plantasi settings in Supabase ---');
  const { data, error } = await supabase.from('orbibot_settings').select('*').eq('streamer_id', 'plantasi');
  if (error) {
    console.error('Supabase query error:', error);
    return;
  }

  const keys = {};
  data.forEach(d => { keys[d.key] = d.value; });
  console.log('Plantasi keys found:', Object.keys(keys));
  console.log('Plantasi active_tts_voice:', keys['active_tts_voice']);
  console.log('Plantasi twitch_auth:', keys['twitch_auth']);
  console.log('Plantasi channel_points count:', Array.isArray(keys['channel_points']) ? keys['channel_points'].length : 0);
  console.log('Plantasi tts_commands count:', Array.isArray(keys['tts_commands']) ? keys['tts_commands'].length : 0);

  if (keys['twitch_auth'] && keys['twitch_auth'].channel === 'plantasi' && keys['active_tts_voice'] === 'es_dross') {
    console.log('✅ Plantasi data in Supabase is verified and ready for Support Mode!');
  } else {
    console.warn('⚠️ Plantasi data might be incomplete.');
  }
}

testSupportIsolation();
