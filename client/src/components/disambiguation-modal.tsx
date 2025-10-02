import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ArticleSearchResult } from "@shared/schema";

interface DisambiguationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (result: ArticleSearchResult) => void;
  matches: ArticleSearchResult[];
  searchQuery: string;
}

export function DisambiguationModal({ 
  isOpen, 
  onClose, 
  onSelect, 
  matches, 
  searchQuery 
}: DisambiguationModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Select SMART Code</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Multiple matches found for article: <span className="font-mono font-semibold">{searchQuery}</span>
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto space-y-3">
          {matches.map((match) => (
            <button
              key={match.smart}
              onClick={() => onSelect(match)}
              className="w-full text-left p-4 rounded-lg border-2 border-border bg-card hover:border-primary hover:bg-primary/5 transition-all"
              data-testid={`select-smart-${match.smart}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-mono font-semibold text-lg text-foreground">{match.smart}</div>
                {match.brand && (
                  <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-muted text-muted-foreground">
                    {match.brand}
                  </span>
                )}
              </div>
              {match.description && (
                <div className="text-sm text-foreground mb-2">{match.description}</div>
              )}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <div>
                  <span className="font-semibold">Stock:</span>
                  <span className="font-mono ml-1">{match.currentStock}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
        
        <div className="border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} className="w-full" data-testid="button-cancel-disambiguation">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
