import { isMovementWithinSpread, calculateFinalPrice, calculateArbRevenue } from './helpers'

const main = async () => {
    console.log('Testing Arb Revenue Calcuation:')
    console.log('Case 1: Rage underpriced')
    let pFtx = 1000
    let potentialArbSize = 100
    let ethPriceReceived = 950
    let ftxFee = 0
    let arbRevenue = calculateArbRevenue(pFtx, potentialArbSize, ethPriceReceived, ftxFee)
    console.log('arbRevenue', arbRevenue)
    console.log('Case 2: Rage overpriced')
    pFtx = 900
    potentialArbSize = -100
    let arbRevenue2 = calculateArbRevenue(pFtx, potentialArbSize, ethPriceReceived, ftxFee)
    console.log('arbRevenue', arbRevenue2)
    if (Math.abs(arbRevenue2 - arbRevenue) < 0.1){
        console.log('Test Passed! Numbers are equal')
    } else {
        console.log('Test Failed! Numbers are not equal')
    }
}

main().then(() => console.log('Running test cases!'))