export function mysqlTestCredentials(port: number) {
  return {
    host: '127.0.0.1',
    port,
    user: process.env.COKE_GROK_TEST_MYSQL_USER || 'root',
    password: process.env.COKE_GROK_TEST_MYSQL_PASSWORD || '',
  };
}
