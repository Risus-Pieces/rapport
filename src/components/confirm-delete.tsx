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

type ConfirmDeleteProps = {
  id: string;
  action: (formData: FormData) => void | Promise<void>;
  /** Names the thing for screen readers, e.g. "task Send deck". */
  label: string;
  title: string;
  description: string;
};

// Icon-only trigger with a confirmation dialog: hard deletes are never one tap.
export function ConfirmDelete({ id, action, label, title, description }: ConfirmDeleteProps) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon-lg" aria-label={`Delete ${label}`} />}>
        <Trash2 aria-hidden />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={action}>
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
