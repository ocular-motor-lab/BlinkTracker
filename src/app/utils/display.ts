export const formatStatusLabel = (value: string): string =>
  value
    .split(/([_\-\s]+)/)
    .map((part) => {
      if (/^[_\-\s]+$/.test(part)) {
        return part.replace(/[_-]/g, ' ');
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
