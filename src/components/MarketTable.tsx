import { Star, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { useApp } from "../context/AppContext";
import { formatCurrency, cn } from "../lib/utils";

export default function MarketTable() {
  const { marketData, state, toggleFavorite, openTradeModal, fetchMarketData, forceSignalCheck, isRefreshingMarket } = useApp();

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">
      <div className="p-5 flex items-center justify-between border-b border-zinc-800">
        <div>
          <h2 className="text-lg font-medium text-zinc-100">Piyasa Analizi</h2>
          <p className="text-sm text-zinc-400 mt-1">Binance Global Spot • hacme göre dinamik ilk 50 USDT paritesi.</p>
        </div>
        <button 
          onClick={fetchMarketData}
          className="p-2 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors focus:outline-none"
        >
          <RefreshCw size={16} className={cn("text-zinc-400", isRefreshingMarket ? "animate-spin" : "")} />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-800/20 text-xs uppercase tracking-wider text-zinc-500">
              <th className="py-3 px-5 font-medium">Varlık</th>
              <th className="py-3 px-5 font-medium text-right">Fiyat</th>
              <th className="py-3 px-5 font-medium text-right">24s Değişim</th>
              <th className="py-3 px-5 font-medium text-right">Hacim</th>
              <th className="py-3 px-5 font-medium text-center">İşlem / İzleme</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {marketData.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-zinc-500 text-sm">
                  Veriler yükleniyor...
                </td>
              </tr>
            ) : (
              marketData.map((coin) => {
                const isFavorite = state.favorites.includes(coin.symbol);
                const isPositive = coin.change24h >= 0;

                return (
                  <tr key={coin.symbol} className="hover:bg-zinc-800/20 transition-colors group">
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-xs text-zinc-300 border border-zinc-700">
                          {coin.symbol[0]}
                        </div>
                        <div>
                          <div className="font-medium text-zinc-200">{coin.symbol}</div>
                          <div className="text-xs text-zinc-500">{coin.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-5 text-right font-medium text-zinc-200">
                      {formatCurrency(coin.price)}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <div className={cn(
                        "inline-flex items-center gap-1 text-sm font-medium px-2 py-1 rounded-md",
                        isPositive ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                      )}>
                        {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {isPositive ? "+" : ""}{coin.change24h}%
                      </div>
                    </td>
                    <td className="py-3 px-5 text-right text-sm text-zinc-400">
                      ${coin.volume}
                    </td>
                    <td className="py-3 px-5 text-center flex items-center justify-center gap-2">
                      <button
                        onClick={() => toggleFavorite(coin.symbol)}
                        className="p-2 rounded-lg hover:bg-zinc-800 transition-colors focus:outline-none"
                        title="Favorilere Ekle"
                      >
                        <Star
                          size={18}
                          className={cn(
                            "transition-colors",
                            isFavorite ? "fill-yellow-500 text-yellow-500" : "text-zinc-600 group-hover:text-zinc-400"
                          )}
                        />
                      </button>
                      <button
                        onClick={() => forceSignalCheck(coin.symbol)}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-md transition-colors"
                      >
                        Analiz Et
                      </button>
                      <button
                        onClick={() => openTradeModal(coin.symbol)}
                        className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded-md transition-colors"
                      >
                        Al / Sat
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
