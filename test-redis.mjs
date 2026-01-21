import Keyv from 'keyv';

const cache = new Keyv('redis://127.0.0.1:6379', { ttl: 10 });

(async () => {
  await cache.set('healthcheck', 'ok');
  const val = await cache.get('healthcheck');
  console.log('Healthcheck value:', val); // should print 'ok'
})();
