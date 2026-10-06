"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deletionSummary, type ContactImpact } from "@/lib/delete-summary";
import { deleteContactAction } from "../actions";

export function DeleteContactDialog({ id, name, impact }: { id: string; name: string; impact: ContactImpact }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive" size="lg" />}>
        <Trash2 aria-hidden />
        Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>
            This cannot be undone. {deletionSummary(impact)} Archive instead to hide them and keep their history.
          </DialogDescription>
        </DialogHeader>
        <form action={deleteContactAction}>
          <input type="hidden" name="id" value={id} />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="lg" type="button" />}>Keep</DialogClose>
            <Button type="submit" variant="destructive" size="lg">
              Delete for good
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
