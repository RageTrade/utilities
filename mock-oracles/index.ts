import fetch from 'cross-fetch'
import { ethers } from 'ethers'
import { parseUnits } from 'ethers/lib/utils'
import { NETWORK_INF0 } from '../config-env'

async function main() {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    NETWORK_INF0.HTTP_RPC_URL
  )
  const signer = new ethers.Wallet(NETWORK_INF0.PK_ORACLES, provider)

  while (1) {
    console.log('Start')

    try {
      await updateOracleIfNecessary('BTC', signer, async () => {
        const response = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
        )
        const json = await response.json()
        return json.bitcoin.usd
      })

      await updateOracleIfNecessary('ETH', signer, async () => {
        const response = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
        )
        const json = await response.json()
        return json.ethereum.usd
      })

      await updateOracleIfNecessary('USDT', signer, async () => {
        const response = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd'
        )
        const json = await response.json()
        return json.tether.usd
      })

      await updateOracleIfNecessary('CRV', signer, async () => {
        const response = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=curve-dao-token&vs_currencies=usd'
        )
        const json = await response.json()
        return json['curve-dao-token'].usd
      })
    } catch (e) {
      console.error(e)
    }

    // wait for some time
    await new Promise((resolve) =>
      setTimeout(resolve, 40_000 + Math.floor(20_000 * Math.random()))
    )
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

async function updateOracleIfNecessary(
  coin: string,
  signer: ethers.Signer,
  api: () => Promise<number>
) {
  const deployments = {
    BTCOracle: '0x092899B00939886E13c8B011A1A7BB42b8330923',
    ETHOracle: '0xAB55677e97D211c260C84807293D8F7cf7ddDff9',
    USDTOracle: '0xE0FcDABCcF61DcEfA61A77df8ea943b9232f11dD',
    CRVOracle: '0x5B8E3dDA489F0eDCb83BF4714ee5131BcaA0b96B',
  } as any

  const IOracle = [
    'function setData(int answer) public',
    'function authoriseDataProvider(address provider, bool status) public',
    'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  ]

  const deployment = await deployments[coin + 'Oracle']
  const oracle = new ethers.Contract(deployment, IOracle, signer)

  const decimals = 8 // oracle.decimals()
  const data = await oracle.latestRoundData()
  const time = now() - data.updatedAt.toNumber()
  if (now() - data.updatedAt.toNumber() > 60) {
    const result = await api()
    const answer = parseUnits(result.toFixed(decimals), decimals)
    const tx = await oracle.setData(answer)
    console.log(coin, tx.hash, result)
  } else {
    console.log(coin, 'skipped', time)
  }
}

function now() {
  return Math.floor(Date.now() / 1000)
}
