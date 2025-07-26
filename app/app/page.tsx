"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Activity, ExternalLink, Target, Clock, DollarSign, Zap, RefreshCw } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts"

interface Token {
  id: string
  symbol: string
  name: string
  address: string
  poolAddress: string
  score: number
  liquidity: number
  price: number
  priceChange: number
  age: string
  ageMinutes: number
  detectedAt: string
  lastUpdated: string
  isSpikingNow: boolean
  marketCap: number
  volume24h: number
}

// Mock chart data for token details
const generateMockChartData = (basePrice: number) => {
  const data = []
  let currentPrice = basePrice * 0.5 // Start at 50% of current price

  for (let i = 0; i < 30; i++) {
    const change = (Math.random() - 0.4) * 0.1 // Slight upward bias
    currentPrice = Math.max(currentPrice * (1 + change), 0.0001)
    data.push({
      time: `${30 - i}m`,
      price: currentPrice,
      liquidity: Math.max(Math.random() * 50, 5),
    })
  }

  return data.reverse()
}

export default function HuntrMVP() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [selectedToken, setSelectedToken] = useState<Token | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [error, setError] = useState<string | null>(null)

  // Fetch tokens from API
  const fetchTokens = async () => {
    try {
      setError(null)
      const response = await fetch("/api/tokens")
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = await response.json()
      setTokens(data.tokens || [])
      setLastUpdate(new Date())
    } catch (err) {
      console.error("Error fetching tokens:", err)
      setError(err instanceof Error ? err.message : "Failed to fetch tokens")
    } finally {
      setIsLoading(false)
    }
  }

  // Poll for updates every 15 seconds
  useEffect(() => {
    fetchTokens()
    const interval = setInterval(fetchTokens, 15000)
    return () => clearInterval(interval)
  }, [])

  const getScoreColor = (score: number) => {
    if (score >= 25) return "text-green-400"
    if (score >= 15) return "text-yellow-400"
    return "text-red-400"
  }

  const getScoreBadgeColor = (score: number) => {
    if (score >= 25) return "bg-green-500/20 text-green-400 border-green-500/30"
    if (score >= 15) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    return "bg-red-500/20 text-red-400 border-red-500/30"
  }

  const formatPrice = (price: number) => {
    if (price < 0.000001) return price.toExponential(2)
    if (price < 0.001) return price.toFixed(6)
    if (price < 1) return price.toFixed(4)
    return price.toFixed(2)
  }

  const formatLiquidity = (liquidity: number) => {
    if (liquidity >= 1000000) return `$${(liquidity / 1000000).toFixed(1)}M`
    if (liquidity >= 1000) return `$${(liquidity / 1000).toFixed(1)}K`
    return `$${liquidity.toFixed(0)}`
  }

  const getUniswapTradeUrl = (tokenAddress: string) => {
    return `https://app.uniswap.org/#/swap?outputCurrency=${tokenAddress}&chain=base`
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-400" />
          <p className="text-gray-400">Loading Base tokens...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Target className="w-8 h-8 text-blue-400" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Huntr MVP
              </h1>
              <Badge variant="outline" className="text-xs text-gray-400 border-gray-600">
                Base Network • Free Tier
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-400">Last update: {lastUpdate.toLocaleTimeString()}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchTokens}
                disabled={isLoading}
                className="border-gray-600 hover:border-gray-500 bg-transparent"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
            <p className="text-red-400">⚠️ {error}</p>
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
            <Activity className="w-5 h-5 text-green-400" />
            Base Token Leaderboard ({tokens.length} tokens)
          </h2>
          <p className="text-gray-400 text-sm">
            Newly launched tokens on Base with highest potential • Updates every 15 seconds
          </p>
        </div>

        {tokens.length === 0 ? (
          <Card className="bg-gray-900/50 border-gray-800">
            <CardContent className="p-8 text-center">
              <Target className="w-12 h-12 mx-auto mb-4 text-gray-600" />
              <h3 className="text-lg font-semibold mb-2 text-gray-400">No tokens detected yet</h3>
              <p className="text-gray-500 text-sm">Monitoring Base blockchain for new token launches...</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {tokens.map((token, index) => (
              <Card
                key={token.id}
                className="bg-gray-900/50
