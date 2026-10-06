import { AlarmClock, CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { describeReminder, type Reminder } from "@/lib/reminders";

// State is always icon + words, never color alone.
export function ReminderBadge({ reminder }: { reminder: Reminder }) {
  const text = describeReminder(reminder);
  if (reminder.status === "overdue") {
    return (
      <Badge variant="destructive" className="h-6 px-2.5">
        <CircleAlert aria-hidden />
        {text}
      </Badge>
    );
  }
  if (reminder.status === "due_soon") {
    return (
      <Badge variant="outline" className="h-6 px-2.5">
        <AlarmClock aria-hidden />
        {text}
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">{text}</span>;
}
