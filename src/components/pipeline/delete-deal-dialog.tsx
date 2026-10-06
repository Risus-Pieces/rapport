"use client";

import { Trash2 } from "lucide-react";
import { deleteDealPartyAction } from "@/app/actions/deals";
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

export function DeleteDealDialog({ id, name, summary }: { id: string; name: string; summary: string }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive" size="lg" />}>
        <Trash2 aria-hidden />
        Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>This cannot be undone. {summary}</DialogDescription>
        </DialogHeader>
        <form action={deleteDealPartyAction}>
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
