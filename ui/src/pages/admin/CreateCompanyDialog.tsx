//// Neoffice Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
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

  const createMut = useMutation({
    mutationFn: () =>
      companiesApi.create({
        name: name.trim(),
        description: description.trim() || null,
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
