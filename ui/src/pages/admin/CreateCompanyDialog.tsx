//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { companiesApi } from "@/api/companies";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/context/ToastContext";

interface Props {
  onClose: () => void;
}

export function CreateCompanyDialog({ onClose }: Props) {
  const qc = useQueryClient();
  const { pushToast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  //// Neocompany Modification — isTest flag in create dialog
  const [isTest, setIsTest] = useState(false);
  //// End Neocompany Modification

  const createMut = useMutation({
    mutationFn: () =>
      companiesApi.create({
        name: name.trim(),
        description: description.trim() || null,
        //// Neocompany Modification — propagate isTest flag to server
        isTest,
        //// End Neocompany Modification
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.companies.all });
      qc.invalidateQueries({ queryKey: queryKeys.companies.stats });
    },
    onSuccess: () => {
      pushToast({ title: `Company "${name}" created`, tone: "success" });
      onClose();
    },
    onError: (err) => pushToast({ title: `Create failed: ${(err as Error).message}`, tone: "error" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl">
        <h2 className="text-base font-semibold mb-4">Create company</h2>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this company does"
            />
          </div>
          {/* //// Neocompany Modification — isTest checkbox for dev/test companies */}
          <label className="flex items-start gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={isTest}
              onChange={(e) => setIsTest(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span className="flex-1 text-sm">
              <span className="font-medium inline-flex items-center gap-1.5">
                <span>🧪 Test company</span>
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Hidden from client boards. Use for E2E / smoke / manual dev.
              </span>
            </span>
          </label>
          {/* //// End Neocompany Modification */}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => createMut.mutate()}
            disabled={!name.trim() || createMut.isPending}
          >
            {createMut.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
