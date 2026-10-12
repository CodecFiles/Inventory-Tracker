// SVG icons copied from the approved design (design/*.dc.html), so the app looks the same.
// They are fixed strings written by us, never user input, so inserting them as markup is safe.

const PATHS = {
  dashboard: "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"></rect><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"></rect><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"></rect><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"></rect>",
  inventory: "<path d=\"M21 8l-9-5-9 5 9 5 9-5z\"></path><path d=\"M3 8v8l9 5 9-5V8\"></path><path d=\"M12 13v8\"></path>",
  products: "<path d=\"M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z\"></path><circle cx=\"7.5\" cy=\"7.5\" r=\"1.5\"></circle>",
  batches: "<path d=\"M12 2l10 5-10 5L2 7l10-5z\"></path><path d=\"M2 12l10 5 10-5\"></path><path d=\"M2 17l10 5 10-5\"></path>",
  receive: "<path d=\"M12 3v12\"></path><path d=\"M7 10l5 5 5-5\"></path><path d=\"M4 17v3h16v-3\"></path>",
  prep: "<path d=\"M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z\"></path>",
  router: "<rect x=\"3\" y=\"13\" width=\"18\" height=\"7\" rx=\"2\"></rect><path d=\"M7 16.5h.01M11 16.5h.01\"></path><path d=\"M17 13V5\"></path><path d=\"M14 7.5a4 4 0 0 1 6 0\"></path>",
  sensor: "<path d=\"M3 8h11a3 3 0 1 0-3-3\"></path><path d=\"M3 12h16a3 3 0 1 1-3 3\"></path><path d=\"M3 16h7\"></path>",
  gateway: "<circle cx=\"12\" cy=\"12\" r=\"2\"></circle><path d=\"M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8\"></path>",
  sim: "<path d=\"M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z\"></path><rect x=\"8.5\" y=\"11\" width=\"7\" height=\"6\" rx=\"1\"></rect>",
  chip: "<rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"></rect><path d=\"M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4\"></path>",
  facility: "<rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"1.5\"></rect><path d=\"M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1\"></path>",
  poc: "<path d=\"M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3\"></path><path d=\"M7 15h10\"></path>",
  contract: "<path d=\"M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z\"></path><path d=\"M14 3v5h5\"></path><path d=\"M9 13h6M9 17h4\"></path>",
  deployment: "<path d=\"M3 6h11v10H3z\"></path><path d=\"M14 10h4l3 3v3h-7\"></path><circle cx=\"7\" cy=\"18\" r=\"2\"></circle><circle cx=\"17\" cy=\"18\" r=\"2\"></circle>",
  plus: "<circle cx=\"12\" cy=\"12\" r=\"9\"></circle><path d=\"M12 8v8M8 12h8\"></path>",
  reports: "<path d=\"M4 20V11M10 20V5M16 20v-6M21 20H3\"></path>",
  audit: "<path d=\"M3 12a9 9 0 1 0 3-6.7L3 8\"></path><path d=\"M3 3v5h5\"></path><path d=\"M12 7v5l3 2\"></path>",
  users: "<circle cx=\"9\" cy=\"8\" r=\"3.5\"></circle><path d=\"M2.5 20a6.5 6.5 0 0 1 13 0\"></path><path d=\"M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6\"></path>",
  settings: "<path d=\"M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12\"></path><circle cx=\"16\" cy=\"6\" r=\"2\"></circle><circle cx=\"10\" cy=\"12\" r=\"2\"></circle><circle cx=\"18\" cy=\"18\" r=\"2\"></circle>",
  search: "<circle cx=\"11\" cy=\"11\" r=\"7\"></circle><path d=\"M20 20l-3.5-3.5\"></path>",
  logo: "<path d=\"M16 4a8 8 0 1 0 4 11.5A6.5 6.5 0 0 1 16 4z\"></path><path d=\"M6 18l2.5-2.5\"></path>",
  ship: "<path d=\"M3 17h14l4-6H7z\"></path><path d=\"M7 11V6h6v5\"></path><path d=\"M2 21c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5\"></path>",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
