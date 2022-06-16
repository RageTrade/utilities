import RageTrade from './index'
import { AMM_CONFIG } from '../../config'

async function main() {
  const rageTrade = new RageTrade({
    isPriceArb: true,
    rageAccountId: AMM_CONFIG.FUNDING_ARB_ACCOUNT_ID,
  })
  await rageTrade.initialize()

  // console.log(await rageTrade.getCurrentFundingRate())
}

main()
  .then(() => console.log('completed'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
