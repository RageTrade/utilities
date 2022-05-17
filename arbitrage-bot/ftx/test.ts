import Ftx from '.'
import { FTX_CONFIG } from '../../config'

const ftx = new Ftx()

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
  // console.log(await ftx.updatePosition(-0.914 * 1000))

  console.log(await ftx._updateCurrentFundingRate())
  console.log('currentFundingRate', ftx.currentFundingRate)
  console.log('netNotionalFundingPaid', ftx.netNotionalFundingPaid)
}

main()
  .then(() => console.log('completed'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
