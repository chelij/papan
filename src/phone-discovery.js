import { Bonjour } from 'bonjour-service';
import { hostname } from 'node:os';

export function advertisePhoneReceiver({ serverId, host, port }, error) {
  if (host.startsWith('127.')) return async () => {};
  const bonjour = new Bonjour({ bind: '0.0.0.0', interface: host }, error);
  const service = bonjour.publish({ name: `Papan ${serverId}`, type: 'papan-phone', port, disableIPv6: true,
    host: `papan-${serverId}.local`, txt: { id: serverId, name: hostname().slice(0, 80), endpoint: `http://${host}:${port}`, version: '1' } });
  service.on('error', error);
  return async () => {
    await new Promise(resolve => { const timeout = setTimeout(resolve, 500); bonjour.unpublishAll(() => { clearTimeout(timeout); resolve(); }); });
    bonjour.destroy();
  };
}
