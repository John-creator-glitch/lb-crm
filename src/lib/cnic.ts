// CNIC mask: 12345-1234567-1 (digits only are kept, at most 13)
export function maskCnic(s: string): string {
  const d = (s || '').replace(/\D/g, '').slice(0, 13);
  return [d.slice(0, 5), d.slice(5, 12), d.slice(12)].filter(Boolean).join('-');
}
