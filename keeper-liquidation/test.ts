import {
  getContracts,
  priceToTick,
  tickToNearestInitializableTick,
  maxLiquidityForAmounts,
  priceToSqrtPriceX96,
} from '@ragetrade/sdk'
import { parseUnits } from 'ethers/lib/utils'
import { wait, wallet, getLatestAccountNumber } from './common'

async function main() {
  // console.log("#### Add Liquidity");

  const c = await getContracts(wallet)

  const accNo = 10
  console.log({ accNo })

  // console.log('accInfo', await c.clearingHouse.getAccountMarketValueAndRequiredMargin(accNo, false))
  // console.log('price', await c.clearingHouse.getVirtualTwapPriceX128(c.eth_vToken.address.slice(34, 42)))

  const position = await c.clearingHouse.getAccountInfo(accNo)
  console.log(c.clearingHouse.address)
  console.log('position', position.tokenPositions)

  // console.log('protocolInfo', await c.clearingHouse.getPoolInfo("0x" + c.eth_vToken.address.slice(34, 42)))

  // console.log("0x" + c.eth_vToken.address.slice(34, 42))
  // console.log(c.eth_vToken.address);

  // // for (let i = 0; i < prices.length - 1; i++) {
  // const tickLower = tickToNearestInitializableTick(await priceToTick(2450, 6, 18, true));
  // const tickUpper = tickToNearestInitializableTick(await priceToTick(2456, 6, 18, true));
  // console.log(tickLower, tickUpper, 2450, 2456);

  // await wait(
  //   c.clearingHouse.updateRangeOrder(
  //     accNo,
  //     "0x" + c.eth_vToken.address.slice(34, 42),
  //     {
  //       tickLower,
  //       tickUpper,
  //       liquidityDelta: maxLiquidityForAmounts(
  //         await priceToSqrtPriceX96(2456, 6, 18),
  //         tickLower,
  //         tickUpper,
  //         parseUnits(String(100), 6),
  //         parseUnits(String(100 / 2000), 18),
  //         true
  //       ),
  //       sqrtPriceCurrent: "0",
  //       slippageToleranceBps: 10000,
  //       closeTokenPosition: false,
  //       limitOrderType: 0,
  //       settleProfit: false
  //     },
  //     {
  //       // gasLimit: 2000000
  //     }
  //   )
  // );
  // }

  // InvalidTransactionNotEnoughMargin
}

main().catch(console.error)
