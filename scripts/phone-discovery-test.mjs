import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { localAddresses } from '../src/phone-receiver.js';

const host = process.env.PAPAN_PHONE_DISCOVERY_HOST;
assert(localAddresses().some(item => item.address === host), 'Choose an existing private IPv4 interface with PAPAN_PHONE_DISCOVERY_HOST.');
const app = process.env.PAPAN_APP_DIR || process.cwd();
const { advertisePhoneReceiver } = await import(pathToFileURL(path.join(app, 'src/phone-discovery.js')));
const packet = createRequire(createRequire(import.meta.url).resolve('bonjour-service'))('dns-packet');
const id = randomUUID(), name = `Papan ${id}._papan-phone._tcp.local`;
const socket = createSocket({ type: 'udp4', reuseAddr: true });
let stop;
async function response(matches, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('Desktop did not answer the multicast discovery query.')), timeout);
    const listener = bytes => {
      let value; try { value = packet.decode(bytes); } catch { return; }
      if (value.type === 'response' && matches(value.answers)) done();
    };
    function done(error) { clearTimeout(timer); socket.off('message', listener); error ? reject(error) : resolve(); }
    socket.on('message', listener);
  });
}
try {
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(5353, '0.0.0.0', resolve); });
  socket.addMembership('224.0.0.251', host); socket.setMulticastInterface(host);
  const initial = response(answers => answers.length > 1 && answers.some(answer => answer.name === name && answer.type === 'SRV'), 8000);
  stop = advertisePhoneReceiver({ serverId: id, host, port: 54321 }, error => { throw error; });
  await initial;
  // A one-record reply distinguishes a query response from periodic announcements.
  const queried = response(answers => answers.length === 1 && answers[0].name === name && answers[0].type === 'SRV' && answers[0].data.port === 54321, 1500);
  const query = packet.encode({ type: 'query', questions: [{ name, type: 'SRV' }] });
  socket.send(query, 5353, '224.0.0.251');
  await queried;
  console.log(JSON.stringify({ status: 'passed', announcementReceived: true, multicastQueryAnswered: true, app }));
} finally { if (stop) await stop(); socket.close(); }
