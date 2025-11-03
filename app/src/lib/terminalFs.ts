import { format } from "date-fns";

export function formatLsDate(date: Date) {
  return format(date, "MMM dd yyyy");
}
