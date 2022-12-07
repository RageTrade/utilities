import cron from 'node-cron'
const fetch = require('node-fetch')

import { ethers } from 'ethers'

import { log } from '../discord-logger'
import { NETWORK_INF0 } from '../config-env'
import { deltaNeutralGmxJIT, JITManager, tokens } from '@ragetrade/sdk'

const PCT = 100

const apiBaseUrl = `https://api.1inch.io/v5.0/${NETWORK_INF0.CHAIN_ID}/swap`

const tokenContacts = tokens.getContractsSync(
  NETWORK_INF0.CHAIN_ID == 42161 ? 'arbmain' : 'arbgoerli'
)

const swapWbtcToWeth = async (dnGmxJIT: JITManager) => {
  const slippage = (
    (await dnGmxJIT.swapLossThresholdBPS()).toNumber() / PCT
  ).toString()

  const amount = (
    await tokenContacts.wbtc.balanceOf(dnGmxJIT.address)
  ).toString()

  if (amount == '0') {
    await log('no wbtc in jit contract to swap, skipping...', 'DN_GMX_JIT')
    return
  }

  const params = {
    amount,
    slippage,
    disableEstimate: 'true',
    fromAddress: dnGmxJIT.address,
    toTokenAddress: tokenContacts.weth.address,
    fromTokenAddress: tokenContacts.wbtc.address,
  }

  const payload = apiBaseUrl + '?' + new URLSearchParams(params).toString()
  await log(`payload: ${payload}`, 'DN_GMX_JIT')

  const response = await (await fetch(payload)).json()
  await log(`response: ${JSON.stringify(response)}`, 'DN_GMX_JIT')

  const tx = await dnGmxJIT.swapTokens(response.tx.to, response.tx.data, true)
  await tx.wait()

  await log(
    `swapped wbtc for weth ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
    'DN_GMX_JIT'
  )
}

const swapWethToUsdc = async (dnGmxJIT: JITManager) => {
  const slippage = (
    (await dnGmxJIT.swapLossThresholdBPS()).toNumber() / PCT
  ).toString()

  const amount = (
    await tokenContacts.weth.balanceOf(dnGmxJIT.address)
  ).toString()

  if (amount == '0') {
    await log('no weth in jit contract to swap, skipping...', 'DN_GMX_JIT')
    return
  }

  const params = {
    amount,
    slippage,
    disableEstimate: 'true',
    fromAddress: dnGmxJIT.address,
    toTokenAddress: tokenContacts.usdc.address,
    fromTokenAddress: tokenContacts.weth.address,
  }

  const payload = apiBaseUrl + '?' + new URLSearchParams(params).toString()
  await log(`payload: ${payload}`, 'DN_GMX_JIT')

  const response = await (await fetch(payload)).json()
  await log(`response: ${JSON.stringify(response)}`, 'DN_GMX_JIT')

  const tx = await dnGmxJIT.swapTokens(response.tx.to, response.tx.data, true)
  await tx.wait()

  await log(
    `swapped weth for usdc ${NETWORK_INF0.BLOCK_EXPLORER_URL}tx/${tx.hash}`,
    'DN_GMX_JIT'
  )
}

;(async () => {
  const provider = new ethers.providers.StaticJsonRpcProvider(
    NETWORK_INF0.HTTP_RPC_URL,
    NETWORK_INF0.CHAIN_ID
  )

  const signer = new ethers.Wallet(NETWORK_INF0.PK_JIT, provider)

  const { jitManager1, jitManager2 } = await deltaNeutralGmxJIT.getContracts(
    signer
  )

  cron.schedule('*/3 * * * *', async () => {
    await swapWbtcToWeth(jitManager1)
    await swapWethToUsdc(jitManager2)
  })
})().catch((e) => console.log(e))
