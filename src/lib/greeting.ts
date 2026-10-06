function words(value: string | null | undefined): string[] {
  return (value ?? "").trim().split(/\s+/).filter(Boolean);
}

// First character as a whole code point (so non-BMP letters and emoji are not split in half),
// uppercased first so a letter like "ß" still yields exactly one initial.
function firstChar(word: string): string {
  return Array.from(word.toUpperCase())[0] ?? "";
}

/** The first word of the name, hyphens kept, or "there" when there is no usable name. */
export function firstName(name: string | null | undefined): string {
  return words(name)[0] ?? "there";
}

/** Up to two initials from the first and last words of the name; the email's first letter when there is no name. Never empty. */
export function initials(name: string | null | undefined, email: string): string {
  const parts = words(name);
  if (parts.length > 0) {
    const first = firstChar(parts[0]);
    const last = parts.length > 1 ? firstChar(parts[parts.length - 1]) : "";
    return first + last;
  }
  return firstChar(email.trim()) || "?";
}
