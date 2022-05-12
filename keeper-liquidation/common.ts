import {
  getContracts,
  getContractsWithDeployments,
  sqrtPriceX96ToPrice,
} from '@ragetrade/sdk'
import { ethers, ContractTransaction } from 'ethers'
import { IUniswapV3Pool } from '@ragetrade/sdk'
import { IOracle__factory } from '@ragetrade/sdk'
IOracle__factory
export const provider = {
  mainnet: ethers.getDefaultProvider(),
  kovan: new ethers.providers.AlchemyProvider(
    'kovan',
    'gh1-tm4X9f0pxljEGsnFnPe693FZ-gim'
  ),
  rinkeby: new ethers.providers.AlchemyProvider(
    'rinkeby',
    'gh1-tm4X9f0pxljEGsnFnPe693FZ-gim'
  ),
  arbtest: new ethers.providers.StaticJsonRpcProvider(
    'https://arb-rinkeby.g.alchemy.com/v2/gh1-tm4X9f0pxljEGsnFnPe693FZ-gim'
  ),
  optest: new ethers.providers.StaticJsonRpcProvider(
    'https://opt-kovan.g.alchemy.com/v2/gh1-tm4X9f0pxljEGsnFnPe693FZ-gim'
  ),
}
export const wallet = new ethers.Wallet(
  '0x702bafd8721f459a81ef0264965331806ba1113e07c33a3552594ea027341c0c',
  provider.arbtest
)
console.log('wallet.address', wallet.address)

export async function wait(
  tx: ContractTransaction | Promise<ContractTransaction>
) {
  tx = await tx
  console.log(tx.hash)
  return await tx.wait()
}

export async function getLatestAccountNumber(addr: string) {
  const c = await getContracts(wallet)
  const logs = await c.clearingHouse.queryFilter(
    c.clearingHouse.filters.AccountCreated(addr)
  )
  return logs[logs.length - 1].args.accountId
}

export async function getCustomContracts() {
  return await getContractsWithDeployments(wallet, {
    AccountLibraryDeployment: { address: '0x1234' },
    ClearingHouseDeployment: { address: '0x1234' },
    ClearingHouseLogicDeployment: { address: '0x1234' },
    InsuranceFundDeployment: { address: '0x1234' },
    InsuranceFundLogicDeployment: { address: '0x1234' },
    ProxyAdminDeployment: { address: '0x1234' },
    RageTradeFactoryDeployment: { address: '0x1234' },
    SettlementTokenDeployment: { address: '0x1234' },
    VQuoteDeployment: { address: '0x1234' },
    VPoolWrapperLogicDeployment: { address: '0x1234' },
    SwapSimulatorDeployment: { address: '0x1234' },
    ETH_IndexOracleDeployment: { address: '0x1234' },
    ETH_vPoolDeployment: { address: '0x1234' },
    ETH_vPoolWrapperDeployment: { address: '0x1234' },
    ETH_vTokenDeployment: { address: '0x1234' },
  })
}

export async function getPrice(vPool: IUniswapV3Pool) {
  const { sqrtPriceX96 } = await vPool.slot0()

  return await sqrtPriceX96ToPrice(sqrtPriceX96, 6, 18)
}
