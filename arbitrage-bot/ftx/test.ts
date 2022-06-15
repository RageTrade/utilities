import Ftx from '.'
import { FTX_CONFIG, AMM_CONFIG } from '../../config'

const ftx = new Ftx({
  isPriceArb: true,
  rageAccountId: AMM_CONFIG.FUNDING_ARB_ACCOUNT_ID,
})

async function main() {
  await ftx.initialize()
  // console.log(ftx.takerFee)
  // await ftx._preFlightChecks()
  // console.log(await ftx._estimateFees(0.0002, 2900))
  // console.log(await ftx.queryFtxPrice())
  // console.log(await ftx._netProfit())
  // await ftx.updatePosition(
  //   0.005 * 1000,
  //   'sell'
  // )
  // console.log(await ftx.queryFtxPosition())
  // console.log(await ftx.queryFtxAccount())
  // console.log(await ftx.updatePosition(0.472 * 1000))

  // console.log(await ftx._updateCurrentFundingRate())
  // console.log('currentFundingRate', ftx.currentFundingRate)
}

main()
  .then(() => console.log('completed'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

// entryPrice after each trade, realizedPnl after each trade, realizedPnl when bot is started
// pnl, funding payment => script

// every trade (size, side, execution price, transaction cost)
// funding paid/received

// t0, p1
// current time, p2

// XXX
// for each trade p1 -> p2 {
//  query values
//  expected pnl:  (amount bought - amount sold) * current price

// actual - expected > some %, notify
// }
