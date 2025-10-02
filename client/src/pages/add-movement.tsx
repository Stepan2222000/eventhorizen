import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertMovementSchema } from "@shared/schema";
import type { InsertMovement, Reason } from "@shared/schema";
import { z } from "zod";

const formSchema = insertMovementSchema.extend({
  qtyDelta: z.number().int().min(-999999).max(999999),
});

type FormData = z.infer<typeof formSchema>;

export default function AddMovement() {
  const [qtyInput, setQtyInput] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      smart: "",
      article: "",
      qtyDelta: 0,
      reason: "",
      note: "",
    },
  });

  const { data: reasons } = useQuery({
    queryKey: ["/api/reasons"],
  });

  const createMovementMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await apiRequest("POST", "/api/movements", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      
      toast({
        title: "Movement recorded",
        description: "Inventory movement has been successfully recorded",
      });
      
      form.reset();
      setQtyInput(0);
    },
    onError: (error) => {
      toast({
        title: "Failed to record movement",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    createMovementMutation.mutate({
      ...data,
      qtyDelta: qtyInput,
    });
  };

  const incrementQty = () => {
    setQtyInput(prev => prev + 1);
    form.setValue('qtyDelta', qtyInput + 1);
  };

  const decrementQty = () => {
    setQtyInput(prev => prev - 1);
    form.setValue('qtyDelta', qtyInput - 1);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-8 py-4">
          <h2 className="text-2xl font-bold text-foreground">Add Movement</h2>
          <p className="text-sm text-muted-foreground mt-1">Record inventory changes instantly</p>
        </div>
      </header>

      <div className="p-8">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-foreground">Movement Entry</div>
                  <p className="text-sm text-muted-foreground mt-1">Enter inventory movement details</p>
                </div>
                <i className="fas fa-plus-circle text-muted-foreground text-xl"></i>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="smart"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          SMART Code <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="SMART-XXXXX" 
                            className="font-mono" 
                            {...field}
                            data-testid="input-smart-code"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="article"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Article (as entered) <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Original article format" 
                            className="font-mono" 
                            {...field}
                            data-testid="input-article"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>
                        Quantity Change <span className="text-destructive">*</span>
                      </Label>
                      <div className="flex gap-2">
                        <Button 
                          type="button" 
                          variant="destructive" 
                          size="icon"
                          onClick={decrementQty}
                          data-testid="button-decrement-qty"
                        >
                          <i className="fas fa-minus"></i>
                        </Button>
                        <Input
                          type="number"
                          className="font-mono text-center"
                          value={qtyInput}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setQtyInput(val);
                            form.setValue('qtyDelta', val);
                          }}
                          data-testid="input-qty-delta"
                        />
                        <Button 
                          type="button" 
                          className="bg-success text-success-foreground hover:bg-success/90"
                          size="icon"
                          onClick={incrementQty}
                          data-testid="button-increment-qty"
                        >
                          <i className="fas fa-plus"></i>
                        </Button>
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Reason <span className="text-destructive">*</span>
                          </FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-reason">
                                <SelectValue placeholder="Select reason" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {(reasons as Reason[] || []).map((reason) => (
                                <SelectItem key={reason.code} value={reason.code}>
                                  {reason.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Note <span className="text-muted-foreground font-normal">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            rows={3}
                            placeholder="Additional comments..."
                            className="resize-none"
                            {...field}
                            value={field.value || ""}
                            data-testid="textarea-note"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex gap-3 pt-2">
                    <Button 
                      type="submit" 
                      className="flex-1"
                      disabled={createMovementMutation.isPending}
                      data-testid="button-submit-movement"
                    >
                      {createMovementMutation.isPending ? (
                        <>
                          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                          Recording...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-check mr-2"></i>
                          Record Movement
                        </>
                      )}
                    </Button>
                    <Button 
                      type="button" 
                      variant="secondary"
                      onClick={() => {
                        form.reset();
                        setQtyInput(0);
                      }}
                      data-testid="button-clear-form"
                    >
                      <i className="fas fa-rotate-left mr-2"></i>
                      Clear
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
