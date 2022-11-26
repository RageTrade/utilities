module.exports = [
  {
    script: 'dist/arbitrage-bot/execute.js',
    name: 'arb-bot',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true,
  },
  {
    script: 'dist/keeper-liquidation/index.js',
    name: 'keeper-liquidation',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true,
  },
  {
    script: 'dist/vault-rebalance/index.js',
    name: 'vault-rebalance',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true,
  },
  {
    script: 'dist/vault-rebalance/gmx.js',
    name: 'vault-rebalance-gmx',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true,
  },
  {
    script: 'dist/batching-manager/index.js',
    name: 'batching-manager',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true,
  },
  {
    script: 'dist/mock-oracles/index.js',
    name: 'oracles',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true,
  },
  {
    script: 'dist/batching-manager/dn-gmx-batching-manager.js',
    name: 'dn-gmx-batching-manager',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true,
  },
  {
    script: 'dist/vault-rebalance/dn.js',
    name: 'dn-rebalance',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true,
  },
  {
    script: 'dist/jit-keeper/index.js',
    name: 'jit-keeper',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true,
  },
]
