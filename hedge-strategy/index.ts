import cron from 'node-cron'

import { BigNumber, ethers } from 'ethers'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config-env'

import {
  deltaNeutralGmxVaults,
  gmxProtocol,
  tokens,
  typechain,
} from '@ragetrade/sdk'

const provider = new ethers.providers.StaticJsonRpcProvider(
  NETWORK_INF0.HTTP_RPC_URL
)

const signer = new ethers.Wallet(
  NETWORK_INF0.PK_USDC_BATCHING_MANAGER,
  provider
)

const MAX_BPS = BigNumber.from(10_000)
const PRICE_PRECISION = BigNumber.from(10).pow(30)

const MIN_PERSIST_TIME = 2 * 60 * 60
const MIN_DELTA_DEVIATION = 500

const UPDATE_HEDGE_WAIT_INTERVAL = '*/5 * * * *'

let wbtcAddress: string
let wethAddress: string

let gmxUnderlyingVault: typechain.gmxVault.IVault
let glpManager: typechain.deltaNeutralGmxVaults.IGlpManager
let dnGmxTraderHedgeStrategy: typechain.deltaNeutralGmxVaults.DnGmxTraderHedgeStrategy

let lastTimestamp = Math.floor(Date.now() / 1000)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const calcCurrentTraderOIHedge = async () => {
  const wbtcTokenPrecision = BigNumber.from(10).pow(8)
  const wethTokenPrecision = BigNumber.from(10).pow(18)

  const traderOIHedgeBps = await dnGmxTraderHedgeStrategy.traderOIHedgeBps()

  const wbtcGlobalShort = await gmxUnderlyingVault.globalShortSizes(wbtcAddress)
  const wethGlobalShort = await gmxUnderlyingVault.globalShortSizes(wethAddress)

  const wbtcGlobalAveragePrice = await glpManager.getGlobalShortAveragePrice(
    wbtcAddress
  )
  const wethGlobalAveragePrice = await glpManager.getGlobalShortAveragePrice(
    wethAddress
  )

  const wbtcReservedAmount = await gmxUnderlyingVault.reservedAmounts(
    wbtcAddress
  )
  const wethReservedAmount = await gmxUnderlyingVault.reservedAmounts(
    wethAddress
  )

  const wbtcTokenReserve = wbtcReservedAmount
    .mul(PRICE_PRECISION)
    .div(wbtcTokenPrecision)
    .sub(wbtcGlobalShort.mul(PRICE_PRECISION).div(wbtcGlobalAveragePrice))
  const wethTokenReserve = wethReservedAmount
    .mul(PRICE_PRECISION)
    .div(wethTokenPrecision)
    .sub(wethGlobalShort.mul(PRICE_PRECISION).div(wethGlobalAveragePrice))

  const wbtcHedgeAmount = wbtcTokenReserve
    .mul(traderOIHedgeBps)
    .mul(wbtcTokenPrecision)
    .div(PRICE_PRECISION)
    .div(MAX_BPS)

  const wethHedgeAmount = wethTokenReserve
    .mul(traderOIHedgeBps)
    .mul(wethTokenPrecision)
    .div(PRICE_PRECISION)
    .div(MAX_BPS)

  return {
    wbtcHedgeAmount,
    wethHedgeAmount,
  }
}

const updateHedges = async () => {
  const lastBtcTraderOIHedge = await dnGmxTraderHedgeStrategy.btcTraderOIHedge()
  const lastEthTraderOIHedge = await dnGmxTraderHedgeStrategy.ethTraderOIHedge()

  const { wbtcHedgeAmount, wethHedgeAmount } = await calcCurrentTraderOIHedge()

  const wbtcDiff = wbtcHedgeAmount.sub(lastBtcTraderOIHedge).abs()
  const wethDiff = wethHedgeAmount.sub(lastEthTraderOIHedge).abs()

  const shouldUpdateTS = !(
    wbtcDiff
      .mul(PRICE_PRECISION)
      .gt(
        wbtcHedgeAmount
          .mul(MIN_DELTA_DEVIATION)
          .mul(PRICE_PRECISION)
          .div(MAX_BPS)
      ) ||
    wethDiff
      .mul(PRICE_PRECISION)
      .gt(
        wethHedgeAmount
          .mul(MIN_DELTA_DEVIATION)
          .mul(PRICE_PRECISION)
          .div(MAX_BPS)
      )
  )

  const currentTimeStamp = Math.floor(Date.now() / 1000)

  if (shouldUpdateTS) lastTimestamp = currentTimeStamp

  if (!(lastTimestamp + MIN_PERSIST_TIME > currentTimeStamp)) return

  try {
    const tx = await dnGmxTraderHedgeStrategy.setTraderOIHedges()
    await tx.wait()
    lastTimestamp = currentTimeStamp
    log(
      `hedges updated successfully, ${NETWORK_INF0.BLOCK_EXPLORER_URL}/tx/${tx}`,
      'HEDGE_STRATEGY'
    )
  } catch (e) {
    log(`updating hedges failed, ${e.body}, ${e.msg}`, 'HEDGE_STRATEGY')
  }
}

;(async () => {
  ;({ wbtcAddress, wethAddress } = tokens.getAddresses(NETWORK_INF0.CHAIN_ID))
  ;({ gmxUnderlyingVault, glpManager } = await gmxProtocol.getContracts(signer))
  ;({ dnGmxTraderHedgeStrategy } = await deltaNeutralGmxVaults.getContracts(
    signer
  ))

  cron.schedule(UPDATE_HEDGE_WAIT_INTERVAL, () => {
    updateHedges()
      .then(() => console.log('RUN COMPLETE!'))
      .catch((error) => {
        console.error(error)
        log(error, 'BATCHING_MANAGER')
        process.exit(1)
      })
  })
})().catch((e) => console.log(e))
