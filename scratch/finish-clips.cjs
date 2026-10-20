const fs=require('fs');
let p='public/js/dashboard.js',s=fs.readFileSync(p,'utf8'); s=s.replace("[streamerId, cleanChan, 'plantasi']",'[streamerId, cleanChan]');fs.writeFileSync(p,s);fs.copyFileSync(p,'docs/js/dashboard.js');
p='public/index.html';s=fs.readFileSync(p,'utf8').replace(/\s*<!-- Botón para esconder\/colapsar sidebar -->/,'').replace(/\s*<!-- Botón Iniciar Sesión con Twitch \(visible cuando no está conectado\) -->/,'').replace(/\s*<!-- Logo OrbiBot en la parte superior derecha -->/,'');fs.writeFileSync(p,s);fs.copyFileSync(p,'docs/index.html');
