import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import Dashboard from "@/pages/dashboard";
import AddMovement from "@/pages/add-movement";
import StockLevels from "@/pages/stock-levels";
import StockDetails from "@/pages/stock-details";
import MovementHistory from "@/pages/movement-history";
import SoldItems from "@/pages/sold-items";
import SoldOut from "@/pages/sold-out";
import TopParts from "@/pages/top-parts";
import BulkImport from "@/pages/bulk-import";
import Customers from "@/pages/customers";
import CustomerDetails from "@/pages/customer-details";
import OrderDetails from "@/pages/order-details";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/movement" component={AddMovement} />
      <Route path="/stock/:smart" component={StockDetails} />
      <Route path="/stock" component={StockLevels} />
      <Route path="/history" component={MovementHistory} />
      <Route path="/sold-out" component={SoldOut} />
      <Route path="/orders" component={SoldItems} />
      <Route path="/sold" component={SoldItems} />
      <Route path="/orders/:id" component={OrderDetails} />
      <Route path="/customers" component={Customers} />
      <Route path="/customers/:id" component={CustomerDetails} />
      <Route path="/top-parts" component={TopParts} />
      <Route path="/import" component={BulkImport} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mx-2 h-4" />
              <div className="min-w-0 truncate text-sm font-medium">SMART Инвентаризация</div>
            </header>
            <div className="flex-1 overflow-y-auto">
              <Router />
            </div>
          </SidebarInset>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
