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
              <h3 className="text-lg font-semibold text-foreground">Выберите SMART код</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Найдено несколько совпадений для артикула: <span className="font-mono font-semibold">{searchQuery}</span>
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>
        
        <div className="overflow-y-auto max-h-[50vh] space-y-2 pr-2">
          {matches.map((match) => (
            <button
              key={match.smart}
              onClick={() => onSelect(match)}
              className="w-full text-left p-3 rounded-lg border-2 border-border bg-card hover:border-primary hover:bg-primary/5 transition-all"
              data-testid={`select-smart-${match.smart}`}
            >
              <div className="flex items-start justify-between mb-1">
                <div className="font-mono font-semibold text-base text-foreground">{match.smart}</div>
                {match.brand && match.brand.length > 0 && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                    {match.brand.join(', ')}
                  </span>
                )}
              </div>
              {match.articles && match.articles.length > 0 && (
                <div className="text-xs text-muted-foreground mb-1">
                  <span className="font-semibold">Артикулы: </span>
                  <span className="font-mono">{match.articles.join(', ')}</span>
                </div>
              )}
              {match.description && match.description.length > 0 && (
                <div className="text-xs text-foreground mb-1">
                  <span className="font-semibold">Описание: </span>
                  {match.description.join(', ')}
                </div>
              )}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <div>
                  <span className="font-semibold">Остаток:</span>
                  <span className="font-mono ml-1">{match.currentStock}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
        
        <div className="border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} className="w-full" data-testid="button-cancel-disambiguation">
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
