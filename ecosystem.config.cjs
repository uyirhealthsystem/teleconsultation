// PM2 process definition used by scripts/deploy.sh on the EC2 host.
module.exports = {
  apps: [
    {
      name: 'teleconsultation',
      cwd: __dirname,
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      kill_timeout: 10000,
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
