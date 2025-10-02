import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { StockLevel } from "@shared/schema";

export default function StockLevels() {
  const [filter, setFilter] = useState("");

  const { data: stockLevels, isLoading } = useQuery({
    queryKey: ["/api/stock"],
  });

  const filteredStock = (stockLevels as StockLevel[] || []).filter(item =>
    item.smart.toLowerCase().includes(filter.toLowerCase()) ||
    item.article.toLowerCase().includes(filter.toLowerCase()) ||
    (item.brand && item.brand.toLowerCase().includes(filter.toLowerCase())) ||
    (item.description && item.description.toLowerCase().includes(filter.toLowerCase()))
  );

  const getStockStatus = (qty: number) => {
    if (qty === 0) return { label: "Out of Stock", variant: "destructive" as const, icon: "fas fa-circle-xmark" };
    if (qty <= 10) return { label: "Low Stock", variant: "secondary" as const, icon: "fas fa-triangle-exclamation" };
    return { label: "In Stock", variant: "default" as const, icon: "fas fa-circle" };
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-8 py-4">
          <h2 className="text-2xl font-bold text-foreground">Stock Levels</h2>
          <p className="text-sm text-muted-foreground mt-1">Current inventory levels from inventory.stock VIEW</p>
        </div>
      </header>

      <div className="p-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Current Stock Levels</CardTitle>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Input
                    placeholder="Filter articles..."
                    className="w-48 pl-9 text-sm"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    data-testid="input-filter-stock"
                  />
                  <i className="fas fa-filter absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs"></i>
                </div>
                <Button variant="secondary" size="sm" data-testid="button-export-stock">
                  <i className="fas fa-download mr-2"></i>
                  Export
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">
                      <Button variant="ghost" size="sm" className="h-auto p-0 font-medium" data-testid="button-sort-smart">
                        SMART Code
                        <i className="fas fa-sort text-xs ml-2"></i>
                      </Button>
                    </TableHead>
                    <TableHead>
                      <Button variant="ghost" size="sm" className="h-auto p-0 font-medium" data-testid="button-sort-article">
                        Article
                        <i className="fas fa-sort text-xs ml-2"></i>
                      </Button>
                    </TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">
                      <Button variant="ghost" size="sm" className="h-auto p-0 font-medium ml-auto" data-testid="button-sort-qty">
                        Stock Qty
                        <i className="fas fa-sort text-xs ml-2"></i>
                      </Button>
                    </TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    [...Array(10)].map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20 mx-auto" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredStock.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        {filter ? "No stock items match your filter" : "No stock data available"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredStock.map((item) => {
                      const status = getStockStatus(item.totalQty);
                      return (
                        <TableRow key={`${item.smart}-${item.article}`} className="hover:bg-muted/50">
                          <TableCell className="font-mono font-semibold">{item.smart}</TableCell>
                          <TableCell className="font-mono">{item.article}</TableCell>
                          <TableCell>{item.brand || "—"}</TableCell>
                          <TableCell className="max-w-xs truncate">{item.description || "—"}</TableCell>
                          <TableCell className="text-right font-mono font-semibold">{item.totalQty}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={status.variant} className="text-xs">
                              <i className={`${status.icon} text-xs mr-1`}></i>
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                data-testid={`button-view-${item.smart}`}
                              >
                                <i className="fas fa-eye text-xs"></i>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                data-testid={`button-add-movement-${item.smart}`}
                              >
                                <i className="fas fa-plus text-xs"></i>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            
            {!isLoading && (
              <div className="flex items-center justify-between px-2 py-4">
                <div className="text-sm text-muted-foreground">
                  Showing <span className="font-semibold text-foreground">{filteredStock.length}</span> items
                  {filter && <span> (filtered from {(stockLevels as StockLevel[] || []).length} total)</span>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
