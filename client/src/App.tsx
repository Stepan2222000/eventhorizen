import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import Dashboard from "@/pages/dashboard";
import ArticleSearch from "@/pages/article-search";
import AddMovement from "@/pages/add-movement";
import StockLevels from "@/pages/stock-levels";
import StockDetails from "@/pages/stock-details";
import MovementHistory from "@/pages/movement-history";
import SoldItems from "@/pages/sold-items";
import BulkImport from "@/pages/bulk-import";
import DbConnections from "@/pages/db-connections";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/search" component={ArticleSearch} />
      <Route path="/movement" component={AddMovement} />
      <Route path="/stock/:smart" component={StockDetails} />
      <Route path="/stock" component={StockLevels} />
      <Route path="/history" component={MovementHistory} />
      <Route path="/sold" component={SoldItems} />
      <Route path="/import" component={BulkImport} />
      <Route path="/db-connections" component={DbConnections} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-hidden">
            <Router />
          </main>
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
