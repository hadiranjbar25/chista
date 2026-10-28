export const samples = [
  {
    name: 'checkout-production.log',
    raw: '2026-10-22T09:41:01 INFO checkout request user_id=usr_824 email=alex@example.com ip=10.0.1.24 latency_ms=120\n2026-10-22T09:41:02 INFO payment authorized latency_ms=180\n2026-10-22T09:42:01 WARN upstream retry latency_ms=820\n2026-10-22T09:42:03 ERROR payment timeout email=alex@example.com latency_ms=2400\n2026-10-22T09:42:04 ERROR checkout failed user_id=usr_824 token=sk-demoSecret123456 latency_ms=3000\n2026-10-22T09:43:01 INFO recovery completed latency_ms=210',
    format: 'log',
  },
  {
    name: 'requests.csv',
    raw: 'time,status,latency_ms,email\n09:41,200,120,alex@example.com\n09:41,200,180,sam@example.com\n09:42,504,2400,alex@example.com\n09:42,500,3000,sam@example.com\n09:43,200,210,alex@example.com',
    format: 'csv',
  },
  {
    name: 'service-config.json',
    raw: JSON.stringify(
      {
        service: 'checkout-api',
        environment: 'production',
        timeout_ms: 2000,
        retries: 3,
        email: 'alex@example.com',
        api_key: 'sk-demoSecret123456',
        upstream: 'payments',
        release: 'v2.8.1',
      },
      null,
      2,
    ),
    format: 'json',
  },
];
