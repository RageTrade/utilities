import cron from 'node-cron'

import { BigNumber, ethers } from 'ethers'
import {
  deltaNeutralGmxVaults,
  DnGmxJuniorVault,
  DnGmxSeniorVault,
  getTokenContracts,
} from '@ragetrade/sdk'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config-env'
import { hexZeroPad, parseEther, parseUnits } from 'ethers/lib/utils'
import { ERC20 } from '@ragetrade/sdk/dist/typechain/core'

let sGLP: ERC20
let dnGmxJuniorVault: DnGmxJuniorVault
let dnGmxSeniorVault: DnGmxSeniorVault

const REQD_UTILIZATION_BPS = BigNumber.from(9_800)

const MIN_SGLP_AMOUNT = parseEther('20')

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)
const signer = new ethers.Wallet(NETWORK_INF0.PK_DN_VAULT_REBALANCE, provider)

const rebalanceUnhedged = async () => {
  console.log('REBALANCE UNHEDGED STARTED!')

  const totalAssets = await dnGmxSeniorVault.totalAssets()
  const totalBorrowed = await dnGmxSeniorVault.totalUsdcBorrowed()

  const utlization = totalBorrowed.mul(1000).div(totalAssets)

  const unhedgedGlpInUsdc = BigNumber.from(
    await provider.getStorageAt(
      dnGmxJuniorVault.address,
      hexZeroPad('0xff', 32),
      'latest'
    )
  )

  if (utlization.lt(REQD_UTILIZATION_BPS) && unhedgedGlpInUsdc.gt(0)) {
    await log(
      'unhedged glp accumulated and senior vault not at max utilization',
      'REBALANCE'
    )

    await sGLP.approve(dnGmxJuniorVault.address, MIN_SGLP_AMOUNT)

    try {
      const tx = await dnGmxJuniorVault.deposit(MIN_SGLP_AMOUNT, signer.address)
      await tx.wait()

      await log(
        `sGLP deposited by keeper: ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
        'REBALANCE'
      )
    } catch (e: any) {
      await log(`sGLP deposited by keeper failed`, 'REBALANCE')
    }

    return
  }

  await log(
    `unhedgedGlp + lower utilization under control, skipping,,,`,
    'REBALANCE'
  )
}

const rebalance = async () => {
  console.log('REBALANCE STARTED!')

  const isValidRebalance = await dnGmxJuniorVault.isValidRebalance();

  if(!isValidRebalance) {
    log('not a valid rebalance', 'REBALANCE');
    return;
  }

  try {
    const tx = await dnGmxJuniorVault.rebalance({
      gasPrice: parseUnits("0.1", 9)
    })
    await tx.wait()

    log(
      `rebalanced, ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
      'REBALANCE'
    )
  } catch (e: any) {
    log(`failed rebalance, ${e.body}, ${e.message}`, 'REBALANCE')
  }
}

;(async () => {
  ;({ dnGmxJuniorVault, dnGmxSeniorVault } =
    await deltaNeutralGmxVaults.getContracts(signer))
  ;({ sGLP } = await getTokenContracts(signer))
  cron.schedule('*/30 * * * *', async () => {
    await rebalance()
    // await rebalanceUnhedged()
  })
})().catch((e) => console.log(e))
