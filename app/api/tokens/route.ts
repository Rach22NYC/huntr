import { NextResponse } from "next/server"
import { createPublicClient, http, getContract, parseAbiItem } from "viem"
import { base } from "viem/chains"
import { saveToken, getTopTokens, updateTokenAges, cleanupOldTokens } from "@/lib/database"

// Base network addresses
const UNISWAP_V4_POOL_MANAGER = "0x38EB8B22Df3Ae7fb21e92881151B365Df14ba967"
const BASE_WETH = "0x4200000000000000000000000000000000000006"
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

// Create viem client with free Base RPC
const client = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
})

// ERC20 ABI for token metadata
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
] as const

// Pool Initialize event
const POOL_INITIALIZE_EVENT = parseAbiItem(
  "event Initialize(bytes32 indexed poolId, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, bytes hookData)",
)

// Track last processed block in memory (in production, store in database)
let lastBlockProcessed = 0n

export async function GET() {
  try {
    console.log("🔍 Starting Base token scan...")

    // First, update existing token ages and clean up old ones
    await updateTokenAges()
    await cleanupOldTokens()

    // Get current block number
    const currentBlock = await client.getBlockNumber()
    console.log(`Current block: ${currentBlock}`)

    // Look back 200 blocks (~10 minutes on Base) or from last processed block
    const fromBlock = lastBlockProcessed > 0n ? lastBlockProcessed + 1n : currentBlock - 200n

    console.log(`Scanning blocks ${fromBlock} to ${currentBlock}`)

    // Get pool initialization events
    const logs = await client.getContractEvents({
      address: UNISWAP_V4_POOL_MANAGER,
      event: POOL_INITIALIZE_EVENT,
      fromBlock,
      toBlock: currentBlock,
    })

    console.log(`Found ${logs.length} pool initialization events`)

    // Process new pools
    let newTokensFound = 0
    for (const log of logs) {
      const wasNew = await processPoolEvent(log)
      if (wasNew) newTokensFound++
    }

    // Update last processed block
    lastBlockProcessed = currentBlock

    // Get top tokens from database
    const tokens = await getTopTokens(20)

    console.log(`Returning ${tokens.length} tokens (${newTokensFound} new this scan)`)

    return NextResponse.json({
      tokens,
      lastUpdate: new Date().toISOString(),
      blocksScanned: `${fromBlock}-${currentBlock}`,
      newTokensFound,
      totalEvents: logs.length,
    })
  } catch (error) {
    console.error("Error in token scan:", error)

    // Try to return cached data from database on error
    try {
      const tokens = await getTopTokens(20)
      return NextResponse.json({
        tokens,
        error: "Scan failed, returning cached data",
        details: error instanceof Error ? error.message : "Unknown error",
        lastUpdate: new Date().toISOString(),
      })
    } catch (dbError) {
      return NextResponse.json(
        {
          error: "Complete system failure",
          scanError: error instanceof Error ? error.message : "Unknown scan error",
          dbError: dbError instanceof Error ? dbError.message : "Unknown database error",
          tokens: [],
        },
        { status: 500 },
      )
    }
  }
}

async function processPoolEvent(log: any): Promise<boolean> {
  try {
    const { poolId, currency0, currency1, fee, hookData } = log.args

    // Check if this is a WETH or USDC pair
    const isWETHPair = currency0 === BASE_WETH || currency1 === BASE_WETH
    const isUSDCPair = currency0 === BASE_USDC || currency1 === BASE_USDC

    if (!isWETHPair && !isUSDCPair) return false

    const tokenAddress = currency0 === BASE_WETH || currency0 === BASE_USDC ? currency1 : currency0
    const pairedWith = isWETHPair ? "WETH" : "USDC"

    // Check if we already have this token in database
    const existingTokens = await getTopTokens(100) // Check more tokens
    if (existingTokens.find((t) => t.address.toLowerCase() === tokenAddress.toLowerCase())) {
      return false
    }

    console.log(`🆕 New ${pairedWith} pair: ${tokenAddress}`)

    // Get token metadata
    const tokenData = await getTokenMetadata(tokenAddress)
    if (!tokenData) return false

    // Classify token type
    const tokenType = classifyTokenType(hookData, fee)

    // Calculate initial score
    const ageMinutes = 0
    const liquidityUSD = Math.random() * 20000 + 5000 // Mock: $5k-$25k initial liquidity
    const priceChangePercent = Math.random() * 50 // Mock: 0-50% initial pump

    const score = calculateTokenScore({
      ageMinutes,
      liquidityUSD,
      priceChangePercent,
    })

    // Save to database
    const newToken = {
      address: tokenAddress,
      symbol: tokenData.symbol,
      name: tokenData.name,
      poolAddress: poolId,
      score,
      liquidity: liquidityUSD,
      price: Math.random() * 0.001 + 0.0001, // Mock price
      priceChange: priceChangePercent,
      ageMinutes: 0,
      marketCap: liquidityUSD * (Math.random() * 10 + 5), // Mock market cap
      volume24h: liquidityUSD * (Math.random() * 2 + 0.5), // Mock volume
      isSpikingNow: score >= 25,
      tokenType,
    }

    await saveToken(newToken)

    console.log(`✅ Saved token: ${tokenData.symbol} (Score: ${score}, Type: ${tokenType})`)
    return true
  } catch (error) {
    console.error("Error processing pool event:", error)
    return false
  }
}

async function getTokenMetadata(tokenAddress: string) {
  try {
    const tokenContract = getContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      client,
    })

    const [name, symbol, decimals] = await Promise.all([
      tokenContract.read.name().catch(() => "Unknown Token"),
      tokenContract.read.symbol().catch(() => "UNK"),
      tokenContract.read.decimals().catch(() => 18),
    ])

    // Basic validation
    if (symbol.length > 20 || name.length > 100) {
      console.log(`Skipping token with invalid metadata: ${symbol}`)
      return null
    }

    return { name, symbol, decimals }
  } catch (error) {
    console.error(`Error fetching metadata for ${tokenAddress}:`, error)
    return null
  }
}

function classifyTokenType(hookData: string, fee: number): string {
  // Simple classification based on fee and hook data
  if (fee === 3000) return "BASE_APP" // 0.3% fee common for Base App
  if (fee === 10000) return "ZORA" // 1% fee sometimes used by Zora
  if (hookData && hookData !== "0x") return "HOOKED" // Has custom hooks
  return "STANDARD"
}

function calculateTokenScore(metrics: {
  ageMinutes: number
  liquidityUSD: number
  priceChangePercent: number
}): number {
  let score = 0

  // Age factor (newer = better, max 10 points)
  if (metrics.ageMinutes < 5) {
    score += 10
  } else if (metrics.ageMinutes < 15) {
    score += 8
  } else if (metrics.ageMinutes < 30) {
    score += 5
  }

  // Liquidity factor (higher = better, max 10 points)
  if (metrics.liquidityUSD > 20000) {
    score += 10
  } else if (metrics.liquidityUSD > 10000) {
    score += 8
  } else if (metrics.liquidityUSD > 5000) {
    score += 6
  } else if (metrics.liquidityUSD > 2000) {
    score += 3
  }

  // Price movement factor (higher = better, max 10 points)
  if (metrics.priceChangePercent > 100) {
    score += 10
  } else if (metrics.priceChangePercent > 50) {
    score += 8
  } else if (metrics.priceChangePercent > 25) {
    score += 6
  } else if (metrics.priceChangePercent > 10) {
    score += 3
  }

  return Math.min(30, score) // Max score of 30
}
