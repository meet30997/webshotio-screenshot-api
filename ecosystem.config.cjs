module.exports = {
  apps: [
    {
      name: 'webshotio',
      script: './server.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '700M',
      kill_timeout: 25000,
      listen_timeout: 10000,
      exp_backoff_restart_delay: 200,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
