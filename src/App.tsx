import { useState, useEffect } from "react";
import { AppProvider } from "./context/AppContext";
import Header from "./components/Header";
import MarketTable from "./components/MarketTable";
import SignalFeed from "./components/SignalFeed";
import PortfolioOverview from "./components/PortfolioOverview";
import MarketRegimeCard from "./components/MarketRegimeCard";
import NewsIntelligenceCard from "./components/NewsIntelligenceCard";
import ResearchLabCard from "./components/ResearchLabCard";
import TradeModal from "./components/TradeModal";
import Login from "./components/Login";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if user is logged in
    const token = localStorage.getItem('kripto_token');
    fetch('/api/me', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    })
      .then(res => {
        if (res.ok) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      })
      .catch(() => setIsAuthenticated(false));
  }, []);

  if (isAuthenticated === null) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">Yükleniyor...</div>;
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <AppProvider>
      <div className="min-h-screen bg-zinc-950 flex flex-col">
        <Header />
        
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div className="lg:col-span-2 flex flex-col gap-6">
            <PortfolioOverview />
            <MarketRegimeCard />
            <NewsIntelligenceCard />
            <ResearchLabCard />
            <MarketTable />
          </div>

          <div className="lg:col-span-1 h-[calc(100vh-8rem)] sticky top-24">
            <SignalFeed />
          </div>

        </main>
      </div>
      <TradeModal />
    </AppProvider>
  );
}
