import { Pool } from "pg"

// Singleton pattern for database connection
class Database {
  private static instance: Database
  private pool: Pool

  private constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })

    // Handle connection errors
    this.pool.on("error", (err) => {
      console.error("Unexpected error on idle client", err)
    })
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database()
    }
    return Database.instance
  }

  public async query(text: string, params?: any[]) {
    const client = await this.pool.connect()
    try {
      const result = await client.query(text, params)
      return result
    } finally {
      client.release()
    }
  }

  public async getClient() {
    return await this.pool.connect()
  }

  public async close() {
    await this.pool.end()
  }
}

export const db = Database.getInstance()

// Database helper functions
export async function saveToken(tokenData: {
  address: string
  symbol: string
  name: string
  poolAddress: string
  score: number
  liquidity: number
  price: number
  priceChange: number
  ageMinutes: number
  marketCap: number
  volume24h: number
  isSpikingNow: boolean
  tokenType?: string
}) {
  const query = `
    INSERT INTO tokens (
      address, symbol, name, pool_address, score, liquidity, price, 
      price_change, age_minutes, market_cap, volume_24h, is_spiking_now, token_type
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (address) 
    DO UPDATE SET
      score = EXCLUDED.score,
      liquidity = EXCLUDED.liquidity,
      price = EXCLUDED.price,
      price_change = EXCLUDED.price_change,
      age_minutes = EXCLUDED.age_minutes,
      last_updated = CURRENT_TIMESTAMP,
      is_spiking_now = EXCLUDED.is_spiking_now,
      market_cap = EXCLUDED.market_cap,
      volume_24h = EXCLUDED.volume_24h
    RETURNING *
  `

  const values = [
    tokenData.address,
    tokenData.symbol,
    tokenData.name,
    tokenData.poolAddress,
    tokenData.score,
    tokenData.liquidity,
    tokenData.price,
    tokenData.priceChange,
    tokenData.ageMinutes,
    tokenData.marketCap,
    tokenData.volume24h,
    tokenData.isSpikingNow,
    tokenData.tokenType || "UNKNOWN",
  ]

  return await db.query(query, values)
}

export async function getTopTokens(limit = 20) {
  const query = `
    SELECT 
      address as id,
      symbol,
      name,
      address,
      pool_address as "poolAddress",
      score,
      liquidity,
      price,
      price_change as "priceChange",
      CASE 
        WHEN age_minutes < 60 THEN age_minutes || 'm'
        ELSE (age_minutes / 60) || 'h'
      END as age,
      age_minutes as "ageMinutes",
      detected_at as "detectedAt",
      last_updated as "lastUpdated",
      is_spiking_now as "isSpikingNow",
      market_cap as "marketCap",
      volume_24h as "volume24h",
      token_type as "tokenType"
    FROM tokens 
    WHERE detected_at > NOW() - INTERVAL '2 hours'
    ORDER BY score DESC, detected_at DESC
    LIMIT $1
  `

  const result = await db.query(query, [limit])
  return result.rows
}

export async function updateTokenAges() {
  const query = `
    UPDATE tokens 
    SET 
      age_minutes = EXTRACT(EPOCH FROM (NOW() - detected_at)) / 60,
      last_updated = NOW()
    WHERE detected_at > NOW() - INTERVAL '2 hours'
    RETURNING address, age_minutes
  `

  return await db.query(query)
}

export async function cleanupOldTokens() {
  const query = `
    DELETE FROM tokens 
    WHERE detected_at < NOW() - INTERVAL '4 hours'
    RETURNING address, symbol
  `

  return await db.query(query)
}
