const Pusher = require('pusher-js');

// Enable pusher logging
Pusher.logToConsole = true;

const pusher = new Pusher('32cbd69e4b950bf97679', {
  cluster: 'us2',
  forceTLS: true
});

pusher.connection.bind('state_change', function(states) {
  console.log('State changed:', states);
});

pusher.connection.bind('connected', function() {
  console.log('CONNECTED TO PUSHER!');
  const channel = pusher.subscribe('chatrooms.36939677.v2');
  channel.bind('pusher:subscription_succeeded', function() {
    console.log('SUBSCRIPTION SUCCEEDED TO chatrooms.36939677.v2!');
  });
  channel.bind('App\\Events\\ChatMessageEvent', function(data) {
    console.log('CHAT MESSAGE RECEIVED:', data);
  });
  channel.bind('ChatMessageEvent', function(data) {
    console.log('CHAT MESSAGE (short) RECEIVED:', data);
  });
});

pusher.connection.bind('error', function(err) {
  console.log('PUSHER ERROR:', err);
});

setTimeout(() => {
  console.log('Test timeout reached (15s). Closing.');
  pusher.disconnect();
  process.exit(0);
}, 15000);
