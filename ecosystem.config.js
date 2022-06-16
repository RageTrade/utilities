module.exports = [
  {
    script: 'dist/arbitrage-bot/execute.js',
    name: 'arb-bot',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true
  },
  {
    script: 'dist/keeper-liquidation/index.js',
    name: 'keeper-liquidation',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true
  },
  {
    script: 'dist/vault-rebalance/index.js',
    name: 'vault-rebalance',
    out_file: '.pm2/logs/output.log',
    error_file: '.pm2/logs/error.log',
    combine_logs: true,
    merge_logs: true
  }
]
