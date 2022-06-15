const { GraphQLClient, gql } = require('graphql-request')

const fpQuery = gql`
  query fundingPaymentHistory($accountId: ID!) {
    account(id: $accountId) {
      fundingPaymentRealizedEntriesCount

      fundingPaymentRealizedEntries(
        where: { amount_not: "0", timestamp_gt: "1654560000" }
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        timestamp
        transactionHash
        side
        amount
        vTokenPosition

        fundingRate
        timeElapsed
        avgTwapPrice
      }
    }
  }
`

const tokenPositionQuery = gql`
  query accountTradeHistory($accountId: ID!) {
    account(id: $accountId) {
      tokenPositionChangeEntriesCount

      tokenPositionChangeEntries(
        where: { timestamp_gt: "1654560000" }
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        timestamp
        transactionHash
        vTokenAmountOut
        vQuoteAmountOut

        geometricMeanPrice
        entryPrice
        realizedPnL
      }
    }
  }
`

const endpoint =
  'https://api.thegraph.com/subgraphs/name/fr0ntenddev/rage-trade'

const client = new GraphQLClient(endpoint, {})

async function main() {
  let netFp = 0
  let netPnl = 0

  const fpData = await client.request(fpQuery, {
    accountId: '4',
  })

  const tpData = await client.request(tokenPositionQuery, {
    accountId: '4',
  })

  for (const each of fpData.account.fundingPaymentRealizedEntries) {
    netFp += Number(each.amount)
  }

  console.log(tpData.account.tokenPositionChangeEntries[0])

  for (const each of tpData.account.tokenPositionChangeEntries) {
    netPnl += Number(each.realizedPnL)
  }

  console.log('net funding amount paid/received', netFp)
  console.log('net PnL', netPnl)
}

main()
  .then(() => console.log('DONE'))
  .catch((e) => console.log('ERROR OCCURED', e))
