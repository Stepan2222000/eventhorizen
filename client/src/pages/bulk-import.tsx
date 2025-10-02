import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { BulkImportResult } from "@shared/schema";

export default function BulkImport() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/bulk-import', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(await response.text());
      }
      
      return response.json();
    },
    onSuccess: (result: BulkImportResult) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      
      if (result.imported > 0) {
        toast({
          title: "Import completed",
          description: `Successfully imported ${result.imported} movements`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Failed to process file",
        variant: "destructive",
      });
    },
  });

  const downloadTemplateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/import-template');
      if (!response.ok) throw new Error('Failed to download template');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'inventory-import-template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
    onError: (error) => {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Failed to download template",
        variant: "destructive",
      });
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileSelect = (file: File) => {
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
    ];
    
    if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast({
        title: "Invalid file type",
        description: "Please select an Excel (.xlsx, .xls) or CSV file",
        variant: "destructive",
      });
      return;
    }
    
    setSelectedFile(file);
    setImportResult(null);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleImport = () => {
    if (!selectedFile) return;
    importMutation.mutate(selectedFile);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-8 py-4">
          <h2 className="text-2xl font-bold text-foreground">Bulk Import</h2>
          <p className="text-sm text-muted-foreground mt-1">Upload Excel/CSV files for batch inventory operations</p>
        </div>
      </header>

      <div className="p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* File Upload Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-foreground">Upload File</div>
                  <p className="text-sm text-muted-foreground mt-1">Select Excel or CSV file for import</p>
                </div>
                <i className="fas fa-file-import text-muted-foreground text-xl"></i>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Drop Zone */}
              <div 
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                  dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input')?.click()}
                data-testid="drop-zone-file-upload"
              >
                <i className="fas fa-cloud-arrow-up text-4xl text-muted-foreground mb-3"></i>
                <p className="text-sm font-medium text-foreground mb-1">
                  {selectedFile ? selectedFile.name : 'Drop file here or click to browse'}
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Excel (.xlsx, .xls) or CSV files only
                </p>
                <Button variant="secondary" size="sm" data-testid="button-browse-files">
                  <i className="fas fa-folder-open mr-2"></i>
                  Browse Files
                </Button>
                
                <input
                  id="file-input"
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileInput}
                />
              </div>

              {/* File Info */}
              {selectedFile && (
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div className="flex items-center gap-3">
                    <i className="fas fa-file-excel text-green-600 text-xl"></i>
                    <div>
                      <div className="font-medium text-sm">{selectedFile.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>
                  <Button 
                    onClick={handleImport}
                    disabled={importMutation.isPending}
                    data-testid="button-start-import"
                  >
                    {importMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                        Processing...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-upload mr-2"></i>
                        Start Import
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* Import Progress */}
              {importMutation.isPending && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Processing file...</span>
                    <span>Please wait</span>
                  </div>
                  <Progress value={undefined} className="h-2" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Format Info & Template Download */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <i className="fas fa-info-circle text-primary"></i>
                  Expected Format
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-2 border-b">
                    <span className="font-medium">Column</span>
                    <span className="font-medium">Required</span>
                  </div>
                  <div className="flex justify-between">
                    <span>article</span>
                    <Badge variant="destructive" className="text-xs">Required</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>qty_delta</span>
                    <Badge variant="destructive" className="text-xs">Required</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>reason</span>
                    <Badge variant="destructive" className="text-xs">Required</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>note</span>
                    <Badge variant="secondary" className="text-xs">Optional</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>smart</span>
                    <Badge variant="secondary" className="text-xs">Optional</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Download Template</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Download a pre-formatted Excel template with sample data and column headers.
                </p>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => downloadTemplateMutation.mutate()}
                  disabled={downloadTemplateMutation.isPending}
                  data-testid="button-download-template"
                >
                  {downloadTemplateMutation.isPending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                      Downloading...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-download mr-2"></i>
                      Download Template
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Import Results */}
          {importResult && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-3">
                  {importResult.errors.length === 0 ? (
                    <i className="fas fa-circle-check text-success text-xl"></i>
                  ) : importResult.imported > 0 ? (
                    <i className="fas fa-triangle-exclamation text-warning text-xl"></i>
                  ) : (
                    <i className="fas fa-circle-xmark text-destructive text-xl"></i>
                  )}
                  Import Results
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-muted rounded-lg">
                    <div className="text-2xl font-bold font-mono">{importResult.totalRows}</div>
                    <div className="text-sm text-muted-foreground">Total Rows</div>
                  </div>
                  <div className="text-center p-4 bg-success/10 rounded-lg">
                    <div className="text-2xl font-bold font-mono text-success">{importResult.imported}</div>
                    <div className="text-sm text-muted-foreground">Imported</div>
                  </div>
                  <div className="text-center p-4 bg-destructive/10 rounded-lg">
                    <div className="text-2xl font-bold font-mono text-destructive">{importResult.errors.length}</div>
                    <div className="text-sm text-muted-foreground">Errors</div>
                  </div>
                </div>

                {importResult.errors.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <i className="fas fa-exclamation-triangle text-destructive"></i>
                      Import Errors
                    </h4>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {importResult.errors.map((error, index) => (
                        <Alert key={index} variant="destructive">
                          <AlertDescription>
                            <strong>Row {error.row}:</strong> {error.error}
                            <div className="text-xs mt-1 font-mono">
                              {JSON.stringify(error.data)}
                            </div>
                          </AlertDescription>
                        </Alert>
                      ))}
                    </div>
                  </div>
                )}

                {importResult.imported > 0 && (
                  <Alert>
                    <i className="fas fa-circle-check"></i>
                    <AlertDescription>
                      Successfully imported {importResult.imported} movement{importResult.imported !== 1 ? 's' : ''} into the inventory system.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
