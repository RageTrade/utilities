import RageTrade from './index'
import { AMM_CONFIG } from '../../config'

async function main() {
  const rageTrade = new RageTrade({
    isPriceArb: true,
    rageAccountId: AMM_CONFIG.FUNDING_ARB_ACCOUNT_ID,
  })
  await rageTrade.initialize()

  console.log(
    await rageTrade.getLiquidityInRange(1951.5187099417672, 1961.8462222621959)
  )
}

main()
  .then(() => console.log('completed'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
